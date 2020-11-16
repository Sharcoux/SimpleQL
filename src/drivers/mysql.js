// @ts-check

/** This file contains the Driver that will convert SimpleQL requests into MySQL queries **/
const { WRONG_VALUE, CONFLICT, REQUIRED } = require('../errors')
const Driver = require('./template')

const { isPrimitive, operators, sequence, ensureCreation, getOptionalDep, now, uuid } = require('../utils')
const log = require('../utils/logger')
/** @type {import('mysql')} */
const mysql = getOptionalDep('mysql', 'MySQL database type')
const { v4: uuidv4 } = require('uuid')

// Shortcuts for escaping
/* Escaping values */
const es = mysql.escape
/* Escaping identifiers */
const ei = mysql.escapeId

// TODO : format requests results
/** MysqlDriver to communicate with Mysql Database */
class MysqlDriver extends Driver {
  constructor (pool) {
    super()
    /** @type {string[]} */
    this.binaries = []
    /** @type {string[]} */
    this.dates = []
    /** @type {string[]} */
    this.uuid = []
    /** @type {string[]} */
    this.json = []
    /** @type {import('mysql').Pool} */
    this.pool = pool
    /** @type {import('mysql').PoolConnection} */
    this.connection = pool
    this.inTransaction = false
    this.startTransaction = this.startTransaction.bind(this)
    this.commit = this.commit.bind(this)
    this.rollback = this.rollback.bind(this)
    this.query = this.query.bind(this)
    this.get = this.get.bind(this)
    this.update = this.update.bind(this)
    this.create = this.create.bind(this)
    this.delete = this.delete.bind(this)
    this.createTable = this.createTable.bind(this)
    this.createForeignKeys = this.createForeignKeys.bind(this)
    this.processTable = this.processTable.bind(this)
    this._escapeValue = this._escapeValue.bind(this)
    this._createQuery = this._createQuery.bind(this)
    this._convertIntoCondition = this._convertIntoCondition.bind(this)
  }

