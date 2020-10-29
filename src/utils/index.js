// @ts-check
const { BAD_REQUEST } = require('../errors')

/**
 * Check if a value is a primitive, like a string, a boolean, or a number.
 * @param {any} value The value to analyse
 * @returns {boolean}
 */
function isPrimitive (value) {
  return value !== undefined && value !== Object(value)
}

/**
 * Returns the type of an object
 * @param {any} obj The value to analyse
 * @returns {'number' | 'boolean' | 'integer' | 'function' | 'string' | 'undefined' | 'null'}
 */
function toType (obj) {
  return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1].toLowerCase()
}

/**
 * Returns the intersection between array1 and array2
 * @template T
 * @param {T[]} array1 The first array
 * @param {T[]} array2 The second array
 * @returns {T[]} The intersection
**/
function intersection (array1, array2) {
  return array1.filter(elt => array2.includes(elt))
}

/**
 * Resolve if any of the promises resolves.
 * @template T
 * @param {(() => Promise<T>)[]} funcs The promise functions
 * @returns {Promise<T[]>} A promise that resolves with the result of the first resolving promise
 **/
async function any (funcs) {
  // If the promise succeeds, makes it fail, and if it fails, makes it succeed
  const reverse = promise => new Promise((resolve, reject) => promise.then(reject, resolve))
  // We fail only if all the promises failed
  return reverse(sequence(funcs.map(func => () => reverse(func()))))
}

/**
 * Filter an object to only the provided keys
 * @param {Object} object The object to filter
 * @param {string[]} keys The keys to retain
 * @returns {Object} The resulting object
 **/
function filterObject (object, keys) {
  return Object.keys(object).reduce((res, key) => {
    if (keys.includes(key)) res[key] = object[key]
    return res
  }, {})
}

/**
 * Stringify functions, arrays, object or other data
 * @param {any} data The data to stringify
 * @returns {string} The resulting string
 **/
function stringify (data) {
  if (data instanceof Function) return data + ''
  if (data instanceof Buffer) return data.toString()
  else if (Array.isArray(data)) return '[' + data.map(stringify).join(', ') + ']'
  else if (data instanceof Object) return JSON.stringify(Object.keys(data).reduce((acc, key) => { acc[key] = stringify(data[key]); return acc }, {}), undefined, 4)
  else return data + ''
}

/**
 * Resolve each promise sequentially.
 * @template T
 * @param {(() => Promise<T>)[]} funcs The promises provided as functions
 * @returns {Promise<T[]>} The resulting promise
 **/
async function sequence (funcs) {
  const L = []
  const notFunction = funcs.find(f => !(f instanceof Function))
  if (notFunction) return Promise.reject(`sequence must receive an array of functions that return a promise, but received ${toType(notFunction)} instead.`)
  return funcs.reduce((chaine, func) => chaine.then(func).then(result => L.push(result)), Promise.resolve()).then(() => L)
}

/**
 * @typedef {Object} Classification
 * @property {string[]} empty keys whose value is present but undefined or null
 * @property {string[]} reserved reserved keys having special meaning
 * @property {string[]} primitives : keys whose value is a primitive
 * @property {string[]} arrays : keys whose value is an array
 * @property {string[]} objects : keys whose value is an object which is not an array
*/

/**
 * Classify the object props into 5 arrays
 * @param {TableDeclaration} object The object to read
 * @returns {Classification} The classificated keys
 */
function classifyData (object) {
  const keys = Object.keys(object)
  const { reserved, constraints, empty } = keys.reduce((acc, key) => {
    // This is the only reserved key denoting a valid constraint
    if (key === 'reservedId') {
      acc.constraints.push(key)
    } else if (reservedKeys.includes(key)) {
      acc.reserved.push(key)
    } else if (object[key] !== undefined || object[key] !== null) {
      acc.constraints.push(key)
    } else {
      acc.empty.push(key)
    }
    return acc
  }, { reserved: /** @type {string[]} **/([]), constraints: /** @type {string[]} **/([]), empty: /** @type {string[]} **/([]) })
  const { primitives, objects, arrays } = constraints.reduce(
    (acc, key) => {
      const value = object[key]
      const belongs = isPrimitive(value) ? 'primitives' : Array.isArray(value) ? 'arrays'
        : /** @type {Column} **/(value).type ? 'primitives' : 'objects'
      acc[belongs].push(key)
      return acc
    },
    { primitives: /** @type {string[]} **/([]), objects: /** @type {string[]} **/([]), arrays: /** @type {string[]} **/([]) }
  )
  return {
    empty, reserved, primitives, objects, arrays
  }
}

