// @ts-check

const createDatabase = require('./database')
const errors = require('./errors')
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, PAYLOAD_TOO_LARGE, DATABASE_ERROR, FORBIDDEN, TOO_MANY_REQUESTS, UNAUTHORIZED, WRONG_PASSWORD, ACCESS_DENIED, CONFLICT, REQUIRED } = errors
const checkParameters = require('./checks')
const accessControl = require('./accessControl')
const bodyParser = require('body-parser')
const log = require('./utils/logger')
const plugins = require('./plugins')
const { stringify, modelFactory, now, uuid } = require('./utils')
const rateLimit = require('express-rate-limit')
const createRequestHandler = require('./requestHandler')
const { dbQuery, getQuery } = require('./utils/query')

/** @typedef {import('./plugins').Plugin} Plugin */
/** @typedef {Plugin[]} Plugins */
/** @typedef {import('./accessControl').Rules} Rules */
/** @typedef {import('./utils').TableDeclaration} Table */
/** @typedef {import('./utils').TablesDeclaration} Tables */
/** @typedef {import('./database').DatabaseConfig} Database */

/**
 * @callback Query
 * @param {import('./utils').Request} query The SimpleQL request
 * @param {import('express').Response['locals'] & import('./plugins').Local=} locals If the request comes from a client, provide here the value of response.locals from Express.Response.
 * You can specify local.authId to execute the request on the behalf of a particular user, and local.readOnly to skip the steps that edit the database.
 * If you provide nothing, the request will be executed as administrator.
 * @returns {Promise<import('./utils').Result>} The results of the SimpleQl request
 **/

/**
 * This will queue promises to ensure that every request waits for the previous query to resolve before starting a new one
 * @type {Object.<string, Promise<import('./utils').Result>>}
 */
const dbQueryStack = {}

module.exports = {
  ...accessControl,
  createServer,
  errors,
  plugins,
  getQuery,
  modelFactory,
  now,
  uuid
}

/**
 * @typedef {Object} SimpleQLParams
 * @property {Tables} tables The database tables (see [Tables](./docs/tables.md))
 * @property {Database} database The database configuration (see [Database](./docs/database.md))
 * @property {Rules} rules The rules to control access to the data (see [Rules](./docs/access.md))
 * @property {import('express').RequestHandler[]=} middlewares As many express middleware as desired
 * @property {Plugins} plugins The list of Simple QL plugins to use
 * @property {import('express').Express} app The express app
 */

/**
  * @typedef {Object} ServerParams
  * @property {string=} root The root app (default: '/')
  * @property {string=} sizeLimit The limit size of requests (default: '5mb')
  * @property {number=} requestPerMinute The maximum allowed request per minutes (default: 1000)
  */

/**
 * Create the SimpleQL server
 * @param {SimpleQLParams} simpleQlParams Simple QL parameters
 * @param {ServerParams} serverParams Server parameters
 * @returns {Promise<Query>} Returns a promise that resolves with a function to query the database
 */
