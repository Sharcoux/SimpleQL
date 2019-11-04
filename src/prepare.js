const { classifyData } = require('./utils');
const { none } = require('./accessControl');

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
            else throw new Error(`The value ${value} for index of table ${table.tableName} could not be interpreted, nor as a type, nor as a column, nor as a length. Check the documentation.`);
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
    primitives.forEach(key => {
      const data = table[key];
      //Parse the short string data type
      if(Object(data) instanceof String) {
        const [type, length] = data.split('/');
        acc[tableName][key] = { type, length };
      } else {
        acc[tableName][key] = data;
      }
    });
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

    if(table.index) table.index.forEach(elt => {
      if(!elt.column) throw new Error(`An index entry doesn't precise any column to refer to in table ${tableName}.`);
      const column = acc[tableName][elt.column];
      if(!column) throw new Error(`The index entry ${elt.column} doesn't match any column in table ${tableName}.`);
      if(elt.length && column.length && elt.length>column.length) throw new Error(`The length for index ${elt.column} is larger than the length of the column specified in the table ${tableName}.`)
    });

    return acc;
  }, {});
}

/**
 * Preconfigure rules functions with database configuration
 * (works by side effects, editing directly the rules object)
 */
function prepareRules({rules, tables}) {
  Object.keys(rules).forEach(tableName => {
    const tableRules = rules[tableName];
    function partialApplication(rule, propName) {
      if(!(rule instanceof Function)) throw new Error(`Rules should be functions in table ${tableName} for ${propName}.`);
      const result = rule({tables, tableName});
      if(!(result instanceof Function)) throw new Error(`Rules should be functions that return a function in table ${tableName} for ${propName}.`);
      return result;
    }
    //Prepare the provided rules
    Object.keys(tableRules).forEach(key => {
      //Prepare table level rules
      if(['read', 'write', 'create', 'delete'].includes(key)) tableRules[key] = partialApplication(tableRules[key], key);
      //Prepare column level rules
      else {
        const columnRules = tableRules[key];
        Object.keys(columnRules).forEach(k => {
          const validKeys = ['read', 'write', 'add', 'remove'];
          if(validKeys.includes(k)) columnRules[k] = partialApplication(columnRules[k], key+'.'+k);
          else throw new Error(`The value of ${key} in ${tableName} can only contain the following keys: ${validKeys.join(', ')}. ${k} is not accepted.`);
        });
      }
    });
    //Add a 'none' rule for reservedId
    tableRules.reservedId = partialApplication(none, 'reservedId');
  });
}

module.exports = {
  prepareTables, //Prepare the tables and returns the associated dataModel
  prepareRules,  //Prepare the rules with the database configuration
};