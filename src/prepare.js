// @ts-check

/** We need to make some treatment to the data provided by the user before being able to create the server */
const { classifyData, uuid } = require('./utils')
const { none } = require('./accessControl')

/** transform tables into sql data types and add a tableName property to each table. Returns the tableModel generated
 * author = User is transformed into authorId = 'integer/10';
 * contacts = [User] creates a new table contactsUser = {userId : 'integer/10', contactsId : 'integer/10'}
 * The TablesDeclaration is also unified, so that short string declaration (like string/20) is transformed into an object: { type: 'string'; length: 20 }.
 * Same goes for the indexes
 * @param {import('./utils').TablesDeclaration} tables The tables the way they were declared by the user
 * @returns {{ tablesModel: import('./utils').Tables, tables: import('./utils').FormattedTablesDeclaration }} Returns the table model for the database and the updated tables declaration
*/
function prepareTables (tables) {
  // We add the table name into each table data
  Object.keys(tables).forEach(tableName => tables[tableName].tableName = tableName)
  // We add the reservedId props
  // TODO make possible to use UUID instead of auto-increment integer
  /** @type {import('./utils').Column} */
  const reservedId = { type: 'char', length: 36, defaultValue: uuid, notNull: true }
  Object.keys(tables).forEach(tableName => tables[tableName].reservedId = reservedId)

  // We transform the tables into a valid data model
  const tablesModel = Object.keys(tables).reduce((acc, tableName) => {
    const table = tables[tableName]
    const { empty, primitives, objects, arrays, reserved } = classifyData(table)
    const reservedKey = reserved.find(key => !['tableName', 'index', 'notNull'].includes(key))
    if (reservedKey) throw new Error(`${reservedKey} is a reserved key and cannot be used as a column of table ${tableName}.`)

    // @ts-ignore
    acc[tableName] = {} // Create table entry

    // We transform the short index string form into the object one
    if (table.index) {
      acc[tableName].index = table.index.map(elt => {
        if (typeof elt === 'string') {
          const details = elt.split('/')
          return details.reduce((index, value) => {
            // Index length (the first number value we might find)
            if (!isNaN(/** @type {any} **/(value))) index.length = Number.parseInt(value, 10)
            // Index column name (the first string value that matches a column name)
            else if (tables[tableName][value]) index.column = value
            // Index type (one of 'unique', 'fulltext' or 'spatial')
            else if (['unique', 'fulltext', 'spatial'].includes(value)) index.type = /** @type {'unique' | 'fulltext' | 'spatial'} **/(value)
            else throw new Error(`The value ${value} for index of table ${table.tableName} could not be interpreted, nor as a type, nor as a column, nor as a length. Check the documentation.`)
            return index
          }, /** @type {import('./utils').Index} **/({}))
        } else return elt
      })
    }

    if (empty.length) throw new Error(`The fields ${empty.join(', ')} do not have a value.`)

    // Add primitives constraints
    primitives.forEach(key => {
      const data = /** @type {import('./utils').Column | string} **/(table[key])
      // Parse the short string data type
      if (typeof data === 'string') {
        const [type, length] = data.split('/')
        acc[tableName][key] = { type: /** @type {import('./utils').Column['type']} **/(type), length: length !== undefined ? parseInt(length, 10) : undefined }
        table[key] = acc[tableName][key]// We update the table declaration
      } else {
        acc[tableName][key] = data
      }
    })

    // Transforme author = User into authorId = 'integer/10';
    objects.forEach(key => {
      const objectTable = /** @type {import('./utils').TableValue} **/(table[key])
      acc[tableName][key + 'Id'] = {
        type: 'char',
        length: 36
      }
      // We need to change the index accordingly
      if (acc[tableName].index) {
        acc[tableName].index.forEach(index => {
          // Rewrite the column name for name + Id
          if (Array.isArray(index.column)) {
            const keyIndex = index.column.findIndex(c => c === key)
            if (keyIndex >= 0) index.column[keyIndex] = key + 'Id'
          } else if (index.column === key) {
            index.column = key + 'Id'
          }
          // Indexes on object table alone are ignored
          if (index.column === key) throw new Error(`indexes on keys referencing foreign tables will be ignored, except for composite indexes. Please remove index ${key} from table ${tableName}.`)
        })
      }
      // We need to change the notNull columns
      if (table.notNull) {
        table.notNull = table.notNull.map(column => column === key ? key + 'Id' : column)
      }
      // We create the foreign key
      acc[tableName].foreignKeys = {
        [key + 'Id']: objectTable.tableName
      }
    })

    // Create an association table. User: { comments: [Comment] } creates a map commentsUser = {userId : 'integer/10', contactsId : 'integer/10'}
    arrays.forEach(key => {
      const name = key + tableName
      const associatedTable = /** @type {import('./utils').TableValue} */(table[key][0])
      // We create a dedicated table to store the associations
      acc[name] = /** @type {import('./utils').Table} **/({
        reservedId: { type: 'integer', length: 10, unsigned: true, autoIncrement: true },
        [tableName + 'Id']: {
          type: 'char',
          length: 36,
          notNull: true
        },
        [key + 'Id']: {
          type: 'char',
          length: 36,
          notNull: true
        },
        foreignKeys: {
          [tableName + 'Id']: tableName,
          [key + 'Id']: associatedTable.tableName
        }
      })
      // arrays cannot be notNull
      if (acc[tableName].notNull && acc[tableName].notNull.includes(key)) throw new Error(`fields denoting an association like ${key} cannot be notNull in table ${tableName}.`)
      // Indexes on array
      const index = acc[tableName].index
      // If the index denote the association table as being unique, we consider that the table cannot have duplicate entries.
      if (index) {
        // We don't support multiple column indexes on association tables for now
        const multipleColumn = index.find(index => Array.isArray(index.column) && index.column.find(c => c === key))
        if (multipleColumn) {
          throw new Error(`Multiple indexes cannot contain keys referencing association tables. Please remove ${key} from index ${index} in table ${tableName}.`)
        }
        // Translate the index about the association table into an index for the dedicated table we created
        const arrayIndex = index.find(index => index.column === key)
        if (arrayIndex) {
          if (arrayIndex.type && arrayIndex.type !== 'unique') {
            throw new Error(`Indexes on keys referencing association tables must be of type unique. Please set the type of ${key} in the index of table ${tableName} to 'unique', or remove the index.`)
          } else {
            // Association table entries are supposed to be unique
            acc[name].index = [{
              column: [key + 'Id', tableName + 'Id'],
              type: 'unique'
            }]
            // We remove the index from the original table as it belongs to the association one
            index.splice(index.indexOf(arrayIndex), 1)
          }
        }
      }
    })

    // Set the notNull attribute for each column
    if (table.notNull) {
      table.notNull.forEach(column => acc[tableName][column].notNull = true)
    }

    // Update the corrected indexes
    if (table.index) table.index = acc[tableName].index

    return acc
  }, /** @type {import('./utils').Tables} **/({}))
  return { tablesModel, tables: /** @type {import('./utils').FormattedTablesDeclaration} */(tables) }
}

