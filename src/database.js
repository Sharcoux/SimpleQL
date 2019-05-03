const readline = require('readline');
const { isPrimitive, classifyRequestData, operators, sequence } = require('./utils');
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, ACCESS_DENIED, DATABASE_ERROR } = require('./errors');
const { prepareTables, prepareRules } = require('./prepare');
const { magenta } = require('./utils/colors');

/** Load the driver according to database type, and create the database connection, and the database itself if required */
function createDatabase({tables, database, rules = {}, plugins = []}) {
  const { type, privateKey, create, database : databaseName} = database;

  //Load the driver dynamically
  const createDriver = require(`./drivers/${type}`);
  if(!createDriver) return Promise.reject(`${type} is not supported right now. Try mysql for instance.`);
  //create the driver to the database
  return Promise.resolve().then(() => {
    //Make sure that we really intend to reset the database if it exists
    //TODO check if the database really already existed
    if(create) return ensureCreation(databaseName);
  }).then(() => createDriver(database))
    //We need to prepare and create the association tables and other tables into the database
    .then(driver => createTables({driver, tables, create})
      .then(tablesModel => createRequestHandler({tables, rules, tablesModel, plugins, driver, privateKey}))
      .then(requestHandler => {
        //We pre-configure the rules for this database
        prepareRules({rules, tables, privateKey});
        //We check if the pre-requesites required by the plugins are met
        return Promise.all(plugins.filter(plugin => plugin.preRequisite).map(plugin => plugin.preRequisite(tables)))
          //We return the fully configured request handler
          .then(() => requestHandler);
      })
    );
}