  /**
   * Send a query to the database
   * @param {string} query Query to be sent to the database
   * @returns {Promise<any>} The result of the request
   */
  async query (query) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(`timeout for requet ${query}`), 5000)
      log('database query', `Executing ${query}`)
      this.connection.query(query + ';', (error, results) => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(results)
      })
    })
  }

  async destroy () {
    // @ts-ignore
    this.connection.end(console.error)
    return Promise.resolve()
  }

  async startTransaction () {
    // We need to ensure that we are using the same connection during the whole transaction
    if (this.inTransaction) return Promise.reject('You already started a transaction. Call `commit()` or `rollback()` to terminate it.')
    this.inTransaction = true
    return new Promise((resolve, reject) => {
      this.pool.getConnection((err, connection) => {
        if (err) reject(err)
        else {
          this.connection = connection
          return this.query('START TRANSACTION').then(resolve).catch(reject)
        }
      })
    })
  }

  async commit () {
    if (!this.inTransaction) return Promise.reject('You must start a transaction with `startTransaction()` before being able to commit it.')
    return this.query('COMMIT').then(() => {
      this.connection.release()
      // TODO ensure that this affectation is legit
      // @ts-ignore
      this.connection = this.pool
      this.inTransaction = false
    })
  }

  async rollback () {
    if (!this.inTransaction) return Promise.reject('You must start a transaction with `startTransaction()` before being able to roll it back.')
    return this.query('ROLLBACK').then(() => {
      this.connection.release()
      // TODO ensure that this affectation is legit
      // @ts-ignore
      this.connection = this.pool
      this.inTransaction = false
    })
  }

  /**
   * Read data from the current database
   * @param {import('./template').GetParam} getParam The object describing the request
   * @returns {Promise<import('../utils').Element[]>} The results
   */
  async get ({ table, search, where, offset, limit, order }) {
    if (!search.length) return Promise.resolve([])
    // If a condition specify that no value is accepted for a column, no result will match the constraint
    if (Object.values(where).find(v => Array.isArray(v) && v.length === 0)) return Promise.resolve([])
    let query = this._createQuery(`SELECT ${search.map(s => ei(s)).join(', ')} FROM ${ei(table)}`, where, table)
    // order: ['name', '-age'] will sort by ascending name and descending age
    if (order) query += ` ORDER BY ${order.map(column => (column.startsWith('-') ? `${ei(column.substring(1))} DESC` : `${ei(column)} ASC`)).join(', ')}`
    if (limit) query += ` LIMIT ${es(limit)}`
    if (offset) query += ` OFFSET ${es(offset)}`
    return this.query(query).catch(errorHandler(table, 'get')).then(results => {
      log('database result', JSON.stringify(results))
      return Array.isArray(results) ? results : [results]
    })
  }

  /**
   * Remove an entry from the current database
   * @param {import('./template').DeleteParam} deleteParam The object describing the request
   * @returns {Promise<any[]>} The results
   */
  async delete ({ table, where }) {
    // If a condition specify that no value is accepted for a column, no result will match the constraint
    if (Object.values(where).find(v => Array.isArray(v) && v.length === 0)) return Promise.resolve([])
    const query = this._createQuery(`DELETE FROM ${ei(table)}`, where, table)
    return this.query(query).catch(errorHandler(table, 'delete'))
  }

  /**
   * Insert an entry into the current database
   * @param {import('./template').CreateParam} createParam The object describing the request
   * @returns {Promise<(string)[]>} The results ids
   */
  async create ({ table, elements }) {
    if (!elements) return Promise.resolve([])
    let list = Array.isArray(elements) ? elements : [elements];
    // For each property provided as an array, we duplicate the elements to be created. {a : [1, 2]} becomes [{a: 1}, {a : 2}].
    [...list].forEach(elt => {
      Object.keys(elt).forEach(key => {
        const val = elt[key]
        if (Array.isArray(val)) {
          const L = []
          val.forEach(v => list.forEach(e => L.push({ ...e, [key]: v })))
          list = L
        }
      })
    })

    return sequence(list.map(element => () => {
      const query = `INSERT INTO ${ei(table)} (
        ${Object.keys(element).map(k => ei(k)).join(', ')}
      ) VALUES (
        ${Object.keys(element).map(k => {
          // Handle UUID default value
          if (this.uuid.includes(table + '.' + k)) element[k] = uuidv4()
          return this._escapeValue(table, k, element[k])
        }).join(', ')}
      )`
      return this.query(query).catch(errorHandler(table, 'create')).then(() => element.reservedId)
    }))
  }

  /**
   * Escape values according to their type, to avoid SQL injection
   * @param {string} table The table targeted by the request
   * @param {string} key The column
   * @param {any} value The value associated with the column
   * @returns {string} Returns the escaped value
   */
  _escapeValue (table, key, value) {
    return value === null ? 'NULL'
      : this.binaries.includes(table + '.' + key)
        ? `0x${value.toString('hex')}`
        : this.dates.includes(table + '.' + key)
          ? es(new Date(value))
          : this.json.includes(table + '.' + key)
            ? es(JSON.stringify(value))
            : es(value)
  }

  /**
   * Update an entry in the current database
   * @param {import('./template').UpdateParam} updateParam The object describing the request
   * @returns {Promise<void>} The results
   */
  async update ({ table, values, where }) {
    // If a condition specify that no value is accepted for a column, no result will match the constraint
    if (Object.values(where).find(v => Array.isArray(v) && v.length === 0)) return Promise.resolve()
    const setQuery = Object.keys(values).map(key => {
      const value = values[key]
      return `${ei(key)}=${this._escapeValue(table, key, value)}`
    }).join(', ')
    const query = this._createQuery(`UPDATE ${ei(table)} SET ${setQuery}`, where, table)
    return this.query(query).catch(errorHandler(table, 'update'))
  }

  /**
   * @private
   * @param {string} table The table name
   * @param {string} name The name of the column
   * @param {import('../utils').Column} data The instructions for this column
   */
  _processColumnType (table, name, data) {
    const { type, length, defaultValue } = data
    const lengthRequired = ['char', 'binary', 'varbinary', 'decimal', 'varchar', 'string']
    // We record binary columns to not escape their values during INSERT or UPDATE
    if (type === 'binary' || type === 'varbinary') this.binaries.push(`${table}.${name}`)
    if (lengthRequired.includes(type) && !length) throw new Error(`You must specify the length of columns of type ${type}, such as ${name} in ${table}.`)
    else if (type === 'dateTime') this.dates.push(`${table}.${name}`)
    else if (type === 'json') this.json.push(`${table}.${name}`)
    else if (defaultValue === uuid) this.uuid.push(`${table}.${name}`)
  }

  /**
   * Prepare the driver with the data if the table already exists
   * @param {import('./template').ProcessTableParam} processTableParam
   * @returns {Promise<void>}
   */
  async processTable ({ table = '', data = /** @type {import('../utils').Table} **/({ notNull: [], index: [], tableName: '' }) }) {
    const columnsKeys = Object.keys(data).filter(key => key !== 'index')
    columnsKeys.forEach(name => {
      const columnData = data[name]
      this._processColumnType(table, name, columnData)
    })
    return Promise.resolve()
  }

  /**
   * Create a table in the current database
   * @param {import('./template').CreateTableParam} createTableParam The object describing the request
   * @returns {Promise<void>} The results
   */
  async createTable ({ table = '', data = /** @type {import('../utils').Table} **/({ notNull: [], index: [], tableName: '' }), index = [] }) {
    const columnsKeys = Object.keys(data).filter(key => key !== 'index')
    const columns = columnsKeys.map(name => {
      const columnData = data[name]
      const { type, length, unsigned, notNull, defaultValue, autoIncrement } = columnData
      this._processColumnType(table, name, columnData)

      let query = `${name} ${convertType(type)}`
      if (length) query += `(${length})`
      if (unsigned) query += ' UNSIGNED'
      if (notNull || defaultValue === uuid) query += ' NOT NULL'
      if (defaultValue === now) query += ' DEFAULT CURRENT_TIMESTAMP'
      else if (defaultValue && defaultValue !== uuid) query += ` DEFAULT ${this._escapeValue(table, name, defaultValue)}`
      if (autoIncrement) query += ' AUTO_INCREMENT'
      return query
    })
    // Create indexes
    const indexes = index.map(elt => {
      const type = elt.type ? elt.type.toUpperCase() + ' ' : ''
      if (!elt.column) throw new Error(`No column was defined for index ${elt} in table ${table}.`)
      if (Array.isArray(elt.column)) {
        if (elt.length && (!Array.isArray(elt.length) || elt.length.length !== elt.column.length)) throw new Error(`length in index definition of table ${table} must be an array matching the column array.`)
        const indexName = `I_${table}${elt.column.map(column => '_' + column).join('')}`
        const columns = elt.column.map((column, i) => column + (elt.length ? `(${elt.length[i]})` : '')).join(', ')
        return `, ${type}INDEX ${indexName} (${columns})`
      } else {
        const column = elt.column + (elt.length ? `(${elt.length})` : '')
        return `, ${type}INDEX I_${table}_${elt.column} (${column})`
      }
    })
    // Create the table
    return this.query(`CREATE TABLE IF NOT EXISTS ${table} (
      ${columns.join(',\n      ')}
      ${indexes.join('\n      ')}
      , CONSTRAINT PK_${table} PRIMARY KEY (reservedId)
    )`).catch(errorHandler(table, 'createTable'))
  }

  /**
   * Create the foreign keys in the database
   * @param {Object.<string, Object.<string, string>>} foreignKeys For each table, declares the keys that should be created with the name of the association.
   * @returns {Promise<import('../utils').Element[]>} The results
   */
  async createForeignKeys (foreignKeys = {}) {
    return sequence(Object.keys(foreignKeys).map(tableName => () => {
      const keys = Object.keys(foreignKeys[tableName])
      const query = keys.map(key => `ADD CONSTRAINT FK_${tableName}_${key} FOREIGN KEY (${key}) REFERENCES ${foreignKeys[tableName][key]}(reservedId) ON DELETE CASCADE ON UPDATE CASCADE`).join(',\n       ')
      return this.query(`
        ALTER TABLE ${tableName}
        ${query}
      `).catch(errorHandler(tableName, 'createForeignKeys'))
    }))
  }

  /**
   * Transform the simple-ql data into a mysql query
   * @param {string} base The current query string
   * @param {Object} where The constraint object to apply to the request
   * @param {string} table The table name to query
   * @returns {string} The formated and escaped query
   */
  _createQuery (base, where, table) {
    if (!where || !Object.keys(where).length) return base
    return `${base} WHERE ${this._convertIntoCondition(where, table)}`
  }

  /**
   * Convert the constraint object into a mysql query string
   * @param {Object} conditions The constraint object
   * @param {string} table The table where the query will occure
   * @param {import('./template').Operator} operator The operation to apply
   * @returns {string} The resulting query string
   */
  _convertIntoCondition (conditions, table, operator = '=') {
    return Object.keys(conditions).map(key => {
      /**
       * Write the value with the current operation
       * @param {string} value The value
       * @param {import('./template').Operator} operator The operation to apply
       * @returns {string}
       */
      const writeValue = (value, operator) => {
        switch (operator) {
          case 'ge':
          case 'gt':
          case 'le':
          case 'lt':
          case '~':
            return `${ei(key)} ${operatorsMap[operator]} ${this._escapeValue(table, key, value)}`
          case '>':
          case '<':
          case '>=':
          case '<=':
          case 'like':
            return `${ei(key)} ${operator.toUpperCase()} ${this._escapeValue(table, key, value)}`
          case '!':
          case 'not':
            return value === null ? `${ei(key)} IS NOT NULL` : `${ei(key)}!=${this._escapeValue(table, key, value)}`
          default:
            return value === null ? `${ei(key)} IS NULL` : `${ei(key)}=${this._escapeValue(table, key, value)}`
        }
      }
      /**
       * Write the condition with the current operation
       * @param {any} value The condition
       * @param {import('./template').Operator} operator The operation to apply
       * @returns {string}
       */
      const writeCondition = (value, operator = '=') => {
        if (isPrimitive(value)) return writeValue(value, operator)
        if (['not', '!'].includes(operator)) return 'NOT (' + writeCondition(value) + ')'
        if (Array.isArray(value)) return '(' + value.map(v => writeCondition(v, operator)).join(' OR ') + ')'
        else if (value instanceof Object) {
          return '(' + Object.keys(value).map((/** @type {import('./template').Operator} **/k) => {
            if (!operators.includes(k)) throw new Error(`${k} is not a valid constraint for key ${key} in table ${table}`)
            if (!['not', '!', '='].includes(operator)) throw new Error(`${k} connot be combined with operator ${operator} in key ${key} in table ${table}`)
            return writeCondition(value[k], k)
          }).join(' AND ') + ')'
        }
        else if (value === undefined) throw new Error(`The value for ${key} was undefined in table ${table}.`)
        throw new Error(`Should not be possible. We received this weird value : ${JSON.stringify(value)} which was nor object, nor array, nor primitive for column ${key} in table ${table}`)
      }
      return writeCondition(conditions[key], operator)
    }).join(' AND ')
  }
}

