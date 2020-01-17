/** This file contains functions to check the validity of the parameters provided to simple-ql */
const check = require('./utils/type-checking');
const { dbColumn, database } = require('./utils/types');
const { stringify, classifyData, reservedKeys, toType } = require('./utils');

/** Check that the tables that are going to be created are valid */
function checkTables(tables) {
  const acceptedTypes = ['string', 'integer', 'float', 'double', 'decimal', 'date', 'dateTime', 'time', 'year', 'boolean', 'char', 'text', 'binary', 'varbinary', 'varchar', 'json', ];
  const lengthRequired = ['char', 'binary', 'decimal', 'varchar', 'srting'];
  const numeric = ['integer', 'float', 'decimal', 'double'];
  const indexTypes = ['unique', 'fulltext', 'spatial'];
  //check values
  return Promise.all(Object.keys(tables).map(tableName => {
    const table = tables[tableName];
    return Promise.all(reservedKeys.map(field => (field!=='index' && table[field]) ? Promise.reject(`${field} is a reserved field`) : Promise.resolve()))
      .then(() => Promise.all(Object.keys(table).map(field => checkField(tableName, field, table[field]))));
  }));

  /** Check that the field value is valid */
  function checkField(tableName, field, value) {
    function checkConsistency({type, length, unsigned, notNull, defaultValue}) {

      //Is the type supported
      if(!acceptedTypes.includes(type)) return Promise.reject(`${value} is invalid value for ${field} in ${tableName}. Valid types are: ${acceptedTypes.join(', ')}`);
      //Is the length required and provided
      if(lengthRequired.includes(type) && !length) return Promise.reject(`${field} column of type ${type} requires a length parameter in ${tableName}`);
      //Is the type numeric when unsigned is provided
      if(!numeric.includes(type) && unsigned) return Promise.reject(`column ${field} is of type ${type} which doesn't accept unsigned flag.`);

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
          if(length && parseInt(length,10)!=length) return Promise.reject(`${field} in ${tableName} expected an integer after the / but we reveived ${length}`);
          break;
        }
        case 'double':
        case 'decimal':
        case 'float': {
          if(length) {
            const [s,d] = length.split(',');
            if(!d || parseInt(s,10)!=s || parseInt(d,10)!=d) return Promise.reject(`${field} in ${tableName} expected a decimal parameter like 8,2 but we reveived ${length}`);
          }
          break;
        }
        case 'date':
        case 'dateTime':
        case 'time':
        case 'year': {
          if(length) return Promise.reject(`${field} in ${tableName} received the parameter ${length} but we didn't expect one.`); 
          break;
        }
        default:
          return Promise.reject(`We received the type ${type} for ${field} in ${tableName} but it is not recognized.`); 
      }

      //We check if notNull is set when defaultValue is null
      if(defaultValue===null && notNull===true) return Promise.reject(`The default value is null whereas the notNull flag is set to true in field ${field} in table ${tableName}.`);
    }

    if(field==='index') {
      if(!Array.isArray(value)) return Promise.reject(`Field 'index' in ${tableName} must be an array containing objects where keys are 'column', 'type' and 'length', or a string separing these values with a '/'.`);
      return Promise.all(value.map(v => {
        let index;
        if((Object(v) instanceof String)) {
          index = {};
          v.split('/').forEach(p => {
            let type;
            if(indexTypes.includes(p)) type = 'type';
            else if(!isNaN(p)) type = 'length';
            else if(tables[tableName][p] && p!=='index') type = 'column';
            else return Promise.reject(`Value ${p} for index ${v} in table ${tableName} didn't match any column, nor denoted a length, nor was a type (unique, fulltext, spacial).`);
            if(index[type]) return Promise.reject(`The value ${p} was supposed to be a ${type} for table ${tableName}, but we already have the value ${index[type]}.`);
            index[type] = p;
          });
        } else {
          index = v;
        }
        //Check column
        if(!index.column) return Promise.reject(`The index entry ${stringify(index)} doesn't precise any column to refer to in table ${tableName}.`);
        if(!Array.isArray(index.column) && !(Object(index.column) instanceof String)) return Promise.reject(`The column ${index.column} of an index entry from table ${tableName} must contains a String or an array of Strings.`);
        if(Array.isArray(index.column) && !index.column.every(c => Object(c) instanceof String)) return Promise.reject(`The column ${stringify(index.column)} of an index entry from table ${tableName} must contains a String or an array of Strings.`);
        //check length
        if(index.length && isNaN(index.length)) return Promise.reject(`The length value ${index.length} in the index entry from table ${tableName} must be a number, but it was ${toType(index.length)}.`);
        //check type
        if(index.type && !indexTypes.includes(index.type)) return Promise.reject(`The type of an index must belong to ${indexTypes} in table ${tableName}. We received: ${index.type}.`);
      }));
    }
    if(Object.keys(tables).includes(field)) return Promise.reject(`Field ${field} in ${tableName} cannot have the same name as a table.`);
    if(Object(value) instanceof String) {
      const [type, length] = value.split('/');
      return checkConsistency({type, length});
    } else if(Array.isArray(value)) {
      if(value.length!==1) return Promise.reject(`${field} in ${tableName} is an array and should contain only one element which whould be pointing to another table`);
      //We now check that the table object is correctly defined and reference another table
      return checkField(tableName, `${field}[]`, value[0]);
    } else if(value instanceof Object) {
      //reference to another table
      if(Object.values(tables).includes(value)) return Promise.resolve();
      //a descriptive object describing the column properties
      try {
        check(dbColumn, value);
      } catch(err) {
        return Promise.reject(`${field} in ${tableName} received an invalid object. It should be a string, an array, a descriptive object containing a 'type' property', or one of the tables. ${err}`);
      }
      return checkConsistency(value);
    } else if(value === undefined) {
      return Promise.reject(`${field} has undefined value in ${tableName}. It should be a string, an array or an object. If you tried to make a self reference or a cross reference between tables, see the documentation.`);
    } else {
      return Promise.reject(`${value} is an invalid value for ${field} in ${tableName}. It should be a string, an array or an object`);
    }
  }
}

