// @ts-check
const { getOptionalDep, merge, isPrimitive, filterObject } = require('../../utils')
const Driver = require('../template')
const { taxIdHelper, externalAccountHelper, mandateHelper, reviewHelper } = require('./adapters')
const { associationTables } = require('./tables')

/** @type {(secret: string) => import('stripe').Stripe} */
const stripe = getOptionalDep('stripe', 'Stripe database type')

const BAD_VALUE = 'bad value'
const BAD_WHERE = 'bad where condition'

// Removed: Discount, LineItem, Item, SetupAttempt
/** @typedef { 'Customer' | 'Plan' | 'Subscription' | 'SubscriptionItem' | 'Product' | 'Price' |
'PaymentMethod' | 'Invoice' | 'SetupIntent' | 'Account' | 'SubscriptionSchedule' |
'PaymentIntent' | 'Source' | 'TaxRate' | 'TaxID' | 'Charge' | 'Coupon' |
'Session' | 'InvoiceItem' | 'PromotionCode' | 'Mandate' | 'Review' | 'ExternalAccount' }  StripeTable */

/**
 * @template T
 * @typedef {Object} StripeTables
 * @property {T} Customer Object relative to the Customer table
 * @property {T} Plan Object relative to the Plan table
 * @property {T} Subscription Object relative to the Subscription table
 * @property {T} SubscriptionItem Object relative to the SubscriptionItem table
 * @property {T} Product Object relative to the Product table
 * @property {T} Price Object relative to the Price table
 * property {T} Discount Object relative to the Discount table
 * @property {T} PaymentMethod Object relative to the PaymentMethod table
 * @property {T} Invoice Object relative to the Invoice table
 * @property {T} SetupIntent Object relative to the SetupIntent table
 * @property {T} PaymentIntent Object relative to the PaymentIntent table
 * @property {T} Account Object relative to the Account table
 * @property {T} SubscriptionSchedule Object relative to the SubscriptionSchedule table
 * @property {T} Source Object relative to the Source table
 * @property {T} TaxRate Object relative to the TaxRate table
 * @property {T} TaxID Object relative to the TaxId table
 * @property {T} ExternalAccount Object relative to the ExternalAccount table
 * @property {T} Charge Object relative to the Charge table
 * @property {T} Coupon Object relative to the Coupon table
 * @property {T} Session Object relative to the Session table
 * @property {T} InvoiceItem Object relative to the InvoiceItem table
 * @property {T} PromotionCode Object relative to the PromotionCode table
 * property {T} LineItem Object relative to the LineItem table
 * @property {T} Mandate Object relative to the Mandate table
 * property {T} SetupAttempt Object relative to the SetupAttempt table
 * @property {T} Review Object relative to the Review table
 * property {T} Item Object relative to the Item table
 **/

/** @type {StripeTable[]} */
const tableNames = ['Customer', 'Plan', 'Subscription', 'SubscriptionItem', 'Product', 'Price', // 'Discount', 'Item', 'SetupAttempt'
  'PaymentMethod', 'Invoice', 'SetupIntent', 'Account', 'SubscriptionSchedule',
  'PaymentIntent', 'Source', 'TaxRate', 'TaxID', 'Charge', 'Coupon', 'ExternalAccount',
  'Session', 'InvoiceItem', 'PromotionCode', 'Mandate', 'Review']

/**
 * Initialize an object so that every property will return a list if not already initialized
 * @returns {StripeTables<Object[]>} object The object to transform
 */
function createPendingLists () {
  const object = {}
  tableNames.forEach(key => object[key] = [])
  return /** @type {StripeTables<Object>} **/(object)
}

/**
 * Transform a SimpleQL object into a Stripe database object.
 * @param {import('../../utils').Element} object A SimpleQL result
 * @returns {Object} The Stripe object
 */
function simpleQLToStripe (object) {
  if (object.reservedId) {
    object.id = object.reservedId
    delete object.reservedId
  }
  Object.keys(object).forEach(key => {
    if (key.endsWith('Id')) {
      object[key.substring(0, key.length - 2)] = object[key]
      delete object[key]
    }
  })
  return object
}

/**
 * Transform an element from the Stripe database into a SimpleQL object
 * @param {string[]} keys The keys of foreign objects
 * @param {Object} object The result object from the database
 * @returns {import('../../utils').Element} The SimpleQL object
 */
function stripeToSimpleQL (keys, object) {
  if (object.id) {
    object.reservedId = object.id
    delete object.id
  }
  keys.forEach(key => {
    if (key === 'reservedId') return
    if (key.endsWith('Id')) {
      const shortKey = key.substring(0, key.length - 2)
      object[key] = object[shortKey]
      delete object[shortKey]
    }
  })
  return object
}
/* TODO:
Transform productId -> product
Create the access rules
Add the Stripe Tables to the simple ql tables
Remove deleted objects from results
Add created objects to results
Transform reservedId <-> id
Transform list.data -> data[]
Transform list of ides into array of data
*/