/**
 * @typedef {Object} RequestOperators
 * @property {string[] | '*'=} get Retrieves the data from the specified column
 * @property {Object=} set Change the data in the keys of this object with the values of this object
 * @property {boolean=} create Insert an entry in this table
 * @property {boolean=} deled Remove an entry in this table
 * @property {Object[]=} add Add an entry in the association table
 * @property {Object[]=} remove Remove an entry in the association table
 * @property {number=} limit Limit the results to this much
 * @property {number=} offset Ignore this much first results
 * @property {string[]=} order Order the results according to those columns. Preceed by '-' for descending order
 * @property {string=} like Filter with this regex
 * @property {string | number=} gt Filter results greater than this value
 * @property {string | number=} ge Filter results greater or equal to this value
 * @property {string | number=} lt Filter results lesser than this value
 * @property {string | number=} le Filter results lesser or equal to this value
 * @property {string | number=} not Filter the result that do not match this value
*/

/** @typedef {{ '<'?: string; '>'?: string; '<='?: string; '>='?: string; '~'?: string; '!'?: string }} RequestShorthands */

/** @typedef {RequestOperators & RequestShorthands} RequestInstructions */
/** @typedef {RequestInstructions & Object<string, any>} Request */

/**
 * @typedef {Object} RequestClassification
 * @property {Request} request : the request where `get : '*'` would have been replaced by the table's columns
 * @property {string[]} search : keys whose value is present but undefined
 * @property {string[]} primitives : keys which are a column of the table
 * @property {string[]} objects : keys that reference an object in another table (key+'Id' is a column inside the table)
 * @property {string[]} arrays : keys that reference a list of objects in another table (through an association table named key+tableName)
 */

/** @typedef {'string' | 'integer' | 'float' | 'double' | 'decimal' | 'date' | 'dateTime' | 'time' | 'year' | 'boolean' | 'char' | 'text' | 'binary' | 'varbinary' | 'varchar' | 'json'} ColumnType */

/**
 * @typedef {Object} Column
 * @property {ColumnType} type The column type
 * @property {number=} length The size of the column in the database in byte
 * @property {boolean=} unsigned Is the value unsigned (default: false)
 * @property {boolean=} notNull Can the value be null (default: false)
 * @property {any=} defaultValue The default value
 * @property {boolean=} autoIncrement Should the value auto increment (default: false)
 */

/**
 * @typedef {Object} Index
 * @property {string | string[]} column The column(s) this index is targeting
 * @property {'unique' | 'fulltext' | 'spatial'=} type The type of this index (default: undefined)
 * @property {number | string=} length The size of this index in bytes
 */

/** @typedef {Record<string, string | Column> & { notNull?: string[]; index?: (string | Index)[]; tableName?: string }} TableValue */
/** @typedef {Record<string, Column> & { notNull?: string[]; index?: Index[]; tableName?: string }} FormattedTableValue */
/** @typedef {Record<string, string | Column | TableValue | TableValue[]> & { notNull?: string[]; index?: (string | Index)[]; tableName?: string }} TableDeclaration */
/** @typedef {Record<string, Column | FormattedTableValue | FormattedTableValue[]> & { notNull?: string[]; index?: Index[]; tableName?: string }} FormattedTableDeclaration */
/** @typedef {Record<string, Column> & { notNull?: string[]; index?: Index[]; tableName?: string; foreignKeys: Object.<string, string> }} Table */
/** @typedef {{[tableName: string]: TableDeclaration}} TablesDeclaration */
/** @typedef {{[tableName: string]: FormattedTableDeclaration}} FormattedTablesDeclaration */
/** @typedef {{[tableName: string]: Table}} Tables */

