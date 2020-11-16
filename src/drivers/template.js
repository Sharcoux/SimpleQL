// @ts-check

/** @typedef {'=' | 'ge' | 'gt' | 'le' | 'lt' | '~' | '>' | '<' | '>=' | '<=' | 'like' | '!' | 'not'} Operator */

/** @typedef {Object.<string, Object.<Operator, Object> | Object>} WhereCondition*/

/**
 * @typedef GetParam Read data in the current database
 * @property {string} table The table name
 * @property {string[]} search The column to look for
 * @property {WhereCondition=} where The constraints for the request
 * @property {number=} offset Ignore that many first entries
 * @property {number=} limit Return that many entries at most
 * @property {string[]=} order Order the result accorgin to the provided columns. Prepend a '-' to use descending order.
 */

/**
* @typedef DeleteParam Remove data from the current database
* @property {string} table The table name
* @property {Object=} where The constraints for the request
*/

/**
* @typedef CreateParam Insert data into the current database
* @property {string} table The table name
* @property {Object.<string, any> | Object.<string, any>[]} elements The elements to insert
*/

/**
* @typedef UpdateParam Edit data in the current database
* @property {string} table The table name
* @property {Object.<string, string>} values The values to edit
* @property {Object=} where The constraints for the request
*/

/**
* @typedef CreateTableParam Create a table in the current database
* @property {string} table The table name
* @property {import('../utils').Table} data The columns of the table to create
* @property {import('../utils').Index[]=} index The indexes to be created in the table
*/

/**
* @typedef ProcessTableParam Prepare the driver for a table already created in the database
* @property {string} table The table name
* @property {import('../utils').Table} data The columns of the table to create
*/

class Driver {
  /** Clear the connection to the database */
  async destroy() {
    return Promise.resolve()
  }
  /** Start a transaction with the database */
  async startTransaction() {
    return Promise.resolve()
  }
  /** Commit the changes of the current transaction and closes it */
  async commit() {
    return Promise.resolve()
  }
  /** Rollback the changes of the current transaction and closes it */
  async rollback() {
    return Promise.resolve()
  }
  /**
   * Read data from the current database
   * @param {GetParam} getParam The object describing the request
   * @returns {Promise<import('../utils').Element[]>} The results
   */
  async get({ table, search, where, offset, limit, order }) {
    return Promise.resolve([])
  }
  /**
   * Remove an entry from the current database
   * @param {DeleteParam} deleteParam The object describing the request
   * @returns {Promise<any[]>} The results
   */
  async delete({ table, where }) {
    return Promise.resolve([])
  }
  /**
   * Insert an entry into the current database
   * @param {CreateParam} createParam The object describing the request
   * @returns {Promise<(string)[]>} The results ids
   */
  async create({ table, elements }) {
    return Promise.resolve([])
  }
  /**
   * Update an entry in the current database
   * @param {UpdateParam} updateParam The object describing the request
   * @returns {Promise<void>} The results
   */
  async update({ table, values, where }) {
    return Promise.resolve()
  }
  /**
   * Create a table in the current database
   * @param {CreateTableParam} createTableParam The object describing the request
   * @returns {Promise<void>} The results
   */
  async createTable({ table, data, index }) {
    return Promise.resolve()
  }
  /**
   * Create the foreign keys in the database
   * @param {Object.<string, Object.<string, string>>} foreignKeys For each table, declares the keys that should be created with the name of the association.
   * @returns {Promise<Object[]>} The results
   */
  async createForeignKeys(foreignKeys = {}) {
    return Promise.resolve([])
  }
  /**
   * Prepare the driver with the data if the table already exists
   * @param {ProcessTableParam} processTableParam 
   * @returns {Promise<void>}
   */
  async processTable({ table = '', data = /** @type {import('../utils').Table} **/({ notNull: [], index: [], tableName: '' }) }) {
    return Promise.resolve()
  }
}

/**
 * @callback CreateDriver
 * @param {import('../database').Database} database The database configuration
 * @returns {Promise<Driver>} Returns the driver to communicate with the database instance
 */
// const createDriver = ({ login, password, host }) => { };

module.exports = Driver