const operatorsMap = {
  ge: '>=',
  gt: '>',
  le: '<=',
  lt: '<',
  '~': 'LIKE'
}

/**
 * Convert a simple-ql type into a mysql type
 * @param {import('../utils').Column['type']} type The type to convert
 * @returns {string} The mysql equivalent type
 */
function convertType (type) {
  switch (type) {
    case 'string': return 'VARCHAR'
    default : return type.toUpperCase()
  }
}

/**
 * An handler to handle mysql errors
 * @param {string} table The table name
 * @param {'get' | 'create' | 'delete' | 'update' | 'createForeignKeys' | 'createTable'} operation The operation where the issue occured
 */
function errorHandler (table, operation) {
  return error => {
    if (error.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' && error.sqlMessage.includes('Access denied')) {
      return Promise.reject({ name: WRONG_VALUE, message: `You are not allowed to access some data needed for your request ${operation} in table ${table}.` })
    } else if (error.code === 'ER_DUP_ENTRY') {
      const message = error.sqlMessage.replace(`I_${table}_`, '')
      const [dup, ids, key, tables] = message.split('\'')
      const [tableNames, property] = tables.split('_').map(name => name.replace('Id', ''))
      const [tableName, propertyName] = tableNames.split('.')
      // Array association
      if (table === propertyName + property) {
        const [propertyId, id] = ids.split('-')
        return Promise.reject({ name: CONFLICT, message: `${dup}: Object ${id} received another occurence of ${property} ${propertyId}${key}${propertyName} whereas the association was expected to be unique. Occured during operation ${operation} in table ${table}` })
      }
      // Normal table
      else {
        return Promise.reject({ name: CONFLICT, message: `${dup}: Table ${tableName} received a second object with ${propertyName} ${ids} during ${operation} operation, whereas it was expected to be unique.` })
      }
    } else if (error.code === 'ER_NO_DEFAULT_FOR_FIELD') return Promise.reject({ name: REQUIRED, message: `${error.sqlMessage}, was not specified in the request, and is required in table ${table} for ${operation} operation.` })
    else {
      console.error(error)
      return Promise.reject({ name: error.code, message: `${error.sqlMessage}. It occured in ${table} table during ${operation} operation` })
    }
  }
}

