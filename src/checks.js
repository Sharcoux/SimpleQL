/** This file contains functions to check the validity of the parameters provided to simple-ql */
const { reservedKeys } = require('./database');

/** Check that the tables that we are going to create are valid */
function checkTables(tables) {
  const acceptedTypes = ['string', 'integer', 'float', 'double', 'decimal', 'date', 'dateTime', 'boolean', 'text', 'binary'];
  const forbiddenNames = ['login', 'password', 'token'];

  //check keys
  if(Object.keys(tables).find(key => forbiddenNames.includes(key))) return Promise.reject(`Tables name cannot belong to ${forbiddenNames.join(', ')}`);
  //check values
  return Promise.all(Object.keys(tables).map(tableName => {
    const table = tables[tableName];
    return Promise.all(reservedKeys.map(field => table[field] ? Promise.reject(`${field} is a reserved field`) : Promise.resolve()))
      .then(() => Promise.all(Object.keys(table).map(field => checkField(tableName, field, table[field]))));
  }));

  /** Check that the field value is valid */
  function checkField(tableName, field, value) {
    if(field==='index') {
      if(!(value instanceof Object)) return Promise.reject(`Field 'index' in ${tableName} must be an object where keys are the columns, and value can be 'unique' or undefined`);
      return Promise.resolve();
    }
    if(Object.keys(tables).includes(field)) return Promise.reject(`Field ${field} in ${tableName} cannot have the same name as a table.`);
    if(Object(value) instanceof String) {
      const [type, size] = value.split('/');
      if(!acceptedTypes.includes(type)) return Promise.reject(`${value} is invalid value for ${field} in ${tableName}. Valid types are: ${acceptedTypes.join(', ')}`);
      if(!size) return Promise.resolve();
      //We check for each type that the size property is valid
      switch(type) {
        case 'boolean':
        case 'integer':
        case 'string':
        case 'binary':
        case 'text': {
          if(parseInt(size,10)!=size) return Promise.reject(`${field} in ${tableName} expected an integer after the / but we reveived ${size}`);
          break;
        }
        case 'double':
        case 'decimal':
        case 'float': {
          const [s,d] = size.split(',');
          if(!d || parseInt(s,10)!=s || parseInt(d,10)!=d) return Promise.reject(`${field} in ${tableName} expected a decimal parameter like 8,2 but we reveived ${size}`);
          break;
        }
        default:
          return Promise.reject(`${field} in ${tableName} received the parameter ${size} but we didn't expect one.`); 
      }
    } else if(value instanceof Array) {
      if(value.length!==1) return Promise.reject(`${field} in ${tableName} is an array and should contain only one element which whould be pointing to another table`);
      //We now check that the table object is correctly defined and reference another table
      return checkField(tableName, `${field}[]`, value[0]);
    } else if(value instanceof Object) {
      //reference to another table
      if(Object.values(tables).includes(value)) return Promise.resolve();
      //a descriptive object describing the column properties
      if(!value.hasOwnProperty('type')) return Promise.reject(`${field} in ${tableName} received an invalid object. It should be a string, an array, a descriptive object containing a 'type' property', or one of the tables`);
      if(value.length && isNaN(value.length)) return Promise.reject(`${field} in ${tableName} is expected to be a number but ê received ${value}`);
      if(value.unsigned && value.)) return Promise.reject(`${field} in ${tableName} is expected to be a number but ê received ${value}`);
      return checkField(tableName, field, value.type);
    } else if(value === undefined) {
      return Promise.reject(`${field} has undefined value in ${tableName}. It should be a string, an array or an object. If you tried to make a self reference or a cross reference between tables, see the documentation.`);
    } else {
      return Promise.reject(`${value} is an invalid value for ${field} in ${tableName}. It should be a string, an array or an object`);
    }
    return Promise.resolve();
  }
}

/** Check that the database information are valid */
function checkDatabase(data) {
  function check(key, value) {
    return (value && Object(value) instanceof String)
      ? Promise.resolve()
      : Promise.reject(`database.${key} is required to be a string`);
  }
  return Promise.all(['user', 'password', 'host', 'database'].map(key => check(key, data[key])));
}

/** Check that the rules are valid */
function checkRules(rules, tables) {
  return Promise.all(Object.keys(rules).map(key => {
    if(!tables[key]) return Promise.reject(`You defined a rule for table ${key} which is not defined.`);
    const rule = rules[key];
    function check(k, object) {
      const instructions = ['read', 'write', 'create', 'delete'];
      if(instructions.includes(k)) {
        //Ruling objects from this table
        if(object instanceof Function) return Promise.resolve();
        if(object instanceof Array && object.length>0 && !object.find(f => !(f instanceof Function))) return Promise.resolve();
        return Promise.reject(`The field ${k} expect a function or an array of functions but received ${object}`);
      } else if(Object.keys(tables[key]).includes(k)) {
        //Ruling one column of the table
        if(!(object instanceof Object)) return Promise.reject(`We expect an object for field ${k} in ${key} but received ${object}`);
        return Promise.all(Object.keys(object).map(r => check(r, object[r])));
      } else {
        //Ruling something that doesn't exist
        return Promise.reject(`You defined a rule for ${k} which is not defined in the table ${key}`);
      }
    }
    return Promise.all(Object.keys(rule).map(k => check(k, rule[k])));
  }));
}

module.exports = (tables, database, rules) => {
  return checkTables(tables)
    .then(() => checkDatabase(database))
    .then(() => checkRules(rules, tables));
};