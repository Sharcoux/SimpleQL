/**
 * This will store, for each database created, a promise that will resolve once the database is ready to be queried
 * @type {Object.<string, Promise<import('..').Query>>}
 **/
const dbQuery = {}
/** @type {(db: string) => Promise<import('..').Query>} */
const getQuery = db => dbQuery[db] || Promise.reject(`No database were created with name ${db}.`)

module.exports = {
  dbQuery,
  getQuery
}
