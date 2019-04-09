const { classifyData } = require('./utils');

/** transform tables into sql data types and add a tableName property to each table. Returns the tableModel generated
 * author = User is transformed into authorId = 'integer/10';
 * contacts = [User] creates a new table contactsUser = {userId : 'integer/10', contactsId : 'integer/10'}
*/
function prepareTables(tables) {
  //We add the table name into each table data
  Object.keys(tables).forEach(tableName => tables[tableName].tableName = tableName);
  //We add the reservedId props
  const reservedId = {type : 'integer', length: 10, unsigned: true, autoIncrement : true};
  Object.keys(tables).forEach(tableName => tables[tableName].reservedId = reservedId);
  //We transform the tables into a valid data model
  return Object.keys(tables).reduce((acc, tableName) => {
    const table = tables[tableName];
    const { empty, primitives, objects, arrays } = classifyData(table);
    console.log(tableName, primitives);

    if(empty.length) throw new Error(`The fields ${empty.join(', ')} do not have a value.`);
    acc[tableName] = {}; //Create table entry

    //Add the indexes
    if(table.index) acc[tableName].index = table.index;
    //We need to remove 'index' from the objects
    objects.splice(objects.indexOf('index', 1));
    //Add primitives constraints
    primitives.forEach(key => acc[tableName][key] = table[key]);
    //Transforme author = User into authorId = 'integer/10';
    objects.forEach(key => {
      acc[tableName][key+'Id'] = {
        type: 'integer',
        length : 10,
        unsigned : true,
      };
      //We need to change the index accordingly
      if(acc[tableName].index && acc[tableName].index.hasOwnProperty(key)) {
        throw new Error(`indexes on keys referencing foreign tables will be ignored. Please remove index ${key} from table ${tableName}.`);
        // acc[tableName].index[key+'Id'] = acc[tableName].index[key];
        // delete acc[tableName].index[key];
      }
      acc[tableName].foreignKeys = {
        [key+'Id'] : table[key].tableName,
      };
    });
    //Create an association table. contacts = [User] creates a map contactsUser = {userId : 'integer/10', contactsId : 'integer/10'}
    arrays.forEach(key => {
      const name = key+tableName;
      acc[name] = {
        reservedId,
        [tableName+'Id'] : {
          type: 'integer',
          length : 10,
          unsigned : true,
        },
        [key+'Id']: {
          type: 'integer',
          length : 10,
          unsigned : true,
        },
        foreignKeys: {
          [tableName+'Id'] : tableName,
          [key+'Id'] : table[key][0].tableName,
        },
      };
    });
    return acc;
  }, {});
}

/**
 * Preconfigure rules functions with database configuration
 */
function prepareRules({rules, tables, privateKey, query}) {
  Object.keys(rules).forEach(tableName => {
    const value = rules[tableName];
    function partialApplication(rule, propName) {
      if(rule instanceof Function) {
        const result = rules({tables, table: tables[tableName], privateKey, query});
        if(!(result instanceof Function)) throw new Error(`Rules should be functions that return a function in table ${tableName} for ${propName}.`);
        return result;
      } else {
        Object.keys(value).forEach(key => value[key] = partialApplication(value[key], propName+'.'+key));
        return rule;
      }
    }
    Object.keys(value).forEach(key => value[key] = partialApplication(value[key], key));
  });
}

module.exports = {
  prepareTables, //Prepare the tables and returns the associated dataModel
  prepareRules,  //Prepare the rules with the database configuration
};