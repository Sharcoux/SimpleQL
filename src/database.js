const readline = require('readline');
const { isPrimitive, restrictContent } = require('./utils');
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED } = require('./errors');

class Database {
  constructor(tables, tablesModel, driver, rules, privateKey) {
    this.tables = tables;
    this.driver = driver;
    this.rules = rules;
    this.tablesModel = tablesModel;
    this.privateKey = privateKey;

    this.findInTable = this.findInTable.bind(this);
    this.applyInTable = this.applyInTable.bind(this);
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
      .then(() => Promise.all(keys.map(key => this.applyInTable(rId, key, request[key]))))
      //We associate back results to each key
      .then(results => keys.reduce((acc, key, index) => {acc[key] = results[index]; return acc;}, {}))
      //We resolve the request and commit all the changes made to the database
      .then(results => this.driver.commit().then(() => results))
      //We rollback all the changes made to the database
      .catch(err => this.driver.rollback().then(() => Promise.reject(err)));
  }
  /**
   * Look for the objects matching the constraints in the request for the specified table.
   * @param {String} rId the authorisation id determining rights
   * @param {String} tableName the name of the table to look into
   * @param {Object} request the request relative to that table
   * @returns {Object} The result of the local (partial) request
   */
  findInTable(rId, tableName, request) {
    return this.applyInTable(rId, tableName, request, true);
  }
  /**
   * Resolve the provided local request for the specified table, including creation or deletion of elements.
   * @param {String} rId the authorisation id determining rights
   * @param {String} tableName the name of the table to look into
   * @param {Object} request the request relative to that table
   * @returns {Object} The result of the local (partial) request
   */
  applyInTable(rId, tableName, request, readOnly = false) {
    if(!request) return Promise.reject({
      type: BAD_REQUEST,
      message: `The request was ${request} in table ${tableName}`,
    });
    //If an array is provided, we concatenate the results of the requests
    if(request instanceof Array) {
      return Promise.all(request.map(part => this.findInTable(rId, tableName, part, readOnly)))
        //[].concat(...array) will flatten array.
        .then(results => [].concat(...results))
        //Removes duplicates
        //TODO make sure that the properties are ordered the same for JSON.stringify to detect duplicates correctly
        .then(results => results.reduce((acc, value) => {
          if(!acc.includes(value)) acc.push(value);
          return acc;
        }, []));
    }
    
    //create the request helper
    const requestHelper = new RequestHelper({server : this, tableName, rId, request, readOnly});
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
    const { empty, primitives, objects, arrays } = classifyData(table);

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
      if(acc[tableName].index || acc[tableName].index.hasOwnProperty(key)) {
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
 * - empty : keys whose value is present but undefined or null
 * - reserved : reserved keys having special meaning
 * - primitives : keys whose value is a primitive
 * - arrays : keys whose value is an array
 * - objects : keys whose value is an object which is not an array
 */
function classifyData(object) {
  const keys = Object.keys(object);
  const {reserved, constraints, empty} = keys.reduce((acc, key) => {
    if(reservedKeys.includes(key)) {
      acc.reserved.push(key);
    } else if(object[key]!==undefined || object[key]!==null) {
      acc.constraints.push(key);
    } else {
      acc.empty.push(key);
    }
    return acc;
  }, {reserved: [], constraints: [], empty: []});
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
    empty, reserved, primitives, objects, arrays
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
  if(request.get==='*') request.get = [...tableData.primitives];
  //We restrict the request to only the field declared in the table
  //fields that we are trying to get info about
  const search = restrictContent(request.get || [], tableData.primitives);
  //constraints for the research
  const [primitives, objects, arrays] = ['primitives', 'objects', 'arrays'].map(key => restrictContent(tableData[key], Object.keys(request)));
  return { request, search, primitives, objects, arrays };
}

function createWhereClause(request, primitives, objects) {
  const where = {};
  primitives.forEach(key => where[key] = source[key]);
  //If resolveObjects succeeded, source[key+'Id'] now contains the id or ids of the resolved object
  objects.forEach(key => where[key+'Id'] = source[key+'Id']);
  return where;
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
          .then(tablesModel => new Database(tables, tablesModel, driver, rules, database.privateKey)));
    });
}

