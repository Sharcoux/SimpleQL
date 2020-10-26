// @ts-check

/** Login Plugin. Check the documentation **/
const { BAD_REQUEST, NOT_FOUND, WRONG_PASSWORD } = require('../errors');
const fs = require('fs');
const crypto = require('crypto');
const check = require('../utils/type-checking');
const { login : loginModel , dbColumn } = require('../utils/types');
const logger = require('../utils/logger');
const { getOptionalDep } = require('../utils');

/** @type {import('jsonwebtoken')} */
const jwt = getOptionalDep('jsonwebtoken', 'LoginPlugin');

/** @type {{ publicKey: string | Buffer; privateKey: string | Buffer }} */
let keyPair;
try {
  // try to read stored key
  keyPair = {
    publicKey: fs.readFileSync('public.pem'),
    privateKey: fs.readFileSync('private.key'),
  };
} catch(e) {
  // generate Key
  /** @type {import('crypto').KeyPairKeyObjectResult} **/
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

/**
 * Check the type of the data provided to the plugin
 * @param {string} field The column name in the table 
 * @param {import('../utils').FormattedTableValue} table The table object data
 * @param {string} expectedType The expected type for this column
 * @param {number} minSize The minimum size for this column
 * @param {string} tableName The table name
 * @throws Throws an error if the field type doesn't match the expected type
 * @returns {true}
 */
function checkType(field, table, expectedType, minSize, tableName) {
  let data = table[field];
  if(!data || data.type!==expectedType) throw new Error(`${tableName} should contain a field ${field} of type ${expectedType}, but we received: ${data && data.type}`);
  check(dbColumn, data);
  if(!data.length || parseInt(data.length + '', 10)<minSize) throw new Error(`${data} in ${tableName} should have a length of a at least ${minSize}`);
  return true;
}

/**
 * Ensure that the data is of type string
 * @param {string} key The column to check
 * @param {any} value The current value
 * @param {string} table The table name
 * @thorws Throws an error if the value is not of type string
 */
function isString(key, value, table) {
  // @ts-ignore
  if(typeof value !== 'string') throw new Error({
    name : BAD_REQUEST,
    message : `${key} is expected to be of type String in ${table}, but we received ${value}`,
  });
}

/**
 * Generate the jwt token
 * @param {number | string} id The data to integrate to the token
 * @param {import('jsonwebtoken').SignOptions} jwtConfig jwt options
 * @returns {Promise<string>}
 */
async function createJWT(id, jwtConfig = { algorithm: 'RS256', expiresIn: '2h'}) {
  return new Promise((resolve, reject) => {
    jwt.sign({id: id+''}, privateKey, jwtConfig, (err, token) => {
      if(err) reject(err);
      resolve(token);
    });
  });
}

/**
 * Check the validity of the jwt token
 * @param {string} token The token to check
 * @param {import('jsonwebtoken').VerifyOptions} jwtConfig jwt options
 * @returns {Promise<Object>} A promise that resolves to the decoded token
 */
async function checkJWT(token, jwtConfig) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, publicKey, jwtConfig, (err, decoded) => {
      if(err) reject(err);
      resolve(decoded);
    });
  });
}

/**
 * Create the salted hash of the provided password
 * @param {string} password The password to hash
 * @param {string} salt The random salt
 * @returns {Promise<Buffer>} The hash
 */
async function createHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt || '', 1000, 64, 'sha512', (err, hash) => {
      if(err) reject(err);
      resolve(hash);
    });
  });
}

/**
 * Salt the password in the request if needed
 * @param {import('../utils').Request} request The request to handle
 * @param {string} password The password field
 * @param {string=} salt The salt field name
 */