class StripeDriver extends Driver {
  constructor (secretKey) {
    super()
    this.stripe = stripe(secretKey)

    this.startTransaction = this.startTransaction.bind(this)
    this.commit = this.commit.bind(this)
    this.rollback = this.rollback.bind(this)
    this.get = this.get.bind(this)
    this.create = this.create.bind(this)
    this.update = this.update.bind(this)
    this.delete = this.delete.bind(this)
    this.createTable = this.createTable.bind(this)
    this.processTable = this.processTable.bind(this)
    this.processTable = this.createForeignKeys.bind(this)

    // We will store here the list of objects that need to be created / deleted upon request completion
    /** @type {StripeTables<Object[]>} */
    this.toBeCreated = createPendingLists()
    /** @type {StripeTables<string[]>} */
    this.toBeDeleted = createPendingLists()
    /** @type {StripeTables<{ id: string, values: Object }[]>} */
    this.toBeUpdated = createPendingLists()

    this.inTransaction = false
  }

  /**
   * Returns the helper corresponding to the provided table.
   * @param {string} table The table's name
   */
  _stripeHelper (table) {
    switch (table) {
      case 'Customer': return this.stripe.customers
      case 'Plan': return this.stripe.plans
      case 'Subscription': return this.stripe.subscriptions
      case 'SubscriptionItem': return this.stripe.subscriptionItems
      case 'Product': return this.stripe.products
      case 'Price': return this.stripe.prices
      // case 'Discount': return this.stripe.
      case 'PaymentMethod': return this.stripe.paymentMethods
      case 'Invoice': return this.stripe.invoices
      case 'SetupIntent': return this.stripe.setupIntents
      case 'Account': return this.stripe.accounts
      case 'SubscriptionSchedule': return this.stripe.subscriptionSchedules
      case 'PaymentIntent': return this.stripe.paymentIntents
      case 'Source': return this.stripe.sources
      case 'TaxRate': return this.stripe.taxRates
      case 'TaxID': return taxIdHelper
      case 'ExternalAccount': return externalAccountHelper
      case 'Charge': return this.stripe.charges
      case 'Coupon': return this.stripe.coupons
      case 'Session': return this.stripe.checkout.sessions
      case 'InvoiceItem': return this.stripe.invoiceItems
      case 'PromotionCode': return this.stripe.promotionCodes
      // case 'LineItem': return this.stripe.invoices.
      case 'Mandate': return mandateHelper
      // case 'SetupAttemp': return this.stripe.setupAttempts
      case 'Review': return reviewHelper
      // case 'Item': return this.stripe.
      default: throw new Error(`Table ${table} is not yet supported by Stripe database driver.`)
    }
  }

  /** Clear the connection to the database */
  async destroy () {
    return Promise.resolve()
  }

  /** Start a transaction with the database */
  async startTransaction () {
    if (this.inTransaction) return Promise.reject('You already started a transaction. Call `commit()` or `rollback()` to terminate it.')
    this.inTransaction = true
    return Promise.resolve()
  }

  /** Commit the changes of the current transaction and closes it */
  async commit () {
    if (!this.inTransaction) return Promise.reject('You must start a transaction with `startTransaction()` before being able to commit it.')
    // Commit the changes
    // Create all pending objects
    Promise.all(Object.keys(this.toBeCreated).map(async key => {
      const helper = this._stripeHelper(key)
      await Promise.all(this.toBeCreated[key].map(data => {
        const simpleQLData = simpleQLToStripe(data)
        // TODO: handle objects that can't be created this way
        // @ts-ignore
        return helper.create(simpleQLData)
      }))
    }))
    // Update all pending objects
    Promise.all(Object.keys(this.toBeUpdated).map(async key => {
      const helper = this._stripeHelper(key)
      await Promise.all(this.toBeUpdated[key].map(({ id, values }) => {
        const simpleQLData = simpleQLToStripe(values)
        // TODO: handle objects that can't be updated this way
        // @ts-ignore
        return helper.update(id, simpleQLData)
      }))
    }))
    // delete all pending objects
    Promise.all(Object.keys(this.toBeDeleted).map(async key => {
      const helper = this._stripeHelper(key)
      await Promise.all(this.toBeDeleted[key].map(elt => {
        // TODO: handle objects that can't be deleted this way
        // @ts-ignore
        return helper.del(elt.reservedId)
      }))
    }))
    // Reset the pending lists
    this.toBeCreated = createPendingLists()
    this.toBeDeleted = createPendingLists()
    this.toBeUpdated = createPendingLists()
    this.inTransaction = false
    return Promise.resolve()
  }

