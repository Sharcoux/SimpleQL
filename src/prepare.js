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

    //We transform the short index string form into the object one
    if(table.index) {
      table.index = table.index.map(elt => {
        if(Object(elt) instanceof String) {
          const details = elt.split('/');
          return details.reduce((result, value) => {
            //Index length
            if(!isNaN(value)) result.length = Number.parseInt(value, 10);
            //Index column name
            else if(primitives.includes(value)) result.column = value;
            //Index type
            else if(['unique', 'fulltext', 'spatial'].includes(value)) result.type = value;
            else throw new Error(`The value ${value} for index of table ${table} could not be interpreted, nor as a type, nor as a column, nor as a length. Check the documentation.`);
            return result;
          }, {});
        } else return elt;
      });
    }

    if(empty.length) throw new Error(`The fields ${empty.join(', ')} do not have a value.`);
    acc[tableName] = {}; //Create table entry

    //Add the indexes
    if(table.index) acc[tableName].index = table.index;
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
      if(acc[tableName].index && acc[tableName].index.find(index => index.column === key)) {
        // const index = acc[tableName].index.find(index => index.column === key);
        // if(index) index.column = key+'Id';
        throw new Error(`indexes on keys referencing foreign tables will be ignored. Please remove index ${key} from table ${tableName}.`);
      }
      acc[tableName].foreignKeys = {
        [key+'Id'] : table[key].tableName,
      };
    });
    //Create an association table. contacts = [User] creates a map contactsUser = {userId : 'integer/10', contactsId : 'integer/10'}
    arrays.forEach(key => {
      const name = key+tableName;
      if(acc[tableName].index && acc[tableName].index.find(index => index.column === key)) {
        throw new Error(`indexes on keys referencing foreign tables will be ignored. Please remove index ${key} from table ${tableName}.`);
      }
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
        //Association table entries are supposed to be unique
        index: [
          {
            column: [key+'Id', tableName+'Id'],
            type: 'unique',
          }
        ]
      };
    });
    return acc;
  }, {});
}

/**
 * Preconfigure rules functions with database configuration
 * (works by side effects, editing directly the rules object)
 */
function prepareRules({rules, tables, privateKey}) {
  Object.keys(rules).forEach(tableName => {
    const value = rules[tableName];
    function partialApplication(rule, propName) {
      if(rule instanceof Function) {
        const result = rule({tables, tableName, privateKey});
        if(!(result instanceof Function)) throw new Error(`Rules should be functions that return a function in table ${tableName} for ${propName}.`);
        return result;
      } else {
        Object.keys(rule).forEach(key => rule[key] = partialApplication(rule[key], propName+'.'+key));
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