function processRequestPassword(request, password, salt) {
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
 * Login plugin configuration
 * @typedef {Object} LoginConfig
 * @property {string} userTable The table that will store the user's data
 * @property {string} login The column that will store the user's login
 * @property {string} password The column that will store the user's password
 * @property {string=} salt The column that will store the random generated salt for the password (optional)
 * @property {string=} firstname The column that will store the user firstname if we use google or facebook login (optional)
 * @property {string=} lastname The column that will store the user lastname if we use google or facebook login (optional)
 * @property {{ google?: string; facebook?: string}=} plugins The tokens for facebook or google logins (optional)
 * @property {import('jsonwebtoken').VerifyOptions & import('jsonwebtoken').SignOptions=} jwtConfig The config for the jwt encryption (optional)
 */

/**
 * Manage login and user creation into the database
 * @param {LoginConfig} config The plugin configuration
 * @returns {import('./').Plugin}
 */
function createLoginPlugin(config) {
  /** Prevent using jwt as column name if we use this plugin */
  const reservedKeys = require('../utils').reservedKeys;
  if(!reservedKeys.includes('jwt')) reservedKeys.push('jwt');
  check(loginModel, config);
  const { login = 'email', password = 'password', salt, userTable = 'User', firstname, lastname, plugins: { google, facebook } = {}, jwtConfig } = config;

  let axios;
  if(google || facebook) axios = getOptionalDep('axios', 'LoginPlugin');

  return {
    middleware: async (req, res, next) => {
      const token = req.headers && req.headers.authorization && req.headers.authorization.split(' ')[1];
      if(token) {
        //A request is being authenticated with a JWT token
        checkJWT(token, jwtConfig)
          // TODO handle the possibility to use UUID instead of number for the reservedId
          .then(decoded => (res.locals.authId = Number.parseInt(decoded.id, 10)))
          .then(() => logger('login', `${userTable} ${res.locals.authId} is making a request.`))
          .then(() => next())
          .catch(error => {
            const status =
              error.name === 'JsonWebTokenError' ? 400 :
                error.name === 'NotBeforeError' ? 425 :
                  error.name === 'TokenExpiredError' ? 401 :
                    401;
            const message =
              error.message === 'jwt signature is required' ? 'This jwt error should not be happenning. Please report this.' :
                error.message === 'invalid signature' ? 'There was an issue when reading the public.pem file. Please report this.' :
                  error.message;
            next({ ...error, message, status });
          });
      } else next();
    },
    preRequisite : async (tables) => {
      //Validate data
      const table = /** @type {import('../utils').FormattedTableValue} */(tables[userTable]);
      if(!table) return Promise.reject(`The table ${userTable} is not defined and is needed for loggin`);
      try {
        checkType(login, table, 'string', 1, userTable);
        checkType(password, table, 'binary', 64, userTable);
        if(salt) checkType(salt, table, 'binary', 16, userTable);
        if (firstname) checkType(firstname, table, 'string', 1, userTable);
        if (lastname) checkType(lastname, table, 'string', 1, userTable);
      } catch(err) {
        return Promise.reject(err);
      }
      if(!table.index.find(elt => elt.column === login && elt.type === 'unique')) return Promise.reject(`${login} should be made a unique index in table ${userTable}. add a field index:['${login}/unique'] inside ${userTable}.`);
    },
    onRequest: {
      [userTable] : async (request, {query, local, isAdmin}) => {
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
              return processRequestPassword(request, password, salt);
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
        } else if(!isAdmin && request.set && request.set[password] && !request.password) {
          return Promise.reject({
            name: BAD_REQUEST,
            message: `You need to provide the previous ${password} to be allowed to edit the ${password} inside ${userTable}.`
          });
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
          }).then(() => {
            if(request.set && request.set[password]) {
              //Someone is trying to update password
              isString(password, request.set[password], userTable);
              return processRequestPassword(request.set, password, salt);
            }
          });
        }
      }
    },
    onCreation: {
      [userTable] : async (createdObject, { local }) => {
        const reservedId = createdObject.reservedId;
        //Once the user is created inside the database, we set the authId to treat each further command on its behalf
        local.authId = reservedId;
        return createJWT(reservedId, jwtConfig)
          .then(jwt => {
            //Add the jwt to the created object
            createdObject.jwt = jwt;
          });
      }
    },
    onResult: {
      [userTable] : async (results, { local, request }) => {
        return Promise.all(results.map(result => {
          const id = result.reservedId;
          const tokens = local.jwt || {};
          if(tokens[id]) {
            //In case of multiple user creation, set the jwt in the result of each request.
            result.jwt = tokens[id];
            delete tokens[id];
          } else if(id===local.authId && request.get && request.get.includes('jwt')) {
            return createJWT(id, jwtConfig).then(jwt => {result.jwt = jwt;});
          }
          return Promise.resolve();
        })).then(() => {});
      }
    }
  };
}

module.exports = createLoginPlugin;