/** Check that the database information are valid */
function checkDatabase(data) {
  try {
    check(database, data);
  } catch(err) {
    throw `The database object provided is incorrect. ${err}`;
  }
}

/** Check that the rules are valid */
function checkRules(rules, tables) {
  function checkRule(value, possibleValues, ruleName) {
    try {
      return check(possibleValues.reduce((model, key) => ({...model, [key] : 'function'}), {strict: true}), value);
    } catch(err) {
      throw new Error(`We expect rule ${ruleName} to receive function parameters for keys ${JSON.stringify(possibleValues)}, but we received ${stringify(value)}`);
    }
  }
  return Promise.all(Object.keys(rules).map(key => {
    const table = tables[key];
    if(!table) return Promise.reject(`You defined a rule for table ${key} which is not defined.`);
    const { primitives, objects, arrays } = classifyData(table);
    const rule = rules[key];
    
    return Promise.all(Object.keys(rule).map(ruleName => {
      const value = rule[ruleName];
      if(table[ruleName]) {
        if(primitives.includes(ruleName)) return checkRule(value, ['read', 'write'], ruleName);
        if(objects.includes(ruleName)) return checkRule(value, ['read', 'write'], ruleName);
        if(arrays.includes(ruleName)) return checkRule(value, ['add', 'remove'], ruleName);
        return Promise.reject(`This should not be possible. The issue occured with the rule ${ruleName} for table ${key}.`);
      } else {
        const instructions = ['read', 'write', 'create', 'delete'];
        if(!instructions.includes(ruleName)) return Promise.reject(`You defined a rule for ${ruleName} which is not defined in the table ${key}`);
        if(value instanceof Function) return Promise.resolve();
        return Promise.reject(`The rule ${ruleName} for table ${key} has to be a function.`);
      }
    }));
  }))
    
    //Make sure that all tables have access rules
    .then(() => Promise.all(Object.keys(tables).map(
      table => rules[table] || Promise.reject(`You need to provide access rules for table ${table}. Please see "Control Access" section in the documentation.`)
    )));
}

/** Check that all provided plugins are well formed. */
function checkPlugins(plugins, tables) {
  const pluginKeys = ['middleware', 'onRequest', 'onProcessing', 'onCreation', 'onDeletion', 'onResult', 'onError', 'onSuccess', 'preRequisite', 'errorHandler'];
  if(!Array.isArray(plugins)) return Promise.reject(`plugins should be an array. But we received ${JSON.stringify(plugins)}.`);
  return Promise.all(plugins.map(plugin => {
    return Promise.all(Object.keys(plugin).map(key => {
      if(!pluginKeys.includes(key)) return Promise.reject(`Plugins can only contain these functions: ${pluginKeys}, but we found ${key}.`);
      if(key === 'middleware') {
        if(!(plugin[key] instanceof Function)) return Promise.reject(`${key} should be a function in your plugin. But we received ${JSON.stringify(plugin[key])}.`);
      } else {
        //case preprocessing and postprocessing
        if(!(plugin[key] instanceof Object)) return Promise.reject(`${key} should be an object in your plugin. But we received ${JSON.stringify(plugin[key])}.`);
        return Promise.all(Object.keys(plugin[key]).map(table => {
          if(!Object.keys(tables).includes(table)) return Promise.reject(`${table} is not one of the defined tables. ${key} should only contains existing tables as keys.`);
          if(!(plugin[key][table] instanceof Function)) return Promise.reject(`${table} is not a function. ${key} should only contains functions as values.`);
        }));
      }
    }));
  }));
}

module.exports = ({tables, database, rules, plugins}) => {
  return checkTables(tables)
    .then(() => checkDatabase(database))
    .then(() => checkRules(rules, tables))
    .then(() => checkPlugins(plugins, tables));
};