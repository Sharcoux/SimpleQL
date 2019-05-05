const { BAD_REQUEST, NOT_FOUND, WRONG_PASSWORD } = require('../errors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const check = require('../utils/type-checking');
const { login : loginModel , dbColumn } = require('../utils/types');
const logger = require('../utils/logger');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  }
});

const algoJWT = 'RS256';

function checkType(field, table, expectedType, minSize, tableName) {
  let data = table[field];
  if(Object(data) instanceof String) {
    const [type, l] = table[field].split('/');
    data = { type, length : parseInt(l, 10) };
  }
  if(!data || data.type!==expectedType) throw new Error(`${tableName} should contain a field ${field} of type ${expectedType}`);
  check(dbColumn, data);
  if(!data.length || parseInt(data.length, 10)<minSize) throw new Error(`${data} in ${tableName} should have a length of a at least ${minSize}`);
  return true;
}

function createJWT(id) {
  return new Promise((resolve, reject) => {
    jwt.sign({id: id+''}, privateKey, { algorithm: algoJWT, expiresIn: '2h'}, (err, token) => {
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
      resolve(hash);
    });
  });
}

/**
 * Manage login and user creation into the database
 * @param {string} userTable The table that will store the user's data
 * @param {string} login The column that will store the user's login
 * @param {string} password The column that will store the user's password
 * @param {string} salt The column that will store the random generated salt for the password (optional)
 */
function createLocalLogin({login = 'email', password = 'password', salt = 'salt', userTable = 'User'}) {
  check(loginModel, {login, password, salt, userTable});
  const jwt = {};
  return {
    middleware: (req, res, next) => {
      const token = req.headers && req.headers.authorization && req.headers.authorization.split(' ')[1];
      if(token) {
        //A request is being authenticated with a JWT token
        checkJWT(token).then(decoded => (res.locals.authId = Number.parseInt(decoded.id, 10)))
          .then(() => logger('login', `${userTable} ${res.locals.authId} is making a request.`))
          .then(() => next())
          .catch(next);
      } else next();
    },
    preRequisite : (tables) => {
      //Validate data
      const table = tables[userTable];
      if(!table) return Promise.reject(`The table ${userTable} is not defined and is needed for loggin`);
      try {
        checkType(login, table, 'string', 1, userTable);
        checkType(password, table, 'binary', 64, userTable);
        if(salt) checkType(salt, table, 'binary', 16, userTable);
      } catch(err) {
        Promise.reject(err);
      }
      if(!table.index.find(elt => elt.column === login && elt.type === 'unique')) return Promise.reject(`${login} should be made a unique index in table ${userTable}. add a field index:['${login}/unique'] inside ${userTable}.`);
    },
    onRequest: {
      [userTable] : (request, {query, update}) => {
        //Creating a user
        if(request.create) {
          //Someone is trying to register. We will hash the pwd and add a salt string if required
          const { [login]: log, [password]: pass } = request;
          logger('info', log, 'is being created');
          //Missing login or password
          if(!log || !pass) return Promise.reject({
            name : BAD_REQUEST,
            message : `You need a ${login} and a ${password} to create an element inside ${userTable}`,
          });

          //Wrong type for login or password
          if(!(Object(log) instanceof String) || !(Object(pass) instanceof String)) return Promise.reject({
            name : BAD_REQUEST,
            message : `${login} and ${password} are required to be of type String in ${userTable}, but we received ${log} and ${pass}`,
          });

          // creating a unique salt for a particular user 
          const saltBinary = salt ? crypto.randomBytes(16) : ''; 
          // hashing user's salt and password with 1000 iterations, 64 length and sha512 digest 
          return createHash(pass, saltBinary.toString('hex')).then(hash => {
            if(salt) request[salt] = saltBinary;
            request[password] = hash;
          });

        //Logging a user
        } else if(request[login] && request[password] && !request.create) {
          logger('info', request[login], 'is trying to log in');
          //Someone is trying to log in. We retrieve their data
          const get = [password, 'reservedId'];
          if(salt) get.push(salt);//We might need the salt if required
          return query({
            [userTable] : {
              [login] : request[login],
              get,
            }
          }, {readOnly : true, admin : true}).then(({[userTable] : results}) => {
            //No user with this login
            if(results.length===0) {
              return Promise.reject({
                name : NOT_FOUND,
                message : `user ${request[login]} not found`,
              });
            } else if(results.length>1) {
              return Promise.reject('Should totally not be possible');
            }

            //We compare the password provided with the hash in the database
            const { reservedId, password: hashedPass, salt: saltString } = results[0];
            update('authId', reservedId);
            return createHash(request[password], saltString.toString('hex')).then(hash => {
              if(hash.equals(hashedPass)) {
                delete request[password];
                request.reservedId = reservedId;
                //If the log succeeds, we return a jwt token
                return createJWT(reservedId)
                  .then(jwtToken => jwt[reservedId] = jwtToken);
              } else {
                return Promise.reject({
                  name : WRONG_PASSWORD,
                  message : `Wrong password provided for user ${request[login]}`,
                });
              }
            });
          });
        }
      }
    },
    onCreation: {
      [userTable] : (object, { update }) => {
        const reservedId = object.reservedId;
        update('authId', reservedId);
        return createJWT(reservedId)
          .then(jwt => object.jwt = jwt)
          .then(() => object);
      }
    },
    onResult: {
      [userTable] : results => {
        results.forEach(result => {
          const id = result.reservedId;
          if(jwt[id]) {
            result.jwt = jwt[id];
            delete jwt[id];
          }
        });
        return results;
      }
    }
  };
}

module.exports = createLocalLogin;