  /** Rollback the changes of the current transaction and closes it */
  async rollback () {
    if (!this.inTransaction) return Promise.reject('You must start a transaction with `startTransaction()` before being able to roll it back.')
    // Roll back the changes in reversed order
    Promise.all(Object.keys(this.toBeCreated).map(async key => {
      const helper = this._stripeHelper(key)
      await Promise.all(this.toBeDeleted[key].map(elt => {
        // TODO: handle objects that can't be deleted this way
        // @ts-ignore
        return helper.del(elt.reservedId)
      }))
    }))
    // Reset the pending lists
    this.toBeCreated = createPendingLists()
    this.toBeDeleted = createPendingLists()
    this.toBeUpdated = createPendingLists()
    this.inTransaction = false
    return Promise.resolve()
  }

  /**
   * Read data from the current database
   * @param {import('../template').DeleteParam & { keys: string[] }} getAllParam The object describing the request
   * @returns {Promise<import('../../utils').Element[]>} The results
   */
  async _getAll ({ table, where, keys }) {
    // TODO Support Associations tables equivalence
    if (associationTables.includes(table)) return Promise.resolve([]) // For now, we don't support associations
    // If a condition specify that no value is accepted for a column, no result will match the constraint
    if (Object.values(where).find(v => Array.isArray(v) && v.length === 0)) return Promise.resolve([])
    /** @type {import('stripe').Stripe.ApiList} */
    // TODO: Handle elements for which we cannot list the data or use retrieve, and the elements that need an extra id such as externalAccounts or taxIds
    const elements = typeof where.reservedId === 'string'
      // @ts-ignore
      ? { data: [await this._stripeHelper(table).retrieve(where.reservedId)] }
      // @ts-ignore
      : await this._stripeHelper(table).list()
    // Convert Stripe objects into simple ql objects
    return elements.data.map(object => stripeToSimpleQL(keys, object))
    // We remove from the results the elements that have been deleted
      .filter(elt => !this.toBeDeleted[table].find(e => e.reservedId === elt.reservedId))
    // We add the created elements to the results
      .concat(this.toBeCreated[table])
    // Take only the elements that match the request conditions
      .filter(elt => matchWhereCondition(elt, where))
  }

  /**
   * Read data from the current database
   * @param {import('../template').GetParam} getParam The object describing the request
   * @returns {Promise<import('../../utils').Element[]>} The results
   */
  async get ({ table, search, where, offset, limit, order }) {
    try {
      if (!search.length) return Promise.resolve([])
      const results = await this._getAll({ table, where, keys: search })
      if (order) results.sort(sortFunction(order))
      // Drop the first elements if offset is provided
      if (offset) results.splice(0, offset)
      // Limit the result if provided
      if (limit) results.splice(limit, results.length - limit)
      return results.map(result => filterObject(result, search))
    } catch (err) {
      Object.assign(err, { table })
      errorHandler(err)
    }
  }

  /**
   * Remove an entry from the current database
   * @param {import('../template').DeleteParam} deleteParam The object describing the request
   * @returns {Promise<any[]>} The results
   */
  async delete ({ table, where }) {
    try {
      const elements = await this._getAll({ table, where, keys: Object.keys(where) })
      this.toBeDeleted[table].push(...elements)
      return elements
    } catch (err) {
      Object.assign(err, { table })
      errorHandler(err)
    }
  }

  /**
   * Insert an entry into the current database
   * @param {import('../template').CreateParam} createParam The object describing the request
   * @returns {Promise<any>} The results
   */
  async create ({ table, elements }) {
    const array = Array.isArray(elements) ? elements : [elements]
    this.toBeCreated[table].push(...array)
    Promise.all(Object.keys(this.toBeCreated).map(async key => {
      const helper = this._stripeHelper(key)
      await Promise.all(this.toBeCreated[key].map(data => {
        const simpleQLData = simpleQLToStripe(data)
        // TODO: handle objects that can't be created this way
        // @ts-ignore
        return helper.create(simpleQLData)
      }))
    }))
  }

  /**
   * Update an entry in the current database
   * @param {import('../template').UpdateParam} updateParam The object describing the request
   * @returns {Promise<void>} The results
   */
  async update ({ table, values, where }) {
    try {
      const elements = await this._getAll({ table, where, keys: merge(Object.keys(where), Object.keys(values)) })
      this.toBeUpdated[table].push(...elements.map(elt => ({ id: elt.reservedId, values })))
    } catch (err) {
      Object.assign(err, { table })
      errorHandler(err)
    }
  }

  /**
   * Create a table in the current database
   * @param {import('../template').CreateTableParam} createTableParam The object describing the request
   * @returns {Promise<void>} The results
   */
  async createTable ({ table, data, index }) {
    return Promise.resolve()
  }