/** This will let you handle a request workflow to a table */
class RequestHelper {
  constructor({server, tableName, rId, request: initialRequest, readOnly}) {
    console.log('treating ', tableName, initialRequest);
    this.server = server;
    this.table = server.tables[tableName];
    this.tableName = tableName;
    this.rId = rId;
    this.readOnly = readOnly;
    //Classify the request into the elements we will need
    const {request, search, primitives, objects, arrays} = classifyRequestData(initialRequest, this.table);
    this.tableData = classifyData(this.table);
    this.request = request;
    this.search = search;
    this.primitives = primitives;
    this.objects = objects;
    this.arrays = arrays;

    //These are the list of editions that happened to the table during the request
    this.deleted = [];
    this.created = [];
    this.modified = [];

    //We will store here the information gathered about children into the database
    this.resolvedObjects = {};

    //Identity function (used to ignore some behaviours in readOnly mode)
    const nothing = result => result;

    this.integrityCheck = this.integrityCheck.bind(this);
    this.resolveRequest = this.resolveRequest.bind(this);
    this.delete = readOnly ? nothing : this.delete.bind(this);
    this.create = readOnly ? nothing : this.create.bind(this);
    this.resolveObjects = this.resolveObjects.bind(this);
    this.queryDatabase = this.queryDatabase.bind(this);
    this.setResolvedObjects = this.setResolvedObjects.bind(this);
    this.update = readOnly ? nothing : this.update.bind(this);
    this.resolveChildrenArrays = this.resolveChildrenArrays.bind(this);
    this.updateChildrenArrays = readOnly ? nothing : this.updateChildrenArrays.bind(this);
    this.controlAccess = this.controlAccess.bind(this);
  }

  integrityCheck() {
    console.log('\x1b[35m%s\x1b[0m', 'integrityCheck');
    //If this request is authenticated with the privateKey, we don't need to control access.
    if(this.rId === this.server.privateKey) return;
    const tableName = this.tableName;
    const checkData = (keys, request, model) =>  {
      const { primitives, objects, arrays } = classifyRequestData(req, this.table);
      return Promise.all(primitives.map(key => {
        const isValue = value => {
          if(value===null) return;
          if(isPrimitive(value)) {
            if(typeof value === tableModel[key]) return;
            return Promise.reject({
              type : BAD_REQUEST,
              message : `Bad value ${value} provided for field ${key} in table ${tableName}. We expect null, a ${tableModel[key]}, or an array of these types.`
            })
          }
          //This is the way to represent OR condition
          if(value instanceof Array) return Promise.all(value.map(isValue));
          //This is the way to create a AND condition
          if(value instanceof Object) return Promise.all(Object.values(value).map(isValue))
          return Promise.reject({
            type : BAD_REQUEST,
            message : `Bad value ${value} provided for field ${key} in table ${this.tableName}. We expect null, a ${tableModel[key]}, an object, or an array of these types.`
          });
        };
        return isValue(request[key]);
      })).then(() => Promise.all([...objects, ...arrays].map(key => {
        if(request[key]!==null && isPrimitive(request[key])) return Promise.reject({
          type : BAD_REQUEST,
          message : `Bad value ${value} provided for field ${key} in table ${this.tableName}. We expect null, an object, or an array of these types.`
      })})));
    };
    const requests = [
      this.request,
      this.request.create,
      this.request.set,
      this.request.delete,
      this.request.add,
      this.request.remove,
    ];
    return Promise.all(requests.map(req => req || checkData(req, this.server.tableModel[this.tableName])));
  }

  /** Remove elements from the table if request.delete is defined */
  delete() {
    console.log('\x1b[35m%s\x1b[0m', 'delete');
    if(!this.request.delete) return Promise.resolve();
    //Look for matching objects
    return this.server.findInTable(this.server.privateKey, this.tableName, this.request.delete)
      //We record the objects we are going to delete for later access control
      .then(results => (this.deleted = results))
      //We update the server
      .then(results => this.server.driver.delete({
        table : this.tableName,
        where : {reservedId: results.map(r => r.reservedId)},
      }));
  }
  
  /** Insert elements inside the table if request.create is defined */
  create() {
    console.log('\x1b[35m%s\x1b[0m', 'create');
    if(!this.request.create) return Promise.resolve();
    const prepareElement = req => {
      const { request, primitives, objects, arrays } = classifyRequestData(req, this.table);
      //We transform inputs about objects into their ids inside the request
      //TODO gérer les références internes entre créations (un message et un feed par exemple ? un user et ses contacts ?)
      return Promise.all(objects.map(key => {
        //Take care of null value
        if(request[key]===null) {
          request[key+'Id'] = null;
          delete request[key];
          return null;
        }
        //We get the children id and define the key+Id property accordingly
        return this.server.findInTable(this.server.privateKey, this.table[key].tableName, request[key]).then(result => {
          if(result.length===0) return Promise.reject({
            type: NOT_SETTABLE,
            message: `We could not find the object supposed to be set for key ${key} in ${this.tableName}: ${JSON.stringify(req[key])}.`
          })
          else if(result.length>1) return Promise.reject({
            type: NOT_UNIQUE,
            message: `We found multiple solutions for setting key ${key} in ${this.tableName}: ${JSON.stringify(req[key])}.`
          })
          //Only one result
          else {
            request[key+'Id'] = result[0].reservedId;
            this.resolvedObjects[result[0].reservedId] = result[0];
            delete request[key];
          }
        });
      }))
        .then(() => {
          const element = [...primitives, ...objects.map(key => key+'Id')].reduce((acc, key) => {acc[key]=request[key];return acc;}, {});
          //Record the elements that we have created during the request
          this.created = element;
          return element;
        });
    };
    return this.server.driver.create({
      table : this.tableName,
      elements : this.request.create instanceof Array ? this.request.create.map(prepareElement) : prepareElement(this.request.create),
    })
  }