async function createServer ({ tables = {}, database, rules = {}, plugins = [], middlewares = [], app }, { root = '/', sizeLimit = '5mb', requestPerMinute = 1000 } = {}) {
  const allMiddlewares = plugins.map(plugin => plugin.middleware).filter(mw => mw).concat(middlewares)
  const errorHandlers = plugins.map(plugin => plugin.errorHandler).filter(mw => mw)
  errorHandlers.push(defaultErrorHandler)
  if (!app || !app.use || !app.all) return Promise.reject('app parameter is required and should be an express app created with express().')
  if (!(Object(root) instanceof String)) return Promise.reject('root parameter must be of type string and should denote the path to listen to')
  if (!root.startsWith('/')) return Promise.reject('root parameter should start with \'/\' and denote the path SimplQL server should listen to')
  // Create the promise to get the query function to make requests to the database from the server
  const databaseName = database.database
  /** @type {(query: Query) => void} */
  let dbReady = () => {} // Callback when the db is ready
  /** @type {(error: any) => void} */
  let dbReject = () => {} // Callback if the db failed
  if (database && databaseName && typeof databaseName === 'string') {
    // Creates, for the database, a promise that will resolve only once the db is ready
    dbQuery[databaseName] = new Promise((resolve, reject) => { dbReady = resolve; dbReject = reject })
    // We initialize the stack with a promise that will resolve once the database is ready
    dbQueryStack[databaseName] = dbQuery[databaseName].then(() => ({}))
  }

  try {
    await checkParameters({ tables, database, rules, plugins })
    // Create the database
    const { tables: preparedTables, tablesModel, driver, rules: preparedRules } = await createDatabase({ tables, database, rules, plugins })
    const requestHandler = await createRequestHandler({ tables: preparedTables, tablesModel, driver, rules: preparedRules, privateKey: database.privateKey, plugins })
    log('info', `${databaseName} database ready to be used!`)
    // parse application/x-www-form-urlencoded
    app.use(root, bodyParser.urlencoded({ extended: false, limit: '1mb' }))
    // parse application/json
    app.use(root, bodyParser.json({ limit: sizeLimit }))
    // Limit amount of requests handled
    if (requestPerMinute) {
      const apiLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: requestPerMinute
      })
      app.use(root, apiLimiter)
    }
    // Add the middlewares
    allMiddlewares.forEach(m => app.use(root, m))
    // Listen to simple QL requests
    app.all(root, simpleQL(databaseName))
    // Add error handlers
    errorHandlers.forEach(h => app.use(root, h))
    // Final error handler, ditching error
    app.use(root, (_err, _req, _res, next) => next())
    log('info', 'Simple QL server ready!')
    // Enable server side requests by providing a query function.
    // We make sure that the previous request is over before it is possible to make a new one.
    /** @type {Query} */
    const dbQuery = (query, locals = { authId: database.privateKey, readOnly: false }) => dbQueryStack[databaseName] = dbQueryStack[databaseName].catch(() => {}).then(() => requestHandler(query, locals))
    dbReady(dbQuery)
    return await dbQuery
  } catch (err) {
    dbReject(err)
    return Promise.reject(err)
  }
}

/**
 * The middleware in charge of treating simpleQL requests
 * @param {string} databaseName The name of the database to create
 * @returns {import('express').RequestHandler} Returns an express middleware
 **/
function simpleQL (databaseName) {
  return async (req, res, next) => {
    res.locals.databaseName = databaseName
    // We forward the request to the database
    getQuery(databaseName)
      .then(query => query(req.body, /** @type {import('./plugins').Local} **/(res.locals)))
      .then(results => {
        res.json(results)
        next()
      })
      .catch(next)
  }
}

/**
 * The default express error handler for simpleQL errors
 * @type {import('express').ErrorRequestHandler}
 **/
function defaultErrorHandler (err, _req, res, next) {
  if (Object(err.status) instanceof Number) {
    res.writeHead(err.status)
    err.message ? res.end(err.message) : res.json(err)
  } else {
    switch (err.name) {
      case NOT_SETTABLE:
      case NOT_UNIQUE:
      case REQUIRED:
      case BAD_REQUEST:
        res.writeHead(400)
        res.end(err.message)
        break
      case NOT_FOUND:
        res.writeHead(404)
        res.end(err.message)
        break
      case PAYLOAD_TOO_LARGE:
        res.writeHead(413)
        res.end(err.message)
        break
      case CONFLICT:
        res.writeHead(409)
        res.end(err.message)
        break
      case TOO_MANY_REQUESTS:
        res.writeHead(429)
        res.end(err.message)
        break
      case DATABASE_ERROR:
        res.writeHead(500)
        res.end(err.message)
        break
      case UNAUTHORIZED:
      case WRONG_PASSWORD:
      case ACCESS_DENIED:
        res.writeHead(401)
        res.end(err.message)
        break
      case FORBIDDEN:
        res.writeHead(403)
        res.end(err.message)
        break
      default:
        console.error(err)
        res.writeHead(500)
        res.end(err.message || stringify(err))
        break
    }
  }
  next(err)
}
