const readline = require('readline');
const { isPrimitive, classifyRequestData } = require('./utils');
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED } = require('./errors');
const { prepareTables, prepareRules } = require('prepare');

class Database {
  constructor({tables, tablesModel, driver, rules = {}, preprocessing = {}, privateKey}) {
    //We pre-configure the rules for this database
    prepareRules({rules, tables, privateKey, query : request => this.request(privateKey, request)});
    this.tables = tables;
    this.driver = driver;
    this.rules = rules;
    this.tablesModel = tablesModel;
    this.privateKey = privateKey;
    this.preprocessing = preprocessing;

    this.findInTable = this.findInTable.bind(this);
    this.applyInTable = this.applyInTable.bind(this);
    this.request = this.request.bind(this);
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
  applyInTable(rId, tableName, request, readOnly = false, parentRequest) {
    if(!request) console.error(new Error());
    if(!request) return Promise.reject({
      type: BAD_REQUEST,
      message: `The request was ${request} in table ${tableName}`,
    });
    //If an array is provided, we concatenate the results of the requests
    if(request instanceof Array) {
      return Promise.all(request.map(part => this.applyInTable(rId, tableName, part, readOnly, parentRequest)))
        //[].concat(...array) will flatten array.
        .then(results => [].concat(...results))
        //Removes duplicates
        //TODO make sure that the properties are ordered the same for JSON.stringify to detect duplicates correctly
        .then(results => results.reduce((acc, value) => {
          if(!acc.includes(value)) acc.push(value);
          return acc;
        }, []));
    }
    //Preprocessing
    if(this.preprocessing[tableName]) this.preprocessing[tableName]({request, parent: parentRequest});
    //create the request helper
    const requestHelper = new RequestHelper({server : this, tableName, rId, request, readOnly, parentRequest});
    //Resolve the request
    return requestHelper.resolveRequest();
  }
}

/** Create the table model that will be used for all requests */
function createTables({driver, tables, create}) {
  const data = prepareTables(tables);
  //We retrieve foreign keys from the prepared table. All tables need to be created before adding foreign keys
  const foreignKeys = Object.keys(data).reduce((acc, tableName) => {
    if(data[tableName].foreignKeys) acc[tableName] = data[tableName].foreignKeys;
    delete data[tableName].foreignKeys;
    return acc;
  }, {});
  //Create the tables if needed
  if(create) return Promise.all(Object.keys(data).map(tableName => {
    //We retrieve tables indexes from the prepared table
    const index = data[tableName].index;
    delete data[tableName].index;
    return driver.createTable({table: tableName, data: data[tableName], index});
  })).then(() => driver.createForeignKeys(foreignKeys)).then(() => data);
  console.log('\x1b[202m%s\x1b[0m', 'The "create" property was not set in the "database" object. Skipping tables creation.');
  return Promise.resolve(data);
}



/** Load the driver according to database type, and create the database connection, and the database itself if required */
function createDatabase({tables, database, rules, preprocessing = {}}) {
  //Make sure that we really intend to erase previous database
  //TODO check if the database already did exist
  return Promise.resolve().then(() => {
    if(database.create) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      return new Promise((resolve, reject) =>
        rl.question(`Are you sure that you wish to completely erase any previous database called ${database.database} (y/N)\n`, answer => {
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
        .then(driver => createTables({driver, tables, create: database.create})
          .then(tablesModel => new Database({tables, tablesModel, driver, rules, privateKey: database.privateKey, preprocessing})));
    });
}

/** This will handle a request workflow for a single table */
class RequestHelper {
  constructor({server, tableName, rId, request: initialRequest, readOnly, parentRequest}) {
    console.log('treating ', tableName, initialRequest);
    this.server = server;
    this.table = server.tables[tableName];
    this.tableModel = server.tablesModel[tableName];
    this.tableName = tableName;
    this.rId = rId;
    this.readOnly = readOnly;
    this.parent = parentRequest;
    //Classify the request into the elements we will need
    const {request, search, primitives, objects, arrays} = classifyRequestData(initialRequest, this.table);
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
    this.addResolvedObject = (object => {
      //We merge the data
      return this.resolvedObjects[object.reservedId] = {...(this.resolvedObjects[object.reservedId] || {}), ...object};
    }).bind(this);

    //Identity function (used to ignore some behaviours in readOnly mode)
    const skip = result => result;

    this.applyInTable = ((request, tableName) => {
      return this.server.applyInTable(this.rId, tableName || this.tableName, request, this.readOnly, {...this.request, parent : this.parent});
    }).bind(this);

    this.integrityCheck = this.integrityCheck.bind(this);
    this.resolveRequest = this.resolveRequest.bind(this);
    this.delete = readOnly ? skip : this.delete.bind(this);
    this.create = readOnly ? skip : this.create.bind(this);
    this.resolveObjects = this.resolveObjects.bind(this);
    this.queryDatabase = this.queryDatabase.bind(this);
    this.setResolvedObjects = this.setResolvedObjects.bind(this);
    this.update = readOnly ? skip : this.update.bind(this);
    this.resolveChildrenArrays = this.resolveChildrenArrays.bind(this);
    this.updateChildrenArrays = readOnly ? skip : this.updateChildrenArrays.bind(this);
    this.controlAccess = this.controlAccess.bind(this);
  }

  integrityCheck() {
    //If this request is authenticated with the privateKey, we don't need to control access.
    if(this.rId === this.server.privateKey) return Promise.resolve();
    console.log('\x1b[35m%s\x1b[0m', 'integrityCheck');
    const checkData = (request, instruction) =>  {
      //Set instruction can only be an object
      if(instruction==='set' && (request instanceof Array || !(request instanceof Object))) {
        return Promise.reject({
          type : BAD_REQUEST,
          message : `Request ${JSON.stringify(request)} provided for ${instruction} instruction in table ${this.tableName} is not a plain object. A plain object is required for ${instruction} instructions.`,
        });
      }
      //Take care of instructions received as arrays
      if(request instanceof Array) return Promise.all(request.map(req => checkData(req)));

      const { primitives, objects, arrays } = classifyRequestData(request, this.table);

      return Promise.all(primitives.map(key => {
        const isValue = value => {
          if(value===null) return Promise.resolve();
          if(isPrimitive(value)) return Promise.resolve();
          //This is the way to represent OR condition
          if(value instanceof Array) return Promise.all(value.map(isValue));
          //This is the way to create a AND condition
          if(value instanceof Object) return Promise.all(Object.values(value).map(isValue));
          return Promise.reject({
            type : BAD_REQUEST,
            message : `Bad value ${value} provided for field ${key} in table ${this.tableName}. We expect null, a ${this.tableModel[key]}, an object, or an array of these types.`
          });
        };
        return isValue(request[key]);
      })).then(() => Promise.all([...objects, ...arrays].map(key => {
        if(request[key]!==null && isPrimitive(request[key])) return Promise.reject({
          type : BAD_REQUEST,
          message : `Bad value ${request[key]} provided for field ${key} in table ${this.tableName}. We expect null, an object, or an array of these types.`
        });
      })));
    };
    const requests = ['set', 'create', 'delete', 'add', 'remove'];
    return checkData(this.request)
      .then(() => Promise.all(requests.map(instruction => {
        const req = this.request[instruction];
        if(!req) return;
        return checkData(req, instruction);
      })));
  }

  /** Remove elements from the table if request.delete is defined */
  delete() {
    if(!this.request.delete) return Promise.resolve();
    console.log('\x1b[35m%s\x1b[0m', 'delete');
    //Look for matching objects
    return this.applyInTable(this.request.delete)
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
    if(!this.request.create) return Promise.resolve();
    console.log('\x1b[35m%s\x1b[0m', 'create');
    return Promise.resolve(this.request.create instanceof Array ? this.request.create : [this.request.create])
      .then(requests => Promise.all(requests.map(request => {
        const { primitives, objects } = classifyRequestData(request, this.table);
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
          return this.applyInTable(request[key], this.table[key].tableName).then(result => {
            if(result.length===0) return Promise.reject({
              type: NOT_SETTABLE,
              message: `We could not find the object supposed to be set for key ${key} in ${this.tableName}: ${JSON.stringify(request[key])}.`
            });
            else if(result.length>1) return Promise.reject({
              type: NOT_UNIQUE,
              message: `We found multiple solutions for setting key ${key} in ${this.tableName}: ${JSON.stringify(request[key])}.`
            });
            //Only one result
            else {
              //Edit the request to replace objects by their ids
              request[key+'Id'] = result[0].reservedId;
              this.addResolvedObject(result[0]);
              delete request[key];
            }
          });
        }))
          .then(() => {
            //Restrict the request elements to only primitives and object constraints
            const element = [...primitives, ...objects.map(key => key+'Id')].reduce((acc, key) => {acc[key]=request[key];return acc;}, {});
            return element;
          });
      }))
        .then(elements =>
        //Create the elements inside the database
          this.server.driver.create({
            table : this.tableName,
            elements,
          }).then(reservedIds => {
            //Record created elements
            this.created = elements;
            //Arrays affectations (create items into association tables if necessary)
            return Promise.all(requests.map((req, index) => {
              const { primitives, objects, arrays } = classifyRequestData(req, this.table);
              const reservedId = reservedIds[index];
              const element = elements[index];
              //Replace object ids by their resolved values
              objects.forEach(key => {
                const resolve = id => this.resolvedObjects[id];
                const ids = element[key+'Id'];
                element[key] = ids instanceof Array ? ids.map(resolve) : resolve(ids);
                delete element[key+'Id'];
              });
              //Add the newly created reservedId
              element.reservedId = reservedId;
              //Add the primitives constraints
              primitives.forEach(key => element[key] = req[key]);

              if(!arrays.length) return Promise.resolve();
              //We look for the elements we want to add in the association table
              return Promise.all(arrays.map(key => this.applyInTable(req[key], this.table[key][0].tableName)
                //We link these elements to the results
                .then(arrayResults => this.server.driver.create({
                  table : `${key}${this.tableName}`,
                  elements : arrayResults.map(arrayResult => ({
                    [this.tableName+'Id'] : reservedId,
                    [key+'Id'] : arrayResult.reservedId,
                  })),
                })
                  .then(() => element[key] = arrayResults)
                )
              ));
            }));
          })
        )
      );
  }

  /** We look for objects that match the request constraints and store their id into the key+Id property and add the objects into this.resolvedObjects map */
  resolveObjects() {
    console.log('\x1b[35m%s\x1b[0m', 'resolveObjects');
    //We resolve the children objects
    return Promise.all(this.objects.map(key => {
      //Take care of null value
      if(this.request[key]===null) {
        this.request[key+'Id'] = null;
        delete this.request[key];
        return null;
      }
      //We get the children id and define the key+Id property accordingly
      return this.applyInTable(this.request[key], this.table[key].tableName).then(result => {
        if(result.length===0) return Promise.reject({
          type: NOT_FOUND,
          message: `Nothing found with these constraints : ${this.tableName}->${key}->${JSON.stringify(this.request[key])}`,
        });
        else if(result.length===1) {
          this.request[key+'Id'] = result[0].reservedId;
          this.addResolvedObject(result[0]);
        } else {
          this.request[key+'Id'] = result.map(object => object.reservedId);
          result.forEach(this.addResolvedObject);
        }
        delete this.request[key];
      });
    }));
  }

  /** Look into the database for objects matching the constraints. */
  queryDatabase() {
    if((this.request.create || this.request.delete) && !this.search.length) {
    // if(!this.search.length && !this.arrays.find(key => this.request[key].add || this.request[key].remove) && !this.request.set) {
      console.log('\x1b[35m%s\x1b[0m', 'ignoring queryDatabase');
      return [];
    }
    console.log('\x1b[35m%s\x1b[0m', 'queryDatabase');
    if(!this.search.includes('reservedId')) this.search.push('reservedId');
    return this.server.driver.get({
      table : this.tableName,
      search : this.search,
      //We use the constraints about primitives and objects to look into our tables
      where : [...this.primitives, ...this.objects.map(key => key+'Id')].reduce((acc, key) => {acc[key] = this.request[key];return acc;},{}),
      limit : this.request.limit,
      offset : this.request.offset,
    }).then(results => {
      //We add the primitives constraints to the result object
      results.forEach(result => this.primitives.forEach(key => result[key] = this.request[key]));
      return results;
    });
  }

  /** Replace ids by the element they denote */
  setResolvedObjects(results) {
    console.log('\x1b[35m%s\x1b[0m', 'setResolvedObjects', results);
    results.forEach(result =>
      this.objects.forEach(key => {
        const resolve = id => this.resolvedObjects[id];
        const ids = result[key+'Id'];
        result[key] = ids instanceof Array ? ids.map(resolve) : resolve(ids);
        delete result[key+'Id'];
      })
    );
    return results;
  }

  /** Filter the results that respond to the arrays constraints. **/
  resolveChildrenArrays(results) {
    console.log('\x1b[35m%s\x1b[0m', 'resolveChildrenArrays', results);
    //We keep only the arrays constraints that are truly constraints. Constraints that have keys other than 'add' or 'remove'.
    const arrays = this.arrays.filter(key => Object.keys(this.request[key]).find(k => !['add', 'remove'].includes(k)));
    return Promise.all(arrays.map(key =>
    //We resolve queries about arrays
      this.applyInTable(this.request[key], this.table[key][0].tableName)
        .then(arrayData => {
          //We register the data into resolvedObjects
          arrayData.forEach(this.addResolvedObject);
          return Promise.all(results.map(result =>
          //We filter the data to only the data associated to the source in the association table
            this.server.driver.get({table : `${key}${this.tableName}`, search : ['reservedId'], where : {
              [this.tableName+'Id'] : result.reservedId,
              [key+'Id'] : arrayData.map(data => data.reservedId),
            }})
              .then(matches => (result[key] = matches.map(match => this.resolvedObjects[match.reservedId])))
          ));
        })
    ))
      //We keep only the results that have a matching solution in the table
      .then(() => results.filter(result => arrays.every(key => result[key].length>0)));
  }

  /** Change the table's values if request.set is defined */
  update(results) {
    if(!this.request.set) return Promise.resolve(results);
    console.log('\x1b[35m%s\x1b[0m', 'update', results);
    const request = this.request.set;
    const { primitives, objects, arrays } = classifyRequestData(request, this.table);
    //Find the objects matching the constraints to be replaced
    return Promise.all(objects.map(key =>
      this.applyInTable(request[key], this.table[key].tableName)
        .then(matches => {
          if(matches.length===0) return Promise.reject({
            type: NOT_SETTABLE,
            message: `We could not find the object supposed to be set for key ${key} in ${this.tableName}: ${JSON.stringify(request[key])}.`
          });
          else if(matches.length>1) return Promise.reject({
            type: NOT_UNIQUE,
            message: `We found multiple solutions for setting key ${key} in ${this.tableName}: ${JSON.stringify(request[key])}.`
          });
          //Only one result
          else {
          //Edit the request to replace objects by their ids
            request[key+'Id'] = matches[0].reservedId;
            this.addResolvedObject(matches[0]);
            delete request[key];
          }
        })
    ))
      //Reduce the request to only the primitives and objects ids constraints
      .then(() => [...primitives, ...objects.map(key => key+'Id')].reduce((acc,key) => {acc[key]=request[key];return acc;}, {}))
      //Update the database
      .then(values => this.server.driver.update({
        table : this.tableName,
        values,
        where : { reservedId : results.map(result => result.reservedId) },
      }))
      //Update the results
      .then(() => primitives.forEach(key => results.forEach(result => result[key] = request[key])))
      .then(() => objects.forEach(key => results.forEach(result => result[key] = this.resolvedObjects[request[key+'Id']])))
      
      //Replace arrays of elements by the provided values
      .then(() => Promise.all(arrays.map(key => results.map(result =>
        //Delete any previous value
        this.server.driver.delete({table : `${key}${this.tableName}`, where : {
          [this.tableName+'Id'] : result.reservedId,
        }}).then(deleted => {})//TODO : record deleted objects
          //Look for elements matching the provided constraints
          .then(() => this.applyInTable(request[key], `${key}${this.tableName}`))
          //Create the new links
          .then(matches => this.server.driver.create({table : `${key}${this.tableName}`, elements : {
            [this.tableName+'Id'] : result.reservedId,
            [key+'Id'] : matches.map(match => match.reservedId),
          }})
            //Attach the matching elements to the results
            .then(() => result[key] = matches))
      ))))
      //We return the research results
      .then(() => results);
  }


  updateChildrenArrays(results) {
    console.log('\x1b[35m%s\x1b[0m', 'updateChildrenArrays', results);
    return Promise.all(this.arrays.map(key => {
      const { add, remove } = this.request[key];
      return Promise.resolve()
        //We remove elements from the association table
        .then(() => {
          if(!remove) return Promise.resolve();
          return this.applyInTable(remove, this.table[key][0].tableName)
            .then(arrayResults => this.server.driver.delete({
              table : `${key}${this.tableName}`,
              where : {
                [this.tableName+'Id'] : results.map(result => result.reservedId),
                [key+'Id'] : arrayResults.map(result => result.reservedId),
              }
            }));
        })
        //We add elements into the association table
        .then(() => {
          if(!add) return Promise.resolve();
          //We look for the elements we want to add in the association table
          return this.applyInTable(add, this.table[key][0].tableName)
            //We link these elements to the results
            .then(arrayResults => console.log('temp log : array results', [...arrayResults]) || this.server.driver.create({
              table : `${key}${this.tableName}`,
              //[].concat(...array) will flatten array.
              elements : [].concat(...results.map(result => arrayResults.map(arrayResult => ({
                [this.tableName+'Id'] : result.reservedId,
                [key+'Id'] : arrayResult.reservedId,
              })))),
            }).then(() => results.forEach(result => result[key] = arrayResults)));
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
      const { primitives, objects } = classifyRequestData(this.request.set, this.table);
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
      //resolve children arrays data
      .then(this.resolveChildrenArrays)
      //Update
      .then(this.update)
      //Add or remove items from the association tables
      .then(this.updateChildrenArrays)
      //We add created items to the response
      .then(results => results.concat(this.created))
      //We control the data accesses
      // .then(this.controlAccess)
      //If nothing matches the request, the result should be an empty array
      .catch(err => {
        if(err.type===NOT_FOUND) return Promise.resolve([]);
        console.error(err);
        return Promise.reject(err);
      });
  }
}


module.exports = {
  createDatabase,
};