  /** We look for objects that match the request constraints and store their id into the key+Id property and add the objects into this.resolvedObjects map */
  resolveObjects(rId, request) {
    console.log('\x1b[35m%s\x1b[0m', 'resolveObjects', request);
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
      return this.server.findInTable(rId, this.table[key].tableName, request[key]).then(result => {
        if(result.length===0) return Promise.reject({
          type: NOT_FOUND,
          key,
          message: `Nothing found with these constraints : ${this.tableName}->${key}->${JSON.stringify(request[key])}`,
        });
        if(result.length===1) {
          request[key+'Id'] = result[0].reservedId;
          this.resolvedObjects[result[0].reservedId] = result[0];
        } else {
          request[key+'Id'] = result.map(object => object.reservedId);
          result.forEach(object => this.resolvedObjects[object.reservedId] = object);
        }
        delete request[key];
      });
    }));
  }

  /** Look into the database for objects matching the constraints. */
  queryDatabase() {
    console.log('\x1b[35m%s\x1b[0m', 'queryDatabase');
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
    console.log('\x1b[35m%s\x1b[0m', 'setResolvedObjects', results);
    results.forEach(result =>
      this.objects.forEach(key => {
        const resolve = id => this.resolvedObjects[id];
        const ids = result[key+'Id'];
        result[key] = ids instanceof Array ? ids.map(resolve) : resolve(ids)
        delete result[key+'Id'];
      })
    );
    return results;
  }

  /** Change the table's values if request.set is defined */
  update(results) {
    if(!this.request.set) return Promise.resolve(results);
    return this.resolveObjects(this.server.privateKey, this.request.set)
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
        this.request.set.forEach(key => this.request.set[key] instanceof Array || Promise.reject({
          type: NOT_UNIQUE,
          message: `We found multiple solutions for setting key ${key} in ${this.tableName}: ${JSON.stringify(this.request.set[key])}`
        }))
      )

      //We update the server
      .then(() => this.server.driver.update({
        table : this.tableName,
        values : this.request.set,
        where : { reservedId : results.map(result => result.reservedId) },
      }))

      //We return the research results
      .then(() => results);
  }

  updateChildrenArrays(results) {
    console.log('\x1b[35m%s\x1b[0m', 'updateChildrenArrays', results);
    return Promise.all(this.arrays.map(key => {

  }

  resolveChildrenArrays(results) {
    console.log('\x1b[35m%s\x1b[0m', 'resolveChildrenArrays', results);
    return Promise.all(this.arrays.map(key => {
      const { add, remove } = this.request[key];

      return Promise.resolve()
        //We remove elements from the association table
        .then(() => remove || this.server.findInTable(this.rId, this.table[key][0].tableName, remove).then(arrayResults => this.server.driver.delete({
          table : `${key}${this.tableName}`,
          where : {
            [this.tableName+'Id'] : results.map(result => result.reservedId),
            [key+'Id'] : arrayResults.map(result => result.reservedId),
          }
        })))
        //We add elements into the association table
        .then(() => add || this.server.findInTable(this.rId, this.table[key][0].tableName, add).then(arrayResults => this.server.driver.create({
          table : `${key}${this.tableName}`,
          //[].concat(...array) will flatten array.
          elements : [].concat(...results.map(result => arrayResults.map(arrayResult => ({
            [this.tableName+'Id'] : result.reservedId,
            [key+'Id'] : arrayResult.reservedId,
          })))),
        })))
      
        //We resolve queries about arrays
        .then(() => this.server.findInTable(this.rId, this.table[key][0].tableName, this.request[key]))
        //We register the data into resolvedObjects
        .then(arrayData => {
          arrayData.forEach(object => this.resolvedObjects[object.reservedId] = object);
          return arrayData;
        })
        //We filter the data to only the data associated to the source in the association table
        .then(arrayData => Promise.all(results.map(result => this.server.driver.get({table : `${key}${this.tableName}`, search : ['reservedId'], where : {
            [this.tableName+'Id'] : result.reservedId,
            [key+'Id'] : arrayData.length===1 ? arrayData[0].reservedId : arrayData.map(data => data.reservedId),
          }}).then(matches => matches.length ? result : null)))
            //We keep only the results that have a matching solution in the table
            .then(matchedResults => matchedResults.filter(result => result!==null))
            //If we didn't find any object
            .then(matches => matches.length ? matches : Promise.reject({
              type : NOT_FOUND,
              message : `Impossible to find results for field ${key} in table ${this.table} mathing ${JSON.stringify(this.request[key])}.`,
            }))
            //We replace ids by the resolved objects
            .then(matches => matches.map(match => match[key+'Id']))
            .then(matchIds => result[key]=matchIds.map(reservedId => this.resolvedObjects[reservedId]))
              ))
            );
        });
    })).then(() => results);
  }

  controlAccess(results) {
    console.log('\x1b[35m%s\x1b[0m', 'controlAccess', results);
    const ruleSet = this.server.rules[this.tableName];

    //Read access
    Object.keys(this.table).map(key => {
      if(results[key]) {
        if(ruleSet[key].read || ruleSet[key].read({})) return;
        if(ruleSet.read || ruleSet.read({})) return;
        results[key] = 'Access denied';
      }
    });

    //Write access
    return Promise.resolve().then(() => {
      if(!this.request.set) return Promise.resolve();
      const { primitives, objects } = classifyData(this.request.set);
      return Promise.all([...primitives, ...objects].map(key => {
        if(this.request.set[key]) {
          if(ruleSet[key].write || ruleSet[key].write({})) return Promise.resolve();
          if(ruleSet.write || ruleSet.write({})) return Promise.resolve();
          return Promise.reject({
            type : UNAUTHORIZED,
            message : `You are not allowed to edit field ${key} in table ${this.tableName}.`
          });
        }
      }));
    }).then(() => {
      if(!this.request.create) return Promise.resolve();
      if(ruleSet.create || ruleSet.create({})) return Promise.resolve();
      return Promise.reject({
        type : UNAUTHORIZED,
        message : `You are not allowed to create elements in table ${this.tableName}.`
      });
    }).then(() => {
      if(!this.request.delete) return Promise.resolve();
      if(ruleSet.delete || ruleSet.delete({})) return Promise.resolve();
      return Promise.reject({
        type : UNAUTHORIZED,
        message : `You are not allowed to delete elements in table ${this.tableName}.`
      });
    }).then(() => Promise.all(this.arrays.map(key => {
      if(!this.request[key] || !this.request[key].add) return Promise.resolve();
      if(ruleSet[key].create || ruleSet[key].create({})) return Promise.resolve();
      if(ruleSet.write || ruleSet.write({})) return Promise.resolve();
      return Promise.reject({
        type : UNAUTHORIZED,
        message : `You are not allowed to create ${key} in table ${this.tableName}.`
      });
    }))).then(() => Promise.all(this.arrays.map(key => {
      if(!this.request[key] || !this.request[key].remove) return Promise.resolve();
      if(ruleSet[key].delete || ruleSet[key].delete({})) return Promise.resolve();
      if(ruleSet.write || ruleSet.write({})) return Promise.resolve();
      return Promise.reject({
        type : UNAUTHORIZED,
        message : `You are not allowed to create ${key} in table ${this.tableName}.`
      });
    }))).then(() => results);

  }

  /** We will resolve the current request within the table, including creation or deletion of elements. */
  resolveRequest() {
    return this.integrityCheck()
    //Delete elements from the database if request.delete is set
      .then(this.delete)
      //Insert elements inside the database if request.create is set
      .then(this.create)
      //resolve children objects
      .then(() => this.resolveObjects(this.rId, this.request))
      //resolve the request in the database
      .then(this.queryDatabase)
      //Replace ids to resolved objects
      .then(this.setResolvedObjects)
      //Update
      .then(this.update)
      //resolve children arrays data
      .then(this.resolveChildrenArrays)
      //We control the data accesses
      .then(this.controlAccess)
      //If nothing matches the request, the result should be an empty array
      .catch(err => {
        if(err.type===NOT_FOUND) return Promise.resolve([]);
        console.error(err);
        return Promise.reject(err);
      });
  }
}

const reservedKeys = ['reservedId', 'set', 'get', 'delete', 'create', 'add', 'remove', 'not', 'like', 'or', 'limit', 'offset', 'tableName', 'foreignKeys'];
const operators = ['not', 'like', 'gt', 'ge', 'lt', 'le', '<', '>', '<=', '>=', '~', '!'];

module.exports = {
  classifyData,
  classifyRequestData,
  createDatabase,
  reservedKeys,
  operators,
};