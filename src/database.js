// @ts-check

/** This is the core of SimpleQL where every request is cut in pieces and transformed into a query to the database */
const { sequence } = require('./utils')
const { prepareTables, prepareRules } = require('./prepare')

/**
 * Database minimal configuration for SimpleQL
 * @typedef {Object} Database
 * @property {string} user The login to access your database
 * @property {string} password The password to access your database
 * @property {string} password The database type that you wish to be using
 * @property {'mysql'} type The database type. For now only 'mysql' is available
 * @property {string} privateKey A private key that will be used to identify requests that can ignore access rules
 * @property {string} host The database server host
 * @property {string} database The name of your database
 * @property {boolean=} create True if you want to overwrite any pre-existing database with this name
 * @property {boolean=} unprotect True if you want to ignore the confirmation request when dropping the database
 */

/**
  * Database configuration
  * @typedef {Database & import('mysql').PoolConfig} DatabaseConfig
  */

/**
 * @typedef {Object} DatabaseParams
 * @property {import('./utils').TablesDeclaration} tables The tables as they were declared
 * @property {DatabaseConfig} database The database configuration
 * @property {import('./accessControl').Rules} rules The access rules for the database
 * @property {import('./plugins').Plugin[]} plugins The SimpleQL plugins
 */

/**
 * Load the driver according to database type, and create the database connection, and the database itself if required
 * @param {DatabaseParams} databaseParams The configuration of the database
 * @returns {Promise<{ tables: import('./utils').FormattedTablesDeclaration; rules: import('./accessControl').PreparedRules; tablesModel: import('./utils').Tables; driver: import('./drivers/template')}>} A function able to execute a request to the database
 **/
async function createDatabase ({ tables, database, rules = {}, plugins = [] }) {
  const { type, create } = database

  // Load the driver dynamically
  /** @type {import('./drivers/template').CreateDriver} */
  const createDriver = require(`./drivers/${type}`)
  if (!createDriver) return Promise.reject(`${type} is not supported right now. Try mysql for instance.`)
  // create the driver to the database
  const driver = await createDriver(database)
  const { tablesModel, tables: updatedTables } = await createTables({ driver, tables, create })
  // We pre-configure the rules for this database
  const preparedRules = prepareRules({ rules, tables: updatedTables })
  // We check if the pre-requesites required by the plugins are met
  await Promise.all(plugins.filter(plugin => plugin.preRequisite).map(plugin => plugin.preRequisite(updatedTables)))
  // We return the fully configured request handler
  return { tables: updatedTables, rules: preparedRules, tablesModel, driver }
}

/**
 * The parameters of the createTables function
 * @typedef {Object} CreateTableParams
 * @property {import('./drivers/template')} driver The driver to communicate with the database
 * @property {import('./utils').TablesDeclaration} tables The tables as they were declared
 * @property {boolean=} create Should we clear any previous database with the same name?
 */

/**
 * Create the table model that will be used for all requests and create the tables in the database
 * @param {CreateTableParams} createTablesParam The data needed to create the tables
 * @returns {Promise<{ tablesModel: import('./utils').Tables; tables: import('./utils').FormattedTablesDeclaration }>} Returns the formatted tables and the model
 **/
async function createTables ({ driver, tables, create }) {
  const { tablesModel, tables: updatedTables } = prepareTables(tables)
  // We retrieve foreign keys from the prepared table. All tables need to be created before adding foreign keys
  const foreignKeys = Object.keys(tablesModel).reduce((acc, tableName) => {
    if (tablesModel[tableName].foreignKeys) acc[tableName] = tablesModel[tableName].foreignKeys
    delete tablesModel[tableName].foreignKeys
    return acc
  }, {})
  // Create the tables if needed
  return sequence(Object.keys(tablesModel).map(tableName => () => {
    // We retrieve tables indexes from the prepared table
    const columnData = tablesModel[tableName]
    const index = columnData.index
    delete columnData.index
    const tableData = { table: tableName, data: columnData, index }
    if (create) {
      return driver.createTable(tableData)
    } else {
      return driver.processTable(tableData)
    }
  }))
    .then(async () => {
      if (create) return driver.createForeignKeys(foreignKeys).then(() => ({ tablesModel, tables: updatedTables }))
      return Promise.resolve({ tablesModel, tables: updatedTables })
    })
}

module.exports = createDatabase
