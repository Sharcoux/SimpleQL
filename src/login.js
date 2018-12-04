const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: 'top secret'
  }
});

const algoJWT = 'RS256';

function checkType(field, table, expectedType, minSize, tableName) {
  let data = table[field];
  if(Object(data) instanceof String) {
    const [type, length] = table[field].split('/');
    data = { type, length };
  }
  if(!data || data.type!==expectedType) throw new Error(`${tableName} should contain a field ${field} of type ${expectedType}`);
  if(!data.length || parseInt(data.length, 10)<minSize) throw new Error(`${data} in ${tableName} should have a length of a at least ${minSize}`);
  return true;
}

function createJWT(id) {
  return new Promise((resolve, reject) => {
    jwt.sign({id}, privateKey, { algorithm: algoJWT, expiresIn: '2h'}, (err, token) => {
      if(err) reject(err);
      resolve(token);
    });
  });
}

function checkJWT(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, publicKey, { algorithm: algoJWT }, (err, decoded) => {
      if(err) reject(err);
      resolve(decoded);
    });
  });
}

function createHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt || '', 1000, 64, 'sha512', (err, hash) => {
      if(err) reject(err);
      resolve(hash.toString('UTF8'));
    });
  });
}

function createLocalLogin({login = 'email', password = 'password', salt = 'salt', userTable = 'User'}) {

  return (tables, database) => {
    //Validate data
    const table = tables[userTable];
    if(!table) return Promise.reject(`The table ${userTable} is not defined and is needed for loggin`);
    try {
      checkType(login, table, 'string', 1, userTable);
      checkType(password, table, 'binary', 64, userTable);
      if(salt) checkType(salt, table, 'string', 16, userTable);
    } catch(err) {
      Promise.reject(err);
    }
    if(!table.index[login] === 'unique') return Promise.reject(`${login} should be made a unique index in table ${userTable}. add a field index:{${login}:'unique'} inside ${userTable}`);
    
    return Promise.resolve({
      /** This middleware will intercept connections with login/password and users creation */
      loginMiddleware(req, res, next) {
        const body = req.body;
        const {[login]: log, [password]: pass} = body;
        if(log && pass) {
          //Someone is trying to log in. We retrieve their data
          const search = [password, 'reservedId'];
          if(salt) search.push(salt);//We might need the salt if required
          database.driver.get({
            table: userTable,
            search,
            where: { [login] : log },
          }).then(results => {
            console.log(results);
            //No user with this login
            if(results.length===0) {
              res.writeHead(404);
              return res.end(`user ${log} not found`);
            } else if(results.length>1) return Promise.reject('Should totally not be possible');
            
            //We compare the password provided with the hash in the database
            const { reservedId, password: hashedPass, salt: saltString } = results[0];
            return createHash(pass, saltString).then(hash => {
              //If the log fails
              if(hash!==hashedPass) {
                res.writeHead(401);
                return res.end(`Wrong password provided for user ${log}`);
              } else {
                //If the log succeeds, we return a jwt token
                return createJWT(reservedId).then(() => next());
              }
            }).catch(err => {
              console.error(err);
              res.writeHead(500);
              return res.end(`Error during login request: ${err.message}`);
            });
          }).catch(next);
        } else if(body[userTable] && body[userTable].create) {
          const createReq = body[userTable].create;
          //Someone is trying to register. We will hash the pwd and add a salt string if required
          function register(request) {
            const { [login]: log, [password]: pass } = request;
            //Missing login or password
            if(!log || !pass) {
              res.writeHead(400);
              return res.end(`You need a ${login} and a ${password} to create an element inside ${userTable}`);
            }
            //Wrong type for login or password
            if(!(Object(log) instanceof String) || !(Object(pass) instanceof String)) {
              res.writeHead(400);
              return res.end(`${login} and ${password} are required to be of type String in ${userTable}, but we received ${log} and ${pass}`);
            }
            // creating a unique salt for a particular user 
            const saltString = salt ? crypto.randomBytes(16).toString('UTF8') : ''; 
            // hashing user's salt and password with 1000 iterations, 64 length and sha512 digest 
            return createHash(pass, saltString).then(hash => {
              //Enhance the request
              request[password] = hash;
              if(salt) request[salt] = saltString;
            });
          }
          //We handle multiple simultaneous registration
          return Promise.all((createReq instanceof Array ? createReq : [createReq]).map(register)).then(() => next()).catch(next);
        } else if(req.token) {
          //A request is being authenticated with a JWT token
          checkJWT(req.token).then(decoded => req.authId = decoded.id).then(() => next()).catch(err => {
            switch(err.name) {
              case 'TokenExpiredError':
              case 'JsonWebTokenError':
              case 'NotBeforeError': 
                res.writeHead(401);
                res.end(err.message);
                break;
              default:
                res.writeHead(500);
                res.end(err.message);
                break;
            }
            next(err);
          });
        } else {
          res.writeHead('401');
          return res.end('The request could not be authentified');
        }
      },
      /** This middleware will return a jwt access token when a user is created */
      jwtOnCreation(req, res, next) {
        const body = req.body;
        if(body[userTable] && body[userTable].create) {
          //Now that the user id exists, We can provide the user with a jwt for future access
          const createReq = body[userTable].create;
          return (createReq instanceof Array ? Promise.all(createReq.map(request => createJWT(request[login]))) : createJWT(createReq[login]))
            .then(() => next()).catch(next);
        } else {
          next();
        }
      }
    });
  };
}

module.exports = {
  createLocalLogin,
};