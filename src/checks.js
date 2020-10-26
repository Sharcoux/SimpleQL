// @ts-check

/** This file contains functions to check the validity of the parameters provided to simple-ql */
const check = require('./utils/type-checking');
const { dbColumn, database } = require('./utils/types');
const { stringify, classifyData, reservedKeys, toType } = require('./utils');


/**
 * Check that the tables that are going to be created are valid
 * @param {import('./utils').TablesDeclaration} tables The tables as they were declared
 * @throws Throws an error if the tables are invalid
 */
function checkTables(tables) {
  const acceptedTypes = ['string', 'integer', 'float', 'double', 'decimal', 'date', 'dateTime', 'time', 'year', 'boolean', 'char', 'text', 'binary', 'varbinary', 'varchar', 'json'];
  const lengthRequired = ['char', 'binary', 'decimal', 'varchar', 'srting'];
  const numeric = ['integer', 'float', 'decimal', 'double'];
  const indexTypes = ['unique', 'fulltext', 'spatial'];
  //check values
  Object.keys(tables).forEach(tableName => {
    const table = tables[tableName];
    Object.keys(table).forEach(field => {
      if(reservedKeys.includes(field) && field!=='index' && field!=='notNull') throw new Error(`${field} is a reserved field`);
      checkField(tableName, field, table[field]);
    });
  });

  /**
   * Check that the field value is valid
   * @param {string} tableName The name of the table
   * @param {string} field The column to check
   * @param {any} value The value to check
   * @throws Throws an error if the table cannot accept this value for this column
   **/
  function checkField(tableName, field, value) {

    /**
     * Check that a column is correctly defined
     * @param {import('./utils').Column} columnParams The column to check
     */
    function checkConsistency({type, length, unsigned, notNull, defaultValue}) {

      //Is the type supported
      if(!acceptedTypes.includes(type)) throw new Error(`${value} is invalid value for ${field} in ${tableName}. Valid types are: ${acceptedTypes.join(', ')}`);
      //Is the length required and provided
      if(lengthRequired.includes(type) && !length) throw new Error(`${field} column of type ${type} requires a length parameter in ${tableName}`);
      //Is the type numeric when unsigned is provided
      if(!numeric.includes(type) && unsigned) throw new Error(`column ${field} is of type ${type} which doesn't accept unsigned flag.`);

      //We check for each type that the size property is valid
      switch(type) {
        case 'boolean':
        case 'integer':
        case 'string':
        case 'char':
        case 'varchar':
        case 'binary':
        case 'varbinary':
        case 'text': {
          if(length && parseInt(length + '',10)!=length) throw new Error(`${field} in ${tableName} expected an integer after the / but we reveived ${length}`);
          break;
        }
        case 'double':
        case 'decimal':
        case 'float': {
          if(length) {
            const [s,d] = (length + '').split(',');
            // @ts-ignore
            if(!d || parseInt(s,10)!=s || parseInt(d,10)!=d) throw new Error(`${field} in ${tableName} expected a decimal parameter like 8,2 but we reveived ${length}`);
          }
          break;
        }
        case 'json':
        case 'date':
        case 'dateTime':
        case 'time':
        case 'year': {
          if(length) throw new Error(`${field} in ${tableName} received the parameter ${length} but we didn't expect one.`); 
          break;
        }
        default:
          throw new Error(`We received the type ${type} for ${field} in ${tableName} but it is not recognized.`); 
      }

      //We check if notNull is set when defaultValue is null
      if(defaultValue===null && notNull===true) throw new Error(`The default value is null whereas the notNull flag is set to true in field ${field} in table ${tableName}.`);
    }

    //Check index field
    if(field==='index') {
      if(!Array.isArray(value)) throw new Error(`Field 'index' in ${tableName} must be an array containing objects where keys are 'column', 'type' and 'length', or a string separing these values with a '/'.`);
      value.forEach(v => {
        let index;
        if((Object(v) instanceof String)) {
          index = {};
          v.split('/').forEach(p => {
            let type;
            if(indexTypes.includes(p)) type = 'type';
            else if(!isNaN(p)) type = 'length';
            else if(tables[tableName][p] && p!=='index' && p!=='notNull') type = 'column';
            else throw new Error(`Value ${p} for index ${v} in table ${tableName} didn't match any column, nor denoted a length, nor was a type (unique, fulltext, spacial).`);
            if(index[type]) throw new Error(`The value ${p} was supposed to be a ${type} for table ${tableName}, but we already have the value ${index[type]}.`);
            index[type] = p;
          });
        } else {
          index = v;
        }
        //Check column
        if(!index.column) throw new Error(`The index entry ${stringify(index)} doesn't precise any column to refer to in table ${tableName}.`);
        if(!Array.isArray(index.column) && !(Object(index.column) instanceof String)) throw new Error(`The column ${index.column} of an index entry from table ${tableName} must contains a String or an array of Strings.`);
        if(Array.isArray(index.column) && !index.column.every(c => Object(c) instanceof String)) throw new Error(`The column ${stringify(index.column)} of an index entry from table ${tableName} must contains a String or an array of Strings.`);
        //Ensure that the column exists for the index
        const columns = Array.isArray(index.column) ? index.column : [index.column];
        columns.forEach(column => {
          if(!tables[tableName][column] || column==='index' || column==='notNull') throw new Error(`The index entry ${column} doesn't match any column in table ${tableName}.`);
        });
        //check length
        if(index.length) {
          const lengths = Array.isArray(index.length) ? index.length : [index.length];
          lengths.forEach((length, i) => {
            //Check that the length is a number
            if(isNaN(length)) throw new Error(`The length value ${length} in the index entry from table ${tableName} must be a number, but it was ${toType(length)}.`);
            //Check that the index length is not wider than the column length
            if(tables[tableName][columns[i]].length && length > tables[tableName][columns[i]].length) throw new Error(`The length for column ${columns[i]} for index ${index.column} is larger than the length of the column specified in the table ${tableName}.`);
          });
        }
        //check type
        if(index.type && !indexTypes.includes(index.type)) throw new Error(`The type of an index must belong to ${indexTypes} in table ${tableName}. We received: ${index.type}.`);
      });
    }

    //Check notNull field
    else if(field==='notNull') {
      if(!Array.isArray(value)) throw new Error(`Field 'notNull' in ${tableName} must be an array containing a list of string denoting the columns that should not accept null as a value.`);
      value.forEach(column => {
        if(!tables[tableName][column] && column!=='index' && column!=='notNull') throw new Error(`Column ${column} was referenced inside of field 'notNull' in table ${tableName} but it doen't exist in that table.`);
        if(/** @type {import('./utils').Column} */(tables[tableName][column]).notNull===false) throw new Error(`Column ${column} in table ${tableName} is marked both as nullable and notNull.`);
      });
    }

    //Check columns name
    else if(Object.keys(tables).includes(field)) throw new Error(`Field ${field} in ${tableName} cannot have the same name as a table.`);
    
    //Check columns value
    else if(Object(value) instanceof String) {
      const [type, length] = value.split('/');
      return checkConsistency({type, length});
    } else if(Array.isArray(value)) {
      if(value.length!==1) throw new Error(`${field} in ${tableName} is an array and should contain only one element which should be pointing to another table`);
      //We now check that the table object is correctly defined and reference another table
      return checkField(tableName, `${field}[]`, value[0]);
    } else if(value instanceof Object) {
      //reference to another table
      if(Object.values(tables).includes(value)) return;
      //a descriptive object describing the column properties
      try {
        check(dbColumn, value);
      } catch(err) {
        throw new Error(`${field} in ${tableName} received an invalid object. It should be a string, an array, a descriptive object containing a 'type' property', or one of the tables. ${err}`);
      }
      return checkConsistency(value);
    } else if(value === undefined) {
      throw new Error(`${field} has undefined value in ${tableName}. It should be a string, an array or an object. If you tried to make a self reference or a cross reference between tables, see the documentation.`);
    } else {
      throw new Error(`${value} is an invalid value for ${field} in ${tableName}. It should be a string, an array or an object`);
    }
  }
}

