// @ts-check

/** Provide a set of functions that will act as rules to build the access restriction to any element from the database */
const { any, sequence, classifyData } = require('./utils')
const { DATABASE_ERROR } = require('./errors')

/**
 * @typedef {Object} PreParams
 * @property {import('./utils').TablesDeclaration} tables The tables as they were created (see [prepare your tables](../docs/tables.md))
 * @property {string} tableName The target table name
 */

/**
 * @typedef {Object} RuleParams
 * @property {string} authId The id used to identify the user making the request.
 * @property {import('./utils').Request} request The portion of the request relative to the current table.
 * @property {object} object The result of this portion of the request
 * @property {import('./utils').QueryFunction} query A function that can make a SimpleQL query to the database (see [query](../docs/requests.md)).
 * @property {boolean=} requestFlag A flag used by the 'request' rule. Should be ignored.
 */

/** @typedef {(params: RuleParams) => Promise<void>} PreparedRule */
/** @typedef {(preParams: PreParams) => PreparedRule} Rule */

/**
 * Rule that enables anyone
 * @type {Rule}
 **/
function all () {
  return async () => Promise.resolve()
}

/**
 * No one is enabled by this rule
 * @type {Rule}
 **/
function none () {
  return async () => Promise.reject('None rule')
}

/**
 * Product of provided rules
 * @param {...Rule} rules The rules that should be validated
 * @returns {Rule} The resulting rule
 */
function and (...rules) {
  return preParams => async params => sequence(rules.map(rule => async () => rule(preParams)(params))).then(() => {})
}

/**
 * Union of provided rules
 * @param {...Rule} rules The rules to join
 * @returns {Rule} The resulting rule
 */
function or (...rules) {
  return preParams => async params => any(rules.map(rule => async () => rule(preParams)(params))).then(() => {})
}

/**
 * Rule that enables anyone that doesn't fulfill the provided rule
 * @param {Rule} rule The rule to reverse
 * @returns {Rule} The resulting rule
 **/
function not (rule) {
  return preParams => async params => new Promise((resolve, reject) => rule(preParams)(params).then(() => reject('`not` rule: the inner rule succeeded'), resolve))
}

/**
 * If this rule is used, the inner rules will now apply to the request instead of the database
 * @param {Rule} rule The rule to apply to the request
 * @returns {Rule} The rule edited to be applied to the request
 */
function request (rule) {
  return preParams => async params => rule(preParams)({ ...params, requestFlag: true })
}

/**
 * Look for an object denoted by `field` pathName into the request.
 * field can use `parent` or `..` to look into the parent request.
 * @param {import('./utils').Request} request The request to analyse
 * @param {string} field The name of the field we are looking for
 * @returns {Object | undefined} The result found
 **/
function getObjectInRequest (request, field) {
  if (!field) return request
  if (!request) return undefined
  const fields = field.split('.')
  const first = /** @type {string} **/(fields.shift())
  if (first === 'parent' || first === '..') return getObjectInRequest(request.parent, fields.join('.'))
  return getObjectInRequest(request[first], fields.join('.'))
}

/**
 * Look for a children property into the object. Can look deeper into the object by using `.` to separate properties.
 * @param {Object} object The result object to analyse
 * @param {string} field The field name to look for
 * @returns {Object | undefined} The result found
 */
function getTargetObject (object, field) {
  if (!field) return object
  if (!object) return undefined
  const fields = field.split('.')
  const first = /** @type {string} **/(fields.shift())
  return getTargetObject(object[first], fields.join('.'))
}

/**
 * Enable only the users whose id matches the denoted field value (relative or absolute)
 * @param {string} field The column name
 * @throws Throws an error if the field doesn't exist in the table
 * @returns {Rule} The created rule
 **/
function is (field) {
  if (!field || !(Object(field) instanceof String)) throw new Error('`is` rule expects its parameter to be a string matching a field or a table. Please refer to the documentation.')
  return ({ tables, tableName }) => async ({ authId, request, object, requestFlag, query }) => {
    if (field === 'self') {
      return object.reservedId === authId ? Promise.resolve() : Promise.reject(`is(self) rule: ${authId} is not the id of ${JSON.stringify(object)}.`)
    }
    const isValid = object => object && object.reservedId === authId
    return checkInTable({ field, tables, tableName, authId, object, request, requestFlag, query, ruleName: 'is', isValid })
  }
}