/**
 * Classify request fields of a request inside a table into 4 categories. We also update the request if it was "*"
 * @param {Request} request The request to analyse
 * @param {FormattedTableDeclaration} table The table where the request is being executed
 * @returns {RequestClassification} The classified request keys
 */
function classifyRequestData (request, table) {
  const tableData = classifyData(table)

  // We allow using '*' to mean all columns
  if (request.get === '*') request.get = [...tableData.primitives]
  // get must be an array by now
  if (request.get && !Array.isArray(request.get)) {
    // @ts-ignore
    throw {
      name: BAD_REQUEST,
      message: `get property must be an array of string in table ${table.tableName} in request ${JSON.stringify(request)}.`
    }
  }
  // If the object or array key appears in the get instruction, we consider that we want to retrieve all the available data.
  if (request.get) {
    intersection([...tableData.objects, ...tableData.arrays], request.get).forEach(key => {
      if (request[key]) {
        // @ts-ignore
        throw {
          name: BAD_REQUEST,
          message: `In table ${table.tableName}, the request cannot contain value ${key} both in the 'get' instruction and in the request itself.`
        }
      }
      request[key] = { get: '*' }
    })
  }

  // We restrict the request to only the field declared in the table
  // fields that we are trying to get info about
  const search = intersection(request.get || [], tableData.primitives)

  // constraints for the research
  const [primitives, objects, arrays] = ['primitives', 'objects', 'arrays'].map(key => intersection(tableData[key], Object.keys(request)))
  return { request, search, primitives, objects, arrays }
}

/**
 * Retrieve a dependency, or throw an error if the dependency is not installed
 * @param {string} dependency The dependency to load
 * @param {string} requester The optional code requesting it
 * @returns {any} The dependency
 * @throws Throws an error if the dependency is not installed
 **/
function getOptionalDep (dependency, requester) {
  try {
    const dep = require(dependency)
    return dep
  } catch (err) {
    throw new Error(`You should add ${dependency} to your dependencies to use ${requester}. Run
    npm i -S ${dependency}`)
  }
}

/**
 * Ask the user if they really want to delete their database
 * @param {string} databaseName The database to reset
 * @returns {Promise<void>}
 **/
async function ensureCreation (databaseName) {
  const readline = require('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  return new Promise((resolve, reject) =>
    rl.question(`Are you sure that you wish to completely erase any previous database called ${databaseName} (y/N)\n`, answer => {
      rl.close()
      answer.toLowerCase() === 'y' ? resolve() : reject('If you don\'t want to erase the database, remove the "create" property from the "database" object.')
    })
  )
}

const reservedKeys = ['reservedId', 'set', 'get', 'created', 'deleted', 'edited', 'delete', 'create', 'add', 'remove', 'not', 'like', 'or', 'limit', 'order', 'offset', 'tableName', 'foreignKeys', 'type', 'parent', 'index', 'notNull', 'reserved', 'required']
const operators = ['not', 'like', 'gt', 'ge', 'lt', 'le', '<', '>', '<=', '>=', '~', '!']

/**
 * @typedef {Object} RequestOptions
 * @property {boolean=} readOnly Indicate if the request should not change any data in the database
 * @property {boolean=} admin Indicate if the request should be executed with admin rights
 */

/** @typedef { { reservedId: string | number } & Object.<string, any> } Element */
/** @typedef {{[table: string]: Element[]}} Result */

/**
 * @typedef {(request: import('../utils').Request, options: RequestOptions) => Promise<Result>} QueryFunction
 */

module.exports = {
  isPrimitive,
  toType,
  intersection,
  stringify,
  filterObject,
  classifyData,
  classifyRequestData,
  reservedKeys,
  operators,
  any,
  sequence,
  getOptionalDep,
  ensureCreation
}