/**
 * Check that the database information are valid
 * @param {import('./database').Database} data The database configuration
 * @throws Throws an error if the database configuration is incorrect
 **/
function checkDatabase(data) {
  try {
    check(database, data);
  } catch(err) {
    throw `The database object provided is incorrect. ${err}`;
  }
}

/**
 * Check that the rules are valid
 * @param {import('./accessControl').Rules} rules The rules to check
 * @param {import('./utils').TablesDeclaration} tables The tables as they were declared
 **/
function checkRules(rules, tables) {

  /**
   * Ensure that a rule is valid for a table.
   * @param {import('./accessControl').ColumnRule} value The rule to analyse 
   * @param {('read' | 'write' | 'add' | 'remove')[]} possibleValues The instructions that can be restricted
   * @param {string} column The rule being studied
   * @throws Throws an error if the rule doesn't respect the schema of a Rule
   */
  function checkRule(value, possibleValues, column) {
    try {
      return check(possibleValues.reduce((model, key) => ({...model, [key] : 'function'}), {strict: true}), value);
    } catch(err) {
      throw new Error(`We expect rule ${column} to receive function parameters for keys ${JSON.stringify(possibleValues)}, but we received ${stringify(value)}`);
    }
  }
  Object.keys(rules).forEach(key => {
    const table = tables[key];
    if(!table) throw new Error(`You defined a rule for table ${key} which is not defined.`);
    const { primitives, objects, arrays } = classifyData(table);
    const rule = rules[key];
    
    Object.keys(rule).forEach(column => {
      const value = rule[column];
      if(table[column]) {
        if(primitives.includes(column)) return checkRule(value, ['read', 'write'], column);
        if(objects.includes(column)) return checkRule(value, ['read', 'write'], column);
        if(arrays.includes(column)) return checkRule(value, ['add', 'remove'], column);
        throw new Error(`This should not be possible. The issue occured with the rule ${column} for table ${key}.`);
      } else {
        const instructions = ['read', 'write', 'create', 'delete'];
        if(!instructions.includes(column)) throw new Error(`You defined a rule for ${column} which is not defined in the table ${key}`);
        if(value instanceof Function) return;
        throw new Error(`The rule ${column} for table ${key} has to be a function.`);
      }
    });
  });
    
  //Make sure that all tables have access rules
  Object.keys(tables).forEach(table => {
    if(!rules[table]) throw new Error(`You need to provide access rules for table ${table}. Please see "Control Access" section in the documentation.`);
  });
}

