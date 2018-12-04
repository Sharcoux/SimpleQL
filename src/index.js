const express = require('express');
const { createDatabase } = require('./database');
const { createLocalLogin } = require('./login');
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, DATABASE_ERROR, UNAUTHORIZED } = require('./errors');
const checkParameters = require('./checks');
const accessControl = require('./accessControl');
const bodyParser = require('body-parser');
module.exports = {
  ...accessControl,
  createServer,
};

function createServer({port = 443, login = {login: 'email', password: 'password', salt: null, userTable: 'User'}, tables, database, rules, middlewares = [] }) {

  //Check data
  return checkParameters(tables, database, rules)
    //Create the database
    .then(() => createDatabase(tables, database, rules))
    .then(db => {
      console.log('\x1b[32m%s\x1b[0m', `${database.database} database ready to be used!`);
      //Create authentication middleware
      return createLocalLogin(login)(tables, db)
        //Start the server
        .then(({loginMiddleware, jwtOnCreation}) => {
          const app = express();
          app.listen(port);
          // parse application/x-www-form-urlencoded
          app.use(bodyParser.urlencoded({ extended: false }));
          // parse application/json
          app.use(bodyParser.json());
          middlewares.map(m => app.use(m));
          app.use(loginMiddleware);
          app.use(errorHandler);
          app.all('/', simpleQL(db));
          app.use(jwtOnCreation);
        })
        .then(() => console.log('\x1b[32m%s\x1b[0m', 'Simple QL server ready!'));
    });
}

/** The middleware in charge of treating simpleQL requests */
function simpleQL(db) {
  return (req, res, next) => {
    const authId = req.authId;
    //We forward the request to the database
    db.request(authId, req.body).then(results => {
      res.json(results);
      next();
    }).catch(err => {
      switch(err.type) {
        case NOT_SETTABLE:
        case NOT_UNIQUE:
        case BAD_REQUEST:
          res.writeHead(402);
          res.end(err.message);
          break;
        case NOT_FOUND:
          res.writeHead(404);
          res.end(err.message);
          break;
        case DATABASE_ERROR:
          res.writeHead(500);
          res.end(err.message);
          break;
        case UNAUTHORIZED:
          res.writeHead(401);
          res.end(err.message);
          break;
        default:
          res.writeHead(500);
          res.end(err);
          break;
      }
      next(err);
    });
  };
}
var errorHandler = function(err, req, res, next){//eslint-disable-line no-unused-vars
  console.log(err);
  res.writeHead(500);
  res.end('Broken');
};