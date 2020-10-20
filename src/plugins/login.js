/** Login Plugin. Check the documentation **/
const { BAD_REQUEST, NOT_FOUND, WRONG_PASSWORD } = require('../errors');
const fs = require('fs');
const crypto = require('crypto');
const check = require('../utils/type-checking');
const { login : loginModel , dbColumn } = require('../utils/types');
const logger = require('../utils/logger');
const { getOptionalDep } = require('../utils');

const jwt = getOptionalDep('jsonwebtoken', 'LoginPlugin');

let keyPair = {};
try {
  // try to read stored key
  keyPair = {
    publicKey: fs.readFileSync('public.pem'),
    privateKey: fs.readFileSync('private.key'),
  };
} catch {
  // generate Key
  keyPair = crypto.generateKeyPairSync('rsa', {
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
  fs.writeFileSync('public.pem', keyPair.publicKey);
  fs.writeFileSync('private.key', keyPair.privateKey, { mode: 0o770 });
}


const { publicKey, privateKey } = keyPair;
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

function isString(key, value, table) {
  if(!(Object(value) instanceof String)) throw new Error({
    name : BAD_REQUEST,
    message : `${key} is expected to be of type String in ${table}, but we received ${value}`,
  });
}

function createJWT(id, jwtConfig = { algorithm: algoJWT, expiresIn: '2h'}) {
  return new Promise((resolve, reject) => {
    jwt.sign({id: id+''}, privateKey, jwtConfig, (err, token) => {
      if(err) reject(err);
      resolve(token);
    });
  });
}

function checkJWT(token, jwtConfig = { algorithm: algoJWT }) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, publicKey, jwtConfig, (err, decoded) => {
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

function processRequestPassword(request, userTable, password, salt) {
  // We will hash the pwd and add a salt string if required
  // creating a unique salt for a particular user
  const saltBinary = salt ? crypto.randomBytes(16) : '';
  // hashing user's salt and password with 1000 iterations, 64 length and sha512 digest
  return createHash(request[password], saltBinary.toString('hex')).then(hash => {
    if (salt) request[salt] = saltBinary;
    request[password] = hash;
  });
}

/**
 * Manage login and user creation into the database
 * @param {string} userTable The table that will store the user's data
 * @param {string} login The column that will store the user's login
 * @param {string} password The column that will store the user's password
 * @param {string} salt The column that will store the random generated salt for the password (optional)
 * @param {Object} jwtConfig The config for the jwt encryption (optional)
 */
function createLoginPlugin(config) {
  check(loginModel, config);
  const { login = 'email', password = 'password', salt, userTable = 'User', firstname, lastname, plugins: { google, facebook } = {}, jwtConfig } = config;

  let axios;
  if(google || facebook) axios = getOptionalDep('axios', 'LoginPlugin');

  return {
    middleware: (req, res, next) => {
      const token = req.headers && req.headers.authorization && req.headers.authorization.split(' ')[1];
      if(token) {
        //A request is being authenticated with a JWT token
        checkJWT(token, jwtConfig)
          .then(decoded => (res.locals.authId = Number.parseInt(decoded.id, 10)))
          .then(() => logger('login', `${userTable} ${res.locals.authId} is making a request.`))
          .then(() => next())
          .catch(error => {
            const status =
              error.name === 'JsonWebTokenError' ? 400 :
              error.name === 'NotBeforeError' ? 425 :
              error.name === 'TokenExpiredError' ? 401 :
              401
            next({ ...error, status })
          })
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
        if (firstname) checkType(firstname, table, 'string', 1, userTable);
        if (lastname) checkType(lastname, table, 'string', 1, userTable);
      } catch(err) {
        Promise.reject(err);
      }
      if(!table.index.find(elt => elt.column === login && elt.type === 'unique')) return Promise.reject(`${login} should be made a unique index in table ${userTable}. add a field index:['${login}/unique'] inside ${userTable}.`);
    },
    onRequest: {
      [userTable] : (request, {query, local}) => {
        //Creating a user
        if(request.create) {
          return Promise.resolve().then(() => {
            if(google && request[google]) {
              //Someone is trying to register with google
              isString(google, request[google], userTable);
              return axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${request[google]}`).then(googleUserInfos => {
                request[login] = googleUserInfos.data.email;
                if(firstname) request[firstname] = googleUserInfos.data.given_name;
                if(lastname) request[lastname] = googleUserInfos.data.family_name;
                request[password] = 'google';//As this is not a hash, no one will be able to connect with this without the access token
              });
            } else if(facebook && request[facebook] && request[login]) {
              //Someone is trying to register with facebook
              isString(login, request[login], userTable);
              isString(facebook, request[facebook], userTable);
              return axios.get(`https://graph.facebook.com/${request[login]}?fields=short_name,last_name,email,name&access_token=${request[facebook]}`).then(result => {
                request[login] = result.email;
                if(firstname) request[firstname] = result.short_name;
                if(lastname) request[lastname] = result.last_name;
                request[password] = 'facebook';//As this is not a hash, no one will be able to connect with this without the access token
              });
            } else if(request[login] && request[password]) {
              //Someone is trying to register with login/password.
              isString(login, request[login], userTable);
              isString(password, request[password], userTable);
              return processRequestPassword(request, userTable, password, salt);
            } else {
              //Missing subscription details
              const googleOption = google ? `, or a ${google}` : '';
              const facebookOption = facebook ? `, or a ${facebook}` : '';
              const message = `You need a ${login} and a ${password}${googleOption}${facebookOption} to create an element inside ${userTable}`;
              return Promise.reject({
                name : BAD_REQUEST,
                message,
              });
            }
          }).then(() => {
            logger('info', request[login], 'is being created');
          });
        //Logging a user
        } else if(request.set && request.set[password]) {
          //Someone is trying to update password
          isString(password, request.set[password], userTable);
          return processRequestPassword(request.set, userTable, password, salt);
        } else {
          return Promise.resolve().then(() => {
            if(google && request[google]) {
              //Someone is trying to login with google
              isString(google, request[google], userTable);
              return axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${request[google]}`).then(googleUserInfos => {
                request[login] = googleUserInfos.data.email;
                request[password] = 'google';
              });
            } else if(facebook && request[login] && request[facebook]) {
              isString(login, request[login], userTable);
              isString(facebook, request[facebook], userTable);
              return axios.get(`https://graph.facebook.com/${request[login]}?fields=short_name,last_name,email,name&access_token=${request[facebook]}`).then(result => {
                request[login] = result.email;
                request[password] = 'facebook';//As this is not a hash, no one will be able to connect with this without the access token
              });
            }
          }).then(() => {
            if(request[login] && request[password]) {
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
                    message : `${userTable} ${request[login]} not found`,
                  });
                } else if(results.length>1) {
                  return Promise.reject('Should totally not be possible');
                } else {
                  //We compare the password provided with the hash in the database
                  if(request[password]==='google' || request[password]==='facebook') {
                    return Promise.resolve(results[0]);
                  } else {
                    const { password: hashedPass, salt: saltString } = results[0];
                    return createHash(request[password], (saltString || '').toString('hex')).then(hash => {
                      if(hash.equals(hashedPass)) {
                        return Promise.resolve(results[0]);
                      } else {
                        return Promise.reject({
                          name : WRONG_PASSWORD,
                          message : `Wrong password provided for user ${request[login]}`,
                        });
                      }
                    });
                  }
                }
              }).then(({reservedId}) => {
                delete request[password];
                request.reservedId = reservedId;
                const tokens = local.jwt || {};
                local.authId = reservedId;
                //If the log succeeds, we return a jwt token
                return createJWT(reservedId, jwtConfig)
                  .then(jwtToken => tokens[reservedId] = jwtToken)
                  .then(() => local.jwt = tokens);
              }).then(() => {
                logger('info', request[login], 'just logged in');
              });
            }
          });
        }
      }
    },
    onCreation: {
      [userTable] : (createdObject, { local }) => {
        const reservedId = createdObject.reservedId;
        //Once the user is created inside the database, we set the authId to treat each further command on his behalf
        local.authId = reservedId;
        return createJWT(reservedId, jwtConfig)
          .then(jwt => {
            //Add the jwt to the created object
            createdObject.jwt = jwt;
            return createdObject;
          });
      }
    },
    onResult: {
      [userTable] : (results, { local }) => {
        results.forEach(result => {
          const id = result.reservedId;
          const tokens = local.jwt || {};
          if(tokens[id]) {
            //In case of multiple user creation, set the jwt in the result of each request.
            result.jwt = tokens[id];
            delete tokens[id];
          }
        });
        return results;
      }
    }
  };
}

module.exports = createLoginPlugin;