/**
 * Check that all provided plugins are well formed.
 * @param {import('./plugins').Plugin[]} plugins The list of the plugins to check
 * @param {import('./utils').TablesDeclaration} tables The tables as they were declared
 * @throws Throws an error if one of the plugin doesn't meet its prerequisite
 **/
function checkPlugins(plugins, tables) {
  const pluginKeys = ['middleware', 'onRequest', 'onProcessing', 'onCreation', 'onDeletion', 'onResult', 'onUpdate', 'onListUpdate', 'onError', 'onSuccess', 'preRequisite', 'errorHandler'];
  if(!Array.isArray(plugins)) throw new Error(`plugins should be an array. But we received ${JSON.stringify(plugins)}.`);
  plugins.forEach(plugin => {
    Object.keys(plugin).forEach(key => {
      if(!pluginKeys.includes(key)) throw new Error(`Plugins can only contain these functions: ${pluginKeys}, but we found ${key}.`);
      if(key === 'middleware') {
        if(!(plugin[key] instanceof Function)) throw new Error(`${key} should be a function in your plugin. But we received ${JSON.stringify(plugin[key])}.`);
      } else {
        //case preprocessing and postprocessing
        if(!(plugin[key] instanceof Object)) throw new Error(`${key} should be an object in your plugin. But we received ${JSON.stringify(plugin[key])}.`);
        Object.keys(plugin[key]).forEach(table => {
          if(!Object.keys(tables).includes(table)) throw new Error(`${table} is not one of the defined tables. ${key} should only contains existing tables as keys.`);
          if(!(plugin[key][table] instanceof Function)) throw new Error(`${table} is not a function. ${key} should only contains functions as values.`);
        });
      }
    });
  });
}

/**
 * @typedef {Object} SimpleQLParams
 * @property {import('./utils').TablesDeclaration} tables 
 * @property {import('./database').Database} database
 * @property {import('./accessControl').Rules} rules
 * @property {import('./plugins').Plugin[]} plugins
 */

/**
 * Check that the simpleQL parameters are valid
 * @param {SimpleQLParams} simplqlParams The object to check
 */
module.exports = ({tables, database, rules, plugins}) => {
  try {
    checkTables(tables);
    checkDatabase(database);
    checkRules(rules, tables);
    checkPlugins(plugins, tables);
    return Promise.resolve();
  } catch(err) {
    return Promise.reject(err);
  }
};