/**
 * The parameters for prepareRules function
 * @typedef {Object} PrepareRulesParams
 * @property {import('./accessControl').Rules} rules The rules to be prepared
 * @property {import('./utils').FormattedTablesDeclaration} tables
 */

/**
 * Preconfigurate rules functions with database configuration
 * (works by side effects, editing directly the rules object)
 * @param {PrepareRulesParams} prepareRulesParams
 */
function prepareRules ({ rules, tables }) {
  /** @type {import('./accessControl').PreparedRules} **/
  const preparedRules = {}
  Object.keys(rules).forEach(tableName => {
    const tableRules = rules[tableName]
    preparedRules[tableName] = /** @type {any} **/({})
    /**
     * Apply the PreParams to the rule once and for all
     * @param {import('./accessControl').Rule} rule The rule
     * @param {string} propName The name of the column the rule is applying to
     * @returns {import('./accessControl').PreparedRule} The rule with PreParams already applied
     */
    function partialApplication (rule, propName) {
      if (!(rule instanceof Function)) throw new Error(`Rules should be functions in table ${tableName} for ${propName}.`)
      const result = rule({ tables, tableName })
      if (!(result instanceof Function)) throw new Error(`Rules should be functions that return a function in table ${tableName} for ${propName}.`)
      return result
    }
    // Prepare the provided rules
    Object.keys(tableRules).forEach(key => {
      // Prepare table level rules
      if (['read', 'write', 'create', 'delete'].includes(key)) /** @type {import('./accessControl').PreparedTableRule} **/(preparedRules[tableName])[key] = partialApplication(/** @type {import('./accessControl').TableRule} **/(tableRules)[key], key)
      // Prepare column level rules
      else {
        const columnRules = tableRules[key]
        preparedRules[tableName][key] = {}
        Object.keys(columnRules).forEach(k => {
          const validKeys = ['read', 'write', 'add', 'remove']
          if (validKeys.includes(k)) preparedRules[tableName][key][k] = partialApplication(columnRules[k], key + '.' + k)
          else throw new Error(`The value of ${key} in ${tableName} can only contain the following keys: ${validKeys.join(', ')}. ${k} is not accepted.`)
        })
      }
    })
    // Add a 'none' rule for reservedId
    preparedRules[tableName].reservedId = {
      write: partialApplication(none, 'reservedId')
    }
  })
  return preparedRules
}

module.exports = {
  prepareTables, // Prepare the tables and returns the associated dataModel
  prepareRules // Prepare the rules with the database configuration
}
