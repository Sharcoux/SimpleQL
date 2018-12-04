const readline = require('readline');
const { isPrimitive, restrictContent } = require('./utils');
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST } = require('./errors');

class Database {
  constructor(tables, tablesModel, driver, rules) {
    this.tables = tables;
    this.driver = driver;
    this.rules = rules;
    this.tablesModel = tablesModel;

    this.findInTable = this.findInTable.bind(this);
  }
  /**
   * Resolve a full simple-QL request
   * @param {String} rId The requester identifier to determine access rights
   * @param {Object} request The full request
   * @returns {Object} The full result of the request
   */
  request(rId, request) {
    //We keep only the requests where objects requested are described inside a table
    const keys = Object.keys(request).filter(key => this.tables[key]);
    //We start a transaction to resolve the request
    return this.driver.startTransaction()
    //We look for objects in each table
      .then(() => Promise.all(keys.map(key => this.findInTable(rId, key, request[key]))))
      //We resolve the request and commit all the changes made to the database
      .then(results => {
        this.driver.commit();
        return results;
      })
      //We rollback all the changes made to the database
      .catch(err => {
        this.driver.rollback();
        return Promise.reject(err);
      });

  }
  /**
   * Resolve the provided local request for the specified table.
   * @param {String} rId the authorisation id determining rights
   * @param {String} tableName the name of the table to look into
   * @param {Object} request the request relative to that table
   * @returns {Object} The result of the local (partial) request
   */
  findInTable(rId, tableName, request) {
    if(!request) return Promise.reject({
      type: BAD_REQUEST,
      message: `The request was ${request} in table ${tableName}`,
    });
    //If an array is provided, we concatenate the results of the requests
    if(request instanceof Array) {
      return Promise.all(request.map(part => this.findInTable(rId, tableName, part)))
        .then(results => results.flatten())
        //Removes duplicates
        //TODO make sure that the properties are ordered the same for JSON.stringify to detect duplicates correctly
        .then(results => [...new Map(results.map(key => [JSON.stringify(key), key]).keys())]);
    }
    
    //create the request helper
    const requestHelper = new RequestHelper({server : this, tableName, rId, request});
    //Resolve the request
    return requestHelper.resolveRequest();
  }
}

function createTables(driver, tables, create) {
  //Create the tables if needed
  const data = prepareTables(tables);
  //We retrieve foreign keys from the prepared table. All tables need to be created before adding foreign keys
  const foreignKeys = Object.keys(data).reduce((acc, tableName) => {
    if(data[tableName].foreignKeys) acc[tableName] = data[tableName].foreignKeys;
    delete data[tableName].foreignKeys;
    return acc;
  }, {});
  if(create) return Promise.all(Object.keys(data).map(tableName => {
    //We retrieve tables indexes from the prepared table
    const index = data[tableName].index;
    delete data[tableName].index;
    return driver.createTable({table: tableName, data: data[tableName], index});
  })).then(() => driver.createForeignKeys(foreignKeys)).then(() => data);
  console.log('\x1b[202m%s\x1b[0m', 'The "create" property was not set in the "database" object. Skipping tables creation.');
  return Promise.resolve(data);
}