/**
 * Database creation
 * @param {import('../database').DatabaseConfig} mysqlParam Driver configuration
 * @returns {Promise<import('./template')>} Returns the driver to communicate with the database
 */
async function createDatabase ({ database = 'simpleql', charset = 'utf8', create = false, unprotect = false, host = 'localhost', connectionLimit = 100, ...parameters }) {
  return Promise.resolve().then(() => {
    if (!create) return Promise.resolve()
    // Instantiate a connection to create the database
    const pool = mysql.createPool({ ...parameters, connectionLimit, host })
    const driver = new MysqlDriver(pool)
    return driver.query(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${database}'`)
      .then(exists => exists.length && !unprotect && ensureCreation(database))
      // Destroy previous database if required
      .then(() => driver.query(`DROP DATABASE IF EXISTS ${database}`))
      .catch(err => {
        if (err.code === 'ECONNREFUSED') {
          return Promise.reject(`Failed to connect to the database. Make sure that you have a MySQL database running on port ${err.port} of host ${err.address}. If you don't have a mysql database, you can install one with the following commands:
          sudo apt install mysql-server
          sudo mysql_secure_installation
          sudo systemctl start mysql
        `)
        } else if (err.code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
          return Promise.reject(`ER_NOT_SUPPORTED_AUTH_MODE: Client does not support authentication protocol requested by server. You should try the following options:
          * downgrade your mysql server to 5.6.40,
          * use a non root user,
          * or run:
              sudo mysql
              ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password'`)
        } else return Promise.reject(err)
      })
      // Create the database
      .then(() => driver.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET ${charset}`))
      .then(() => log('info', `Brand new ${database} database successfully created!`))
  })
    // Enter the database and returns the driver
    .then(() => {
      const pool = mysql.createPool({ ...parameters, database, connectionLimit, host })
      return new MysqlDriver(pool)
    })
}

module.exports = createDatabase
