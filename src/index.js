const { createDatabase } = require('./database');
const errors = require('./errors');
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, DATABASE_ERROR, FORBIDDEN, UNAUTHORIZED, WRONG_PASSWORD, ACCESS_DENIED } = errors;
const checkParameters = require('./checks');
const accessControl = require('./accessControl');
const bodyParser = require('body-parser');
const log = require('./utils/logger');
const plugins = require('./plugins');
module.exports = {
  ...accessControl,
  createServer,
  errors,
  plugins,
};

function createServer({tables = {}, database = {}, rules = {}, plugins = [], middlewares = [], errorHandler, app}) {
  const allMiddlewares = plugins.map(plugin => plugin.middleware).filter(mw => mw).concat(middlewares);
  const errorHandlers = plugins.map(plugin => plugin.errorHandler).filter(mw => mw);
  errorHandlers.push(errorHandler || defaultErrorHandler);
  if(!app || !app.use || !app.all) return Promise.reject('app parameter is required and should be an express app created with express().')
  //Check data
  return checkParameters({tables, database, rules, plugins})
    //Create the database
    .then(() => createDatabase({tables, database, rules, plugins}))
    .then(requestHandler => {
      log('info', `${database.database} database ready to be used!`);
      // parse application/x-www-form-urlencoded
      app.use(bodyParser.urlencoded({ extended: false }));
      // parse application/json
      app.use(bodyParser.json());
      //Add the middlewares
      allMiddlewares.forEach(m => app.use(m));
      //Listen to simple QL requests
      app.all('/', simpleQL(requestHandler));
      //Add error handlers
      errorHandlers.forEach(h => app.use(h));
      //Final error handler, ditching error
      app.use((err, req, res, next) => next());
      log('info', 'Simple QL server ready!');
      return requestHandler;
    });
}

/** The middleware in charge of treating simpleQL requests */
function simpleQL(requestHandler) {
  return (req, res, next) => {
    const authId = res.locals.authId;
    //We forward the request to the database
    requestHandler(authId, req.body)
      .then(results => {
        res.json(results);
        next();
      })
      .catch(next);
  };
}

/** The default handler for simpleQL errors */
function defaultErrorHandler(err, req, res, next) {//eslint-disable-line no-unused-vars
  if(Object(err.status) instanceof Number) {
    res.writeHead(err.status);
    err.message ? res.end(err.message) : res.json(err);
  } else {
    switch(err.name) {
      case NOT_SETTABLE:
      case NOT_UNIQUE:
      case BAD_REQUEST:
        res.writeHead(400);
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
      case WRONG_PASSWORD:
      case ACCESS_DENIED:
        res.writeHead(401);
        res.end(err.message);
        break;
      case FORBIDDEN:
        res.writeHead(403);
        res.end(err.message);
        break;
      default:
        res.writeHead(500);
        console.error(err);
        res.end(err);
        break;
    }
  }
  next(err);
}
