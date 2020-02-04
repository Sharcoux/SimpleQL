/** We need to make some treatment to the data provided by the user before being able to create the server */
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
            else if(tables[tableName][value]) result.column = value;
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
      if(acc[tableName].index) {
        acc[tableName].index.forEach(index => {
          //Rewrite the column name for name + Id
          if(Array.isArray(index.column)) {
            const keyIndex = index.column.findIndex(c => c===key);
            if(keyIndex>=0) index.column[keyIndex] = key + 'Id';
          } else if(index.column === key) {
            index.column = key + 'Id';
          }
          //Indexes on object table alone are ignored
          if(index.column === key) throw new Error(`indexes on keys referencing foreign tables will be ignored, except for composite indexes. Please remove index ${key} from table ${tableName}.`);
        });
      }
      //We need to change the notNull columns
      if(table.notNull) {
        table.notNull = table.notNull.map(column => column===key ? key+'Id' : column);
      }
      //We create the foreign key
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
      //arrays cannot be notNull
      if(acc[tableName].notNull && acc[tableName].notNull.includes(key)) throw new Error(`fields denoting an association like ${key} cannot be notNull in table ${tableName}.`);
      //Indexes on array
      const index = acc[tableName].index;
      //If the index denote the association table as being unique, we consider that the table cannot have duplicate entries.
      if(index) {
        if(Array.isArray(index.colum) && index.column.find(c => c===key)) {
          throw new Error(`Multiple indexes cannot contain keys referencing association tables. Please remove ${key} from index ${index} in table ${tableName}.`);
        } else {
          const arrayIndex = index.find(index => index.column === key);
          if(arrayIndex) {
            if(arrayIndex.type && arrayIndex.type!=='unique') {
              throw new Error(`Indexes on keys referencing association tables must be of type unique. Please set the type of ${key} in the index of table ${tableName} to 'unique', or remove the index.`);
            } else {
              //Association table entries are supposed to be unique
              acc[name].index = [{
                column: [key+'Id', tableName+'Id'],
                type: 'unique',
              }];
              //We remove the index from the original table as it belongs to the association one
              index.splice(index.indexOf(arrayIndex), 1);
            }
          }
        }
      }
    });

    //Set the notNull attribute for each column
    if(table.notNull) {
      table.notNull.forEach(column => acc[tableName][column].notNull = true);
    }

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