  /**
   * Create the foreign keys in the database
   * @param {Object.<string, Object.<string, string>>} foreignKeys For each table, declares the keys that should be created with the name of the association.
   * @returns {Promise<import('../../utils').Element[]>} The results
   */
  async createForeignKeys (foreignKeys = {}) {
    return Promise.resolve([])
  }

  /**
   * Prepare the driver with the data if the table already exists
   * @param {import('../template').ProcessTableParam} processTableParam
   * @returns {Promise<void>}
   */
  async processTable ({ table = '', data = /** @type {import('../../utils').Table} **/({ notNull: [], index: [], tableName: '' }) }) {
    return Promise.resolve()
  }
}

/**
 * @callback CreateDriver
 * @param {import('../../database').Database} database The database configuration
 * @returns {Promise<Driver>} Returns the driver to communicate with the database instance
 */
const createDriver = ({ password }) => {
  return new StripeDriver(password)
}

/**
 * Sort the data according to the list of property provided.
 * @param {string[]} priorities The list of property by priority order, preceeded by '-' for descending order.
 * @returns {(a: any, b: any) => number} Return a sorting function
 */
function sortFunction (priorities) {
  return (a, b) => {
    // If no order is provided or if the objects are not comparable, we use default comparison.
    if (!(a instanceof Object) || !(b instanceof Object) || !priorities.length) return a > b ? 1 : a < b ? -1 : 0
    // Pick the first priority in the list
    let priority = priorities[0]
    const isDescending = priority.startsWith('-') ? -1 : 1 // For descending order, we just need to negate the result
    if (isDescending) priority = priority.substring(1) // We remove the minus to retrieve the column name
    // If the value is the same, we check for the next priority
    if (a[priority] === b[priority]) return sortFunction(priorities.slice(1))(a, b)
    // Otherwise, we compare the values
    else return isDescending * (a[priority] < b[priority] ? 1 : -1)
  }
}

/**
 * Check if a result matches the where condition
 * @param {Object} result The result
 * @param {Object} where The where condition
 * @returns {boolean} True if the condition is met, false otherwise
 */
function matchWhereCondition (result, where) {
  if (!where) return true
  if (!(where instanceof Object)) throw new Error(BAD_WHERE)
  // We replace fooId with foo, except for reservedId

  return !!Object.keys(where).every(key => {
    const value = result[key]
    try {
      matchCondition(value, where[key])
    } catch (err) {
      Object.assign(err, { key, value, where })
      throw err
    }
  })
}

/**
 * Check if a value matches the condition
 * @param {any} resultValue The value to check
 * @param {import('../template').WhereCondition} conditionValue The condition to meet
 * @returns {boolean} True if the condition is met, false otherwise
 */
function matchCondition (resultValue, conditionValue) {
  if (isPrimitive(conditionValue)) return resultValue === conditionValue
  else if (Array.isArray(conditionValue)) return !!conditionValue.find(value => matchCondition(resultValue, value))
  else if (conditionValue instanceof Object) return Object.keys(conditionValue).every(key => matchOperator(resultValue, conditionValue[key], /** @type {import('../template').Operator} **/(key)))
  throw new Error(BAD_VALUE)
}

/**
 * Check if a value matches the provided operator
 * @param {any} resultValue The value of the database result for the current key
 * @param {import('../template').Operator} operator The current operator
 * @param {any} conditionValue The reference value in the WhereCondition
 * @returns {boolean} True if the condition is met, false otherwise.
 */
function matchOperator (resultValue, conditionValue, operator = '=') {
  switch (operator) {
    case '<':
    case 'lt':
      return resultValue < conditionValue
    case '<=':
    case 'le':
      return resultValue <= conditionValue
    case '>':
    case 'gt':
      return resultValue > conditionValue
    case '>=':
    case 'ge':
      return resultValue >= conditionValue
    case '~':
    case 'like':
      return !!(resultValue + '').match(conditionValue + '')
    case '!':
    case 'not':
      return resultValue !== conditionValue
    default:
      return resultValue === conditionValue
  }
}

/**
 * @typedef StripeError
 * @property {string=} key The key name
 * @property {any=} value The property value
 * @property {string=} table The Table name
 * @property {Object=} where The where condition if any
 * @property {string} message The error message
 */

/**
 * Create understandable error messages
 * @param {StripeError} err The error that occured
 */
function errorHandler (err) {
  switch (err.message) {
    case BAD_VALUE: throw new Error(`In table ${err.table} we received ${err.value} value for key ${err.key}.`)
    case BAD_WHERE: throw new Error(`In table ${err.table} we received ${err.where} as where condition whereas we expected an object`)
    default: throw err
  }
}

module.exports = createDriver