function createRequestHandler({tables, rules, tablesModel, plugins, driver, privateKey}) {
  return request;

  /**
   * Generate a transaction, resolve the provided simple-QL request, and terminate the transaction.
   * @param {String} authId The requester identifier to determine access rights
   * @param {Object} request The full request
   * @param {Object} local An object containing all parameters persisting during the whole request resolving process
   * @returns {Object} The full result of the request
   */
  function request(authId, request) {
    //We start a transaction to resolve the request
    return driver.startTransaction()
      //We resolve the request in each table separately
      .then(() => resolve(request, { authId }))
      //We terminate the request and commit all the changes made to the database
      .then(results => driver.commit().then(() => results))
      //We rollback all the changes made to the database if anything wrong happened
      .catch(err => driver.rollback().then(() => Promise.reject(err)));
  }

  /**
   * Resolve a full simple-QL request
   * @param {Object} local An object containing all parameters persisting during the whole request resolving process
   * @param {Object} request The full request
   * @returns {Object} The full result of the request
   */
  function resolve(request, local = {}) {
    //We keep only the requests where objects requested are described inside a table
    const keys = Object.keys(request).filter(key => tables[key]);
    return sequence(keys.map(key => () => resolveInTable({tableName : key, request : request[key], local})))
      //We associate back the results to each key
      .then(results => keys.reduce((acc, key, index) => {acc[key] = results[index]; return acc;}, {}));
  }

  /**
   * Resolve the provided local request for the specified table, including creation or deletion of elements.
   * @param {String} tableName the name of the table to look into
   * @param {Object} request the request relative to that table
   * @returns {Object} The result of the local (partial) request
   */
  function resolveInTable({tableName, request, parentRequest, local}) {
    if(!request) console.error(new Error(`The request was empty in resolveInTable() for table ${tableName}.`));
    if(!request) return Promise.reject({
      name: BAD_REQUEST,
      message: `The request was ${request} in table ${tableName}`,
    });
    //If an array is provided, we concatenate the results of the requests
    if(request instanceof Array) {
      return sequence(request.map(part => () => resolveInTable({tableName, request : part, parentRequest, local})))
        //[].concat(...array) will flatten array.
        .then(results => [].concat(...results));
      //Removes duplicates
      // .then(results => results.reduce((acc, value) => {
      //   const json = JSON.stringify(value);
      //   if(!acc.includes(json)) acc.push(json);
      //   return acc;
      // }, []).map(value => JSON.parse(value)));
    }

    function pluginCall(data, event) {
      function query(request, { readOnly, admin } = { readOnly : false, admin : false }) {
        return resolve(request, { authId : admin ? privateKey : local.authId, readOnly });
      }
  
      function update(key, value) {
        local[key] = value;
      }
  
      return sequence(plugins
        .filter(plugin => plugin[event])
        .map(plugin => plugin[event])
        .filter(pluginOnEvent => pluginOnEvent[tableName])
        .map(pluginOnEvent => pluginOnEvent[tableName])
        .map(callback => () => callback(data, {parent : parentRequest, query, update, isAdmin : local.authId === privateKey}))
      );
    }

    return pluginCall(request, 'onRequest').then(() => resolveRequest({tableName, request, parentRequest, local, pluginCall}));
  }

  /** This will handle a request workflow for a single table */
  function resolveRequest({tableName, request: initialRequest, parentRequest, local, pluginCall}) {
    console.log('treating ', tableName, JSON.stringify(initialRequest));

    //Classify the request into the elements we will need
    const table = tables[tableName];
    const {request, search, primitives, objects, arrays} = classifyRequestData(initialRequest, table);

    //Function used to execute a request into the database tables
    function applyInTable(req, tName) {
      return resolveInTable({local, tableName : tName || tableName, request : req, parentRequest : {...request, tableName, parent : parentRequest}});
    }

    function query(request, { readOnly, admin } = { readOnly : false, admin : false }) {
      return resolve(request, { authId : admin ? privateKey : local.authId, readOnly });
    }
    
    //We will resolve the current request within the table, including creation or deletion of elements.
    return integrityCheck().then(() => {
      //We look for objects matching the objects constraints
      return Promise.resolve().then(() => {
        //Create and delete requests are ignored if readOnly is set
        if(local.readOnly && (request.create || request.delete)) return [];
        //Insert elements inside the database if request.create is set
        else if(request.create) return create();
        //Retrieve data from the database
        else return get()
          //retrieve the objects from other tables
          .then(resolveObjects)
          //Retrieve the objects associated through association tables
          .then(resolveChildrenArrays)
          .then(results => {
            //In read only mode, skip the following steps
            if(local.readOnly) return results;
            //Delete elements from the database if request.delete is set
            return remove(results)
              //Update table data
              .then(update)
              //Add or remove items from the association tables
              .then(updateChildrenArrays);
          });
      })
        .then(results => pluginCall(results, 'onResult').then(() => results))
        //We control the data accesses
        .then(controlAccess)
        //If nothing matches the request, the result should be an empty array
        .catch(err => {
          if(err.name===NOT_FOUND) return Promise.resolve([]);
          if(err.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' && err.sqlMessage.includes('Access denied')) {
            return Promise.reject({name: ACCESS_DENIED, message: `You are not allowed to access some data needed for your request in table ${this.tableName}.`});
          }
          console.error(err);
          return Promise.reject(err);
        });
    });

    function integrityCheck() {
      //If this request is authenticated with the privateKey, we don't need to check integrity.
      if(local.authId === privateKey) return Promise.resolve();

      console.log(magenta, 'integrityCheck');

      /** Check if the values in the request are acceptable. */
      function checkEntry(req, primitives, objects, arrays) {

        /** Check if the value is acceptable for a primitive */
        function isValue(value, key) {
          if(value===null) return Promise.resolve();
          if(isPrimitive(value)) return Promise.resolve();
          //This is the way to represent OR condition
          if(value instanceof Array) return Promise.all(value.map(v => isValue(v, key)));
          //This is the way to create a AND condition
          if(value instanceof Object) return Promise.all(Object.keys(value).map(k => operators.includes(k) && isValue(value[k], key)));
          return Promise.reject({
            name : BAD_REQUEST,
            message : `Bad value ${value} provided for field ${key} in table ${tableName}. We expect null, a ${tablesModel[key]}, an object, or an array of these types.`
          });
        }

        /** Check if the value is acceptable for an object or an array */
        function isObject(value, key) {
          if(value!==null && isPrimitive(value)) return Promise.reject({
            name : BAD_REQUEST,
            message : `Bad value ${value} provided for field ${key} in table ${tableName}. We expect null, an object, or an array of these types.`
          });
        }

        //Check if the values are acceptable for primitives, objects and arrays
        return Promise.all(primitives.map(key => isValue(req[key], key)))
          .then(() => Promise.all([...objects, ...arrays].map(key => isObject(req[key], key))));
      }


      return checkEntry(request, primitives, objects, arrays)
        .then(() => {
          //Only one instructions among create, delete, get in each request
          if(!!request.create + !!request.delete + !!request.get > 1) {
            return Promise.reject({
              name : BAD_REQUEST,
              message : `Each request can contain only one among 'create', 'delete' or 'get'. The request was : ${JSON.stringify(request)}.`,
            });
          }
          //Check that set instruction is acceptable
          if(request.set) {
            if(request.set instanceof Array || !(request instanceof Object)) return Promise.reject({
              name : BAD_REQUEST,
              message : `The 'set' instruction ${JSON.stringify(request.set)} provided in table ${tableName} is not a plain object. A plain object is required for 'set' instructions.`,
            });
            const { primitives : setPrimitives, objects : setObjects, arrays : setArrays } = classifyRequestData(request.set, table);
            return checkEntry(request.set, setPrimitives, setObjects, setArrays);
          }
          //Cannot add or remove elements from arrays in create or delete requests
          if(request.create || request.delete) {
            const addOrRemove = arrays.find(key => request[key].add || request[key].remove);
            const message = request.create ? `In create requests, you cannot have 'add' or 'remove' instructions in ${addOrRemove} in table ${tableName}. To add children, just write the constraints directly under ${addOrRemove}.`
              : `In delete requests, you cannot have 'add' or 'remove' instructions in ${addOrRemove} in table ${tableName}. When deleting an object, the associations with this object will be automatically removed.`;
            if(addOrRemove) return Promise.reject({
              name : BAD_REQUEST,
              message,
            });
          }
        });
    }

    /** We look for objects that match the request constraints and store their id into the key+Id property and add the objects into this.resolvedObjects map */
    function getObjects() {
      console.log(magenta, 'getObjects');
      //We resolve the children objects
      return sequence(objects.map(key => () => {
        //Take care of null value
        if(request[key]===null) {
          request[key] = null;
          return Promise.resolve();
        }
        else {
          //We get the children id and define the key+Id property accordingly
          return applyInTable(request[key], table[key].tableName).then(result => {
            if(result.length===0) return Promise.reject({
              name: NOT_FOUND,
              message: `Nothing found with these constraints : ${tableName}->${key}->${JSON.stringify(request[key])}`,
            });
            else if(result.length>1) return Promise.reject({
              name: NOT_UNIQUE,
              message: `We found multiple solutions for setting key ${key} in ${this.tableName}: ${JSON.stringify(request[key])}.`
            });
            else request[key] = result[0];
          });
        }
      }));
    }

    /** Filter the results that respond to the arrays constraints. **/
    function getChildrenArrays() {
      console.log(magenta, 'getChildrenArrays');
      return sequence(arrays.map(key =>
        //We resolve queries about arrays
        () => applyInTable(request[key], table[key][0].tableName)
          .then(arrayResults => request[key] = arrayResults)
      ));
    }

    /** Insert elements inside the table if request.create is defined */
    function create() {
      if(!request.create) return Promise.resolve();
      console.log(magenta, 'create');
      //TODO gérer les références internes entre créations (un message et un feed par exemple ? un user et ses contacts ?)
      return getObjects().then(getChildrenArrays).then(() => {
        const element = {};
        //Add primitives values to be created
        primitives.forEach(key => element[key] = request[key]);
        //List the object found to the new element
        objects.forEach(key => element[key+'Id'] = request[key].reservedId);
        //Create the elements inside the database
        return driver.create({ table : tableName, elements : element })
          .then(([reservedId]) => {
            //Add the newly created reservedId
            element.reservedId = reservedId;
            //Replace the ids by their matching objects in the result
            objects.forEach(key => {
              element[key] = request[key];
              delete element[key+'Id'];
            });
            //Add the arrays elements found to the newly created object
            arrays.forEach(key => element[key] = request[key]);
            //Link the newly created element to the arrays children via the association table
            return sequence(arrays.map(key => () => driver.create({
              table : `${key}${tableName}`,
              elements : {
                [tableName+'Id'] : element.reservedId,
                [key+'Id'] : request[key].map(child => child.reservedId),
              }
            })));
          })
          .then(() => pluginCall(element, 'onCreation'))
          //Return the element as results of the query
          .then(() => [element]);
      });
    }

    /** Look into the database for objects matching the constraints. */
    function get() {
      console.log(magenta, 'get');
      if(!search.includes('reservedId')) search.push('reservedId');
      //Create the where clause
      const where = {};
      const searchKeys = [...search, ...objects.map(key => key+'Id')];
      primitives.map(key => {
        where[key] = request[key];
        if(!searchKeys.includes(key)) searchKeys.push(key);
      });
      //If the data we are looking for are already provided, no need to make a request to the database
      // if(!search.find(key => !primitives.includes(key))) return Promise.resolve([where]);
      return driver.get({
        table : tableName,
        //we will need the objects ids to retrieve the corresponding objects
        search : searchKeys,
        where,
        limit : request.limit,
        offset : request.offset,
      });
      // .then(results => {
      //   //We add the primitives constraints to the result object
      //   results.forEach(result => primitives.forEach(key => result[key] = request[key]));
      //   return results;
      // });
    }

    function resolveObjects(results) {
      console.log(magenta, 'resolveObjects');
      return sequence(objects.map(key => () => sequence(results.map(result => () => {
        request[key].reservedId = result[key+'Id'];
        return applyInTable(request[key], table[key].tableName).then(objects => {
          if(objects.length===0) return Promise.reject({
            name: NOT_FOUND,
            message: `Nothing found with these constraints : ${tableName}->${key}->${JSON.stringify(request[key])}`,
          });
          else if(objects.length>0) return Promise.reject({
            name: DATABASE_ERROR,
            message: `We found more than one object for key ${key} with the id ${result[key+'Id']} in table ${table[key].tableName}`,
          });
          else {
            delete result[key+'Id'];
            result[key] = objects[0];
            return result;
          }
        });
      })))).then(() => results);
    }

    /** Filter the results that respond to the arrays constraints. **/
    function resolveChildrenArrays(results) {
      console.log(magenta, 'resolveChildrenArrays');
      //We keep only the arrays constraints that are truly constraints. Constraints that have keys other than 'add' or 'remove'.
      const realArrays = arrays.filter(key => Object.keys(request[key]).find(k => !['add', 'remove'].includes(k)));
      return sequence(results.map(result =>
        () => sequence(realArrays.map(key =>
          //We look for all objects associated to the result in the association table
          () => driver.get({table : `${key}${tableName}`, search : [key+'Id'], where : {
            [tableName+'Id'] : result.reservedId,
          }})
            .then(associatedResults => {
              if(!associatedResults.length) return [];
              //We look for objects that match all the constraints
              request[key].reservedId = associatedResults.map(res => res[key+'Id']);
              return applyInTable(request[key], table[key][0].tableName);
            })
            .then(arrayResults => {
              //We register the data into the result
              result[key] = arrayResults;
            })
        ))
      ))
        //We keep only the results that have a matching solution in the table for each array's constraint
        .then(() => results.filter(result => realArrays.every(key => result[key].length)));
    }

    /** Remove elements from the table if request.delete is defined */
    function remove(results) {
      if(!request.delete) return Promise.resolve(results);
      console.log(magenta, 'delete');
      //Look for matching objects
      return driver.delete({
        table : tableName,
        where : {reservedId: results.map(r => r.reservedId)},
      })
      //Mark the results are deleted inside the results
        .then(() => results.forEach(result => result.deleted = true))
        .then(() => pluginCall(results, 'onDeletion'))
        .then(() => results);
    }
    
    /** Change the table's values if request.set is defined */
    function update(results) {
      if(!request.set) return Promise.resolve(results);
      console.log(magenta, 'update');
      const { primitives : primitivesSet, objects : objectsSet, arrays : arraysSet } = classifyRequestData(request.set, table);
      const values = {}; // The values to be edited
      //Update the results with primitives values
      primitivesSet.forEach(key => results.forEach(result => {
        result[key] = request.set[key];
        values[key] = request.set[key];
      }));
      //Find the objects matching the constraints to be replaced
      return sequence(objectsSet.map(key =>
        () => applyInTable(request.set[key], table[key].tableName)
          .then(matches => {
            if(matches.length===0) return Promise.reject({
              name: NOT_SETTABLE,
              message: `We could not find the object supposed to be set for key ${key} in ${tableName}: ${JSON.stringify(request.set[key])}.`
            });
            else if(matches.length>1) return Promise.reject({
              name: NOT_UNIQUE,
              message: `We found multiple solutions for setting key ${key} in ${tableName}: ${JSON.stringify(request.set[key])}.`
            });
            //Only one result
            else {
              //Update the results with found object values
              results.forEach(result => {
                result[key] = matches[0];
                values[key+'Id'] = matches[0].reservedId;
              });
            }
          })
      ))
        //Reduce the request to only the primitives and objects ids constraints
        .then(() => {
          return driver.update({
            table : tableName,
            values,
            where : { reservedId : results.map(result => result.reservedId) },
          });
        })
        
        //Replace arrays of elements by the provided values
        .then(() => sequence(arraysSet.map(key => () => results.map(result =>
          //Delete any previous value
          driver.delete({table : `${key}${tableName}`, where : {
            [tableName+'Id'] : result.reservedId,
          }})
            //Look for elements matching the provided constraints
            .then(() => applyInTable(request.set[key], `${key}${tableName}`))
            //Create the new links
            .then(matches => driver.create({table : `${key}${tableName}`, elements : {
              [tableName+'Id'] : result.reservedId,
              [key+'Id'] : matches.map(match => match.reservedId),
            }})
              //Attach the matching elements to the results
              .then(() => result[key] = matches))
        ))))
        //We return the research results
        .then(() => results);
    }


    function updateChildrenArrays(results) {
      console.log(magenta, 'updateChildrenArrays');
      return sequence(arrays.map(key => () => {
        const { add, remove } = request[key];
        return Promise.resolve()
          //We remove elements from the association table
          .then(() => {
            if(!remove) return Promise.resolve();
            return applyInTable(remove, table[key][0].tableName)
              .then(arrayResults => driver.delete({
                table : `${key}${tableName}`,
                where : {
                  [tableName+'Id'] : results.map(result => result.reservedId),
                  [key+'Id'] : arrayResults.map(result => result.reservedId),
                }
              }));
          })
          //We add elements into the association table
          .then(() => {
            if(!add) return Promise.resolve();
            //We look for the elements we want to add in the association table
            return applyInTable(add, table[key][0].tableName)
              //We link these elements to the results
              .then(arrayResults => driver.create({
                table : `${key}${tableName}`,
                //[].concat(...array) will flatten array.
                elements : [].concat(...results.map(result => arrayResults.map(arrayResult => ({
                  [tableName+'Id'] : result.reservedId,
                  [key+'Id'] : arrayResult.reservedId,
                })))),
              }).then(() => results.forEach(result => result[key] = arrayResults)));
          });
      })).then(() => results);
    }
    
    function controlAccess(results) {
      //If this request is authenticated with the privateKey, we don't need to control access.
      if(local.authId === privateKey) return Promise.resolve(results);
      console.log(magenta, 'controlAccess');
      const ruleSet = rules[tableName];

      return sequence(results.map(result => () => {
        const ruleData = {authId : local.authId, request: {...request, parent : parentRequest}, object : result, query};

        //Read access
        return Promise.resolve().then(() => {
          //Check table level rules
          if(ruleSet.read) return ruleSet.read(ruleData).catch(err => err);
        }).then(err => sequence(Object.keys(table).map(key => () => {
          //Data not requested
          if(!result[key]) return Promise.resolve();
          //Check property specific rules
          return Promise.resolve().then(() => {
            if(ruleSet[key] && ruleSet[key].read) return ruleSet[key].read(ruleData);
            else if(err) return Promise.reject(err);
          })
            .catch(err => {
              console.log(`Access denied for field ${key} in table ${tableName} for authId ${local.authId}. Error : ${err.message || err}`);
              //Hiding sensitive data
              result[key] = 'Access denied';
            });
        }))

          //Write access
          .then(() => {
            if(ruleSet.write) return ruleSet.write(ruleData).catch(err => err);
          }).then(err => {
            //Manage set instructions
            return Promise.resolve().then(() => {
              if(!request.set) return Promise.resolve();
              const { primitives : setPrimitives, objects : setObjects } = classifyRequestData(request.set, table);
              return sequence([...setPrimitives, ...setObjects].map(key =>
                () => Promise.resolve().then(() => {
                  if(ruleSet[key] && ruleSet[key].write) return ruleSet[key].write(ruleData);
                  else if(err) return Promise.reject(err);
                }).catch(err => Promise.reject({
                  name : UNAUTHORIZED,
                  message : `You are not allowed to edit field ${key} in table ${tableName}. Error : ${err.message || err}`
                }))
              ));
            })
          
              //Manage create instructions
              .then(() => {
                if(!request.create) return Promise.resolve();
                return Promise.resolve().then(() => {
                  if(ruleSet.create) return ruleSet.create(ruleData);
                  else if(err) return Promise.reject(err);
                }).catch(err => Promise.reject({
                  name : UNAUTHORIZED,
                  message : `You are not allowed to create elements in table ${tableName}. Error : ${err.message || err}`
                }));
              })
          
              //Manage delete instructions
              .then(() => {
                if(!request.delete) return Promise.resolve();
                return Promise.resolve().then(() => {
                  if(ruleSet.delete) return ruleSet.delete(ruleData);
                  else if(err) return Promise.reject(err);
                }).catch(err => Promise.reject({
                  name : UNAUTHORIZED,
                  message : `You are not allowed to delete elements from table ${tableName}. Error : ${err.message || err}`
                }));
              })
          
              //Manage add instructions
              .then(() => sequence(arrays.map(key => () => {
                if(!request[key].add) return Promise.resolve();
                if(ruleSet[key] && ruleSet[key].add) ruleSet[key].add(ruleData);
                return Promise.resolve().then(() => {
                  if(ruleSet[key] && ruleSet[key].add) return ruleSet[key].add(ruleData);
                  else if(err) return Promise.reject(err);
                }).catch(err => console.error(err) || Promise.reject({
                  name : UNAUTHORIZED,
                  message : `You are not allowed to create ${key} in table ${tableName}. Error : ${err.message || err}`
                }));
              })))
          
              //Manage remove instructions
              .then(() => sequence(arrays.map(key => () => {
                if(!request[key].remove) return Promise.resolve();
                return Promise.resolve().then(() => {
                  if(ruleSet[key] && ruleSet[key].remove) return ruleSet[key].remove(ruleData);
                  else if(err) return Promise.reject(err);
                }).catch(err => Promise.reject({
                  name : UNAUTHORIZED,
                  message : `You are not allowed to remove ${key} from table ${tableName}. Error : ${err.message || err}`
                }));
              })));
          })
        );
        //We return only the results where access was not fully denied
      }))
        .then(() => results.filter(result => Object.values(result).find(value => value!=='Access denied')));
    }
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
function ensureCreation(databaseName) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve, reject) =>
    rl.question(`Are you sure that you wish to completely erase any previous database called ${databaseName} (y/N)\n`, answer => {
      rl.close();
      answer==='y' ? resolve() : reject('If you don\'t want to erase the database, remove the "create" property from the "database" object.');
    })
  );
}

module.exports = {
  createDatabase,
};