/** transform tables into sql data types
 * author = User is transformed into authorId = 'integer/10';
 * contacts = [User] creates a new table contactsUser = {userId : 'integer/10', contactsId : 'integer/10'}
*/
function prepareTables(tables) {
  //We add the table name into each table data
  Object.keys(tables).forEach(tableName => tables[tableName].tableName = tableName);
  //We transform the tables into a valid data model
  return Object.keys(tables).reduce((acc, tableName) => {
    const table = tables[tableName];
    const { search, primitives, objects, arrays } = classifyData(table);

    if(search.length) throw new Error(`The fields ${search.join(', ')} do not have a value.`);
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

/** Classify the object props into 5 arrays:
 * - search : keys whose value is present but undefined
 * - reserved : reserved keys having special meaning
 * - primitives : keys whose value is a primitive
 * - arrays : keys whose value is an array
 * - objects : keys whose value is an object which is not an array
 */
function classifyData(object) {
  const keys = Object.keys(object);
  const {reserved, constraints, search} = keys.reduce((acc, key) => {
    if(reservedKeys.includes(key)) {
      acc.reserved.push(key);
    } else if(object[key]!==undefined) {
      acc.constraints.push(key);
    } else {
      acc.search.push(key);
    }
    return acc;
  }, {reserved: [], constraints: [], search: []});
  const {primitives, objects, arrays} = constraints.reduce(
    (acc,key) => {
      const value = object[key];
      const belongs = isPrimitive(value) ? 'primitives' : value instanceof Array ? 'arrays' : 'objects';
      acc[belongs].push(key);
      return acc;
    },
    {primitives: [], objects: [], arrays: []}
  );
  return {
    search, reserved, primitives, objects, arrays
  };
}

/** Classify request fields of a request inside a table into 4 categories
 * - request : the request restricted to only the fields defined in the tables
 * - search : keys whose value is present but undefined
 * - primitives : keys which are a column of the table
 * - objects : keys that reference an object in another table (key+'Id' is a column inside the table) 
 * - arrays : keys that reference a list of objects in another table (through an association table named key+tableName)
 * We also update the request if it was "*"
 */
function classifyRequestData(request, table) {
  const tableData = classifyData(table);

  //We allow using '*' to mean all columns
  if(request==='*') request = tableData.primitives.reduce((acc, key) => {acc[key] = undefined;return acc;}, {});
  const requestData = Object.keys(request).reduce((acc, key) => {
    request[key]==='undefined' ? acc.search.push(key) : acc.constraints.push(key);
    return acc;
  }, {search: [], constraints: []});

  //We restrict the request to only the field declared in the table
  const search = restrictContent(requestData.search, tableData.primitives);//undefined fields of the request that appear in the table
  Object.keys(tableData).forEach(key => tableData[key] = restrictContent(tableData[key], requestData.constraints));//constraints defined by the request within the table
  const { primitives, objects, arrays } = tableData;
  return { request, search, primitives, objects, arrays };
}

function createWhereClause(source, primitives, objects) {
  const where = {};
  primitives.forEach(key => where[key] = source[key]);
  objects.forEach(key => where[key+'Id'] = source[key]);
}

/** Load the driver according to database type, and create the database connection, and the database itself if required */
function createDatabase(tables, database, rules) {
  //Make sure that we really intend to erase previous database
  //TODO check if the database already did exist
  return Promise.resolve().then(() => {
    if(database.create) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      return new Promise((resolve, reject) =>
        rl.question(`Are you sure that you wish to completely erase any previous database called ${database} (y/N)\n`, answer => {
          rl.close();
          answer==='y' ? resolve() : reject('If you don\'t want to erase the database, remove the "create" property from the "database" object.');
        })
      );
    }
  })
    .then(() => {
      //Load the driver dynamically
      const createDriver = require(`./drivers/${database.type}`);
      if(!createDriver) return Promise.reject(`${database.type} is not supported right now. Try mysql for instance.`);
      //create the server
      return createDriver(database)
        .then(driver => createTables(driver, tables, database.create)
          .then(tablesModel => new Database(tables, tablesModel, driver, rules)));
    });
}

/** This will let you handle a request workflow to a table */
class RequestHelper {
  constructor({server, tableName, rId, request: initialRequest}) {
    this.server = server;
    this.table = server.tables[tableName];
    this.tableName = tableName;
    this.rId = rId;
    //Classify the request into the elements we will need
    const {request, search, primitives, objects, arrays} = classifyRequestData(initialRequest, this.table);
    this.request = request;
    this.search = search;
    this.primitives = primitives;
    this.objects = objects;
    this.arrays = arrays;
    //We will store here the information gathered about children into the database
    this.resolvedObjects = {};

    this.setResolvedObjects = this.setResolvedObjects.bind(this);
    this.resolveChildrenArrays = this.resolveChildrenArrays.bind(this);
    this.queryDatabase = this.queryDatabase.bind(this);
    this.resolveRequest = this.resolveRequest.bind(this);
    this.resolveObjects = this.resolveObjects.bind(this);
    this.create = this.create.bind(this);
    this.delete = this.delete.bind(this);
    this.update = this.update.bind(this);
  }

  resolveChildrenArrays(results) {
    return Promise.all(this.arrays.map(key =>
      //We collect data about all the objects in the table
      this.server.findInTable(this.rId, this.table[key][0].tableName, this.request[key])
        //We register the data into resolvedObjects
        .then(arrayData => {
          if(arrayData.length===1) {
            this.resolvedObjects[arrayData[0].reservedId] = arrayData[0];
          } else if(arrayData.length>1) {
            arrayData.forEach(object => this.resolvedObjects[object.reservedId] = object);
          }
          return arrayData;
        })
        //We filter the data to only the data associated to the source in the association table
        .then(arrayData =>
          Promise.all(results.forEach(result => this.server.findInTable(this.rId, key+this.tableName, {
            [this.tableName+'Id'] : result.reservedId,
            [key+'Id'] : arrayData.length===1 ? arrayData[0].reservedId : arrayData.map(data => data.reservedId),
          })
            //We replace ids by the resolved objects
            .then(matches => matches.map(match => match[key+'Id']))
            .then(matchIds => result[key+'Id']=matchIds.map(reservedId => this.resolvedObjects[reservedId]))
          ))
        )
    )).then(() => results);
  }

  queryDatabase() {
    return this.server.driver.get({
      table : this.tableName,
      search : [...this.search, ...this.objects.map(key => key+'Id'), 'reservedId'],//We always want to retrieve the id, at least for arrays constraints
      where : createWhereClause(this.request, this.primitives, this.objects),
      limit : this.request.limit,
      offset : this.request.offset,
    });
  }

  /** Replace ids by the element they denote */
  setResolvedObjects(results) {
    results.forEach(result =>
      this.objects.forEach(key => {
        result[key] = this.resolvedObjects[result[key+'Id']];
        delete result[key+'Id'];
      })
    );
    return results;
  }

  /** Insert elements inside the table if request.create is defined */
  create() {
    if(!this.request.create) return Promise.resolve();
    //TODO gérer les références internes entre créations (un message et un feed par exemple ? un user et ses contacts ?)
    return this.server.driver.create({
      table : this.tableName,
      elements : this.request.create,
    });
  }

  /** Remove elements from the table if request.delete is defined */
  delete() {
    if(!this.request.delete) return Promise.resolve();
    //TODO résoudre les objets
    return this.server.findInTable(this.rId, this.tableName, this.request.delete)
    //We update the server
      .then(results => Promise.all(results.map(result => this.server.driver.delete({
        table : this.tableName,
        elements : {reservedId: result.reservedId},
      }))));
  }

  /** Change the table's values if request.set is defined */
  update(results) {
    if(!this.request.set) return Promise.resolve();
    return this.resolveObjects(this.request.set)
      //Handle object not found
      .catch(err => {
        if(err.type===NOT_FOUND) return Promise.reject({
          type: NOT_SETTABLE,
          message: `We could not find the object supposed to be set for key ${err.key} in ${this.tableName}: ${this.request.set[err.key]}`
        });
        return Promise.reject(err);
      })
      //Handle multiple objects found for one field
      .then(() =>
        this.request.set.forEach(key => this.request.set[key] instanceof Array && Promise.reject({
          type: NOT_UNIQUE,
          message: `We found multiple solutions for setting key ${key} in ${this.tableName}: ${JSON.stringify(this.request.set[key])}`
        }))
      )

      //We update the server
      .then(() => this.server.driver.update({
        table : this.tableName,
        values : this.request.set,
        where : { reservedId : results.map(result => result.reservedId) },
      }));
  }

  /** We look for objects that match the request constraints and store their id into the key+Id property and add the objects into this.resolvedObjects map */
  resolveObjects(request) {
    if(!request) return Promise.resolve();
    const { objects } = classifyRequestData(request, this.table);
    //We resolve the children objects
    return Promise.all(objects.map(key => {
      //Take care of null value
      if(request[key]===null) {
        request[key+'Id'] = null;
        delete request[key];
        return null;
      }
      //We get the children id and define the key+Id property accordingly
      return this.server.findInTable(this.server.driver.privateKey, this.table[key].tableName, request[key]).then(result => {
        if(result.length===0) return Promise.reject({
          type: NOT_FOUND,
          key,
          message: `Nothing found with these constraints : ${this.tableName}->${key}->${JSON.stringify(this.request[key])}`,
        });
        if(result.length===1) {
          this.request[key+'Id'] = result[0].reservedId;
          this.resolvedObjects[result[0].reservedId] = result[0];
        } else {
          this.request[key+'Id'] = result.map(object => object.reservedId);
          result.forEach(object => this.resolvedObjects[object.reservedId] = object);
        }
        delete this.request[key];
      });
    }));
  }

  resolveRequest() {
    //Delete elements from the database if request.delete is set
    return this.delete()
      //Insert elements inside the database if request.create is set
      .then(this.create)
      //resolve children objects
      .then(() => this.resolveObjects(this.request))
      //resolve the request in the database
      .then(this.queryDatabase)
      //Replace ids to resolved objects
      .then(this.setResolvedObjects)
      //Update
      .then(this.update)
      //resolve children arrays data
      .then(this.resolveChildrenArrays)
      //If nothing matches the request, the result should be an empty array
      .catch(err => {
        if(err.type===NOT_FOUND) return Promise.resolve([]);
        console.error(err);
        return Promise.reject(err);
      });
  }
}

const reservedKeys = ['reservedId', 'set', 'delete', 'create', 'not', 'like', 'or', 'limit', 'offset', 'tableName', 'foreignKeys'];

module.exports = {
  classifyRequestData,
  createDatabase,
  reservedKeys,
};