/**
 * Enable only the users that are a member of the denoted field list. The field can be relative or absolute.
 * @param {string} field The column name
 * @throws Throws an error if the field doesn't exist in the table
 * @returns {Rule} The created rule
 **/
function member (field) {
  if (!field || !(Object(field) instanceof String)) throw new Error('`member` rule expects its parameter to be a string matching a field or a table. Please refer to the documentation.')
  return ({ tables, tableName }) => async ({ authId, object, request, requestFlag, query }) => {
    const isValid = array => {
      if (!Array.isArray(array)) return false
      return array.map(elt => elt.reservedId).includes(authId)
    }
    return checkInTable({ field, tables, tableName, authId, object, request, requestFlag, query, ruleName: 'member', isValid })
  }
}

/**
 * Valid only if the field contains exactly amount elements, or more than min and less than max elements if provided. The field can be relative or absolute.
 * @param {string} field The column name
 * @param {{ amount?: number; min?: number; max?: number}} constraints The options for this rule
 * @throws Throws an error if the field doesn't exist in the table or if the constraint is malformed
 * @returns {Rule} The created rule
 **/
function count (field, { amount, min, max } = {}) {
  if (!field || !(Object(field) instanceof String)) throw new Error('`count` rule expects its first parameter to be a string matching a field or a table. Please refer to the documentation.')
  if ((amount === undefined && min === undefined && max === undefined) || [amount, min, max].find(e => e !== undefined && isNaN(e))) throw new Error('`count` rule expects its second parameter to be an object indicating the amount of elements allowed for this field.')
  if (amount !== undefined && (min !== undefined || max !== undefined)) throw new Error('You cannot provide both \'amount\' and \'min/max\' in the \'count\' rule')
  /**
   * Check if a result is acceptable according to current access rules
   * @param {Object} elt The result element to check
   * @returns {boolean} Is the element acceptable
   */
  const isValid = elt => {
    const value = Array.isArray(elt) ? elt.length : Number.parseInt(elt, 10)
    if (amount) return value === amount
    else if (min !== undefined && max !== undefined) return value >= min && value <= max
    else if (min !== undefined) return value >= min
    else if (max !== undefined) return value <= max
    else return true
  }
  return ({ tables, tableName }) => async ({ authId, object, request, requestFlag, query }) => {
    return checkInTable({ field, tables, tableName, authId, object, request, requestFlag, query, ruleName: 'count', isValid })
  }
}

/**
 * Valid only if the field contains exactly amount elements, or more than min and less than max elements if provided. The field can be relative or absolute.
 * @param {string} field The column name
 * @param {string | number | undefined | null | Date | boolean} target The options for this rule
 * @throws Throws an error if the field doesn't exist in the table or if the constraint is malformed
 * @returns {Rule} The created rule
 **/
function isEqual (field, target) {
  if (!field || !(Object(field) instanceof String)) throw new Error('`isEqual` rule expects its first parameter to be a string matching a field or a table. Please refer to the documentation.')
  if (typeof target === 'object' && !(target instanceof Date)) throw new Error('`isEqual` rule expects its second parameter to be a primitive value or a date to compare to the field.')
  /**
   * Check if a result is acceptable according to current access rules
   * @param {unknown} value The result element to check
   * @returns {boolean} Is the element acceptable
   */
  const isValid = value => (target instanceof Date ? target.getTime() === new Date(/** @type {Date} **/(value)).getTime() : value === target)
  return ({ tables, tableName }) => async ({ authId, object, request, requestFlag, query }) => {
    return checkInTable({ field, tables, tableName, authId, object, request, requestFlag, query, ruleName: 'isEqual', isValid })
  }
}

/**
 * @typedef {Object} CheckParams
 * @property {string} field The column to check
 * @property {import('./utils').TablesDeclaration} tables The tables as they were declared
 * @property {string} tableName The current table name
 * @property {string} authId The id identifying the emitter of the request. Used to calculate the access rights
 * @property {import('./utils').Result} object
 * @property {import('./utils').Request} request
 * @property {boolean=} requestFlag
 * @property {import('./utils').QueryFunction} query
 * @property {string} ruleName The rule
 * @property {(elt: Object) => boolean} isValid A function to check if an element is acceptable
 */

/**
 * Look in different places to see if the function isValid is true for the provided field
 * @param {CheckParams} params The parameters to make the check
 * @throws Throws an error if the element is not accepted by the access rules
 * @returns {Promise<void>} Resolves if the element is accepted
 **/
async function checkInTable ({ field, tables, tableName, authId, object, request, requestFlag, query, ruleName, isValid }) {
  if (requestFlag) {
    // If the requestFlag is set, we check inside the request itself
    const obj = getObjectInRequest(request, field)
    if (!obj) return Promise.reject(`${ruleName}(${field}) rule: The field ${field} is required in requests ${JSON.stringify(request)} in table ${tableName}.`)
    if (!Array.isArray(obj)) return isValid([obj]) ? Promise.resolve() : Promise.reject(`${ruleName}(${field}) rule: The field ${field}.reservedId must be ${authId} in request ${JSON.stringify(request)} in table ${tableName}.`)
    return isValid(obj) ? Promise.resolve() : Promise.reject(`${ruleName}(${field}) rule: ${authId} could not be found in ${field} of ${JSON.stringify(request)} in ${tableName}.`)
  } else if (tables[tableName][field]) {
    // We check if the current object contains a property with the field name, and if the value is valid
    let result = object
    if (object[field] === undefined) {
      const results = await query({
        [tableName]: {
          reservedId: object.reservedId,
          get: [field]
        }
      }, { admin: true, readOnly: true })
      result = results[tableName][0]
    }
    if (!isValid(result[field])) return Promise.reject(`${ruleName}(${field}) rule: ${authId} not ${field} of ${JSON.stringify(result)} in ${tableName}.`)
    return Promise.resolve()
  } else {
    // We check if the field denotes a whole table and if this table contains a property that could match
    const target = getTargetObject(object, field)
    if (target) {
      return isValid(target) ? Promise.resolve() : Promise.reject(`${ruleName}(${field}) rule`)
    }
    // We try to look into the whole table
    const [tName, property] = field.split('.')
    const table = tables[tName]
    if (!table) {
      return Promise.reject({
        name: DATABASE_ERROR,
        message: `The field ${field} was not found in the resulting object ${JSON.stringify(object)} in table ${tableName}, nor in the tables.`
      })
    }
    const { objects } = classifyData(table)
    if (property && !objects.includes(property)) {
      return Promise.reject({
        name: DATABASE_ERROR,
        message: `The field ${property} was not found in the table ${tName} in the '${ruleName}' rule specified in table ${tableName}.`
      })
    }
    const targetField = property || 'reservedId'
    if (Array.isArray(table[targetField])) {
      return Promise.reject({
        name: DATABASE_ERROR,
        message: `The field ${targetField} is an array in the table ${tName}. It should be an object to deal correctly with the ${ruleName} rule ${field}.`
      })
    }
    return query({ [tName]: { get: [targetField] } }, { admin: true, readOnly: true }).then(results => {
      const data = results[tName].map(result => property ? result.property : result)
      return isValid(data) ? Promise.resolve() : Promise.reject(`${ruleName}(${field}) rule: ${authId} not ${targetField} of elements in ${tName}.`)
    })
  }
}

/**
 * @typedef {Object} TableRule
 * @property {Rule} read Read access rule to the table
 * @property {Rule} write Write access rule to the table
 * @property {Rule} create Creation rule
 * @property {Rule} delete Deletion rule
 */

/**
  * @typedef {Object} ColumnRule
  * @property {Rule=} read Read access rule for the column
  * @property {Rule=} write Write access rule for the column
  * @property {Rule=} add Rules to insert elements
  * @property {Rule=} remove Rules to remove elements
  */

/**
 * @typedef {Object} PreparedTableRule
 * @property {PreparedRule} read Read access rule to the table
 * @property {PreparedRule} write Write access rule to the table
 * @property {PreparedRule} create Creation rule
 * @property {PreparedRule} delete Deletion rule
 */

/**
  * @typedef {Object} PreparedColumnRule
  * @property {PreparedRule=} read Read access rule for the column
  * @property {PreparedRule=} write Write access rule for the column
  * @property {PreparedRule=} add Rules to insert elements
  * @property {PreparedRule=} remove Rules to remove elements
  */

/** @typedef {Object.<string, ColumnRule | Rule> & TableRule} FullTableRule */
/** @typedef {{ [tableName: string]: FullTableRule }} Rules */
/** @typedef {{ [tableName: string]: { [column: string]: PreparedColumnRule} & PreparedTableRule }} PreparedRules */

module.exports = {
  not,
  and,
  or,
  count,
  member,
  is,
  all,
  request,
  isEqual,
  none
}
