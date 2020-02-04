/** This is the core of SimpleQL where every request is cut in pieces and transformed into a query to the database */
const readline = require('readline');
const { isPrimitive, toType, classifyRequestData, operators, sequence, stringify } = require('./utils');
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, ACCESS_DENIED, DATABASE_ERROR, WRONG_VALUE, CONFLICT } = require('./errors');
const { prepareTables, prepareRules } = require('./prepare');
const log = require('./utils/logger');

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
  let inTransaction = false;
  return request;

  /**
   * Generate a transaction, resolve the provided simple-QL request, and terminate the transaction.
   * @param {String} authId The requester identifier to determine access rights
   * @param {Object} request The full request
   * @param {Object} local An object containing all parameters persisting during the whole request resolving process
   * @returns {Object} The full result of the request
   */
  function request(authId, request) {
    if(!request) return Promise.reject(`The request is ${request}. You probably forgot to indicate the first parameter: authId. This parameter determines the access rights. It should be set to database.privateKey for admin rights, undefined for public rights, or to a user Id to simulate this user's credentials.`);
    if(inTransaction) return Promise.reject('A transaction is already in progress. You should not be calling this method right now. Check the documentation about plugins tu see how you can request your database within a plugin method.');
    //We cache the requests made into the database
    const cache = {};
    //These data may be updated during the request
    const local = { authId };
    //We start a transaction to resolve the request
    return driver.startTransaction()
      .then(() => inTransaction = true)
      //We resolve the request in each table separately
      .then(() => resolve(request, local))
      .then(results =>
        //We let the plugins know that the request will be committed and terminate successfully
        sequence(plugins.map(plugin => plugin.onSuccess).filter(s => s).map(onSuccess => () => onSuccess(results, { request, query, local, isAdmin: local.authId === privateKey })))
        //We terminate the request and commit all the changes made to the database
          .then(() => driver.commit().then(() => inTransaction = false).then(() => results))
      )
      //We rollback all the changes made to the database if anything wrong happened
      .catch(err => 
        //We terminate the request and rollback all the changes made to the database
        driver.rollback().then(() => inTransaction = false)
        //We let the plugins know that the request failed and the changes will be discarded
          .then(() => sequence(plugins.map(plugin => plugin.onError).filter(e => e).map(onError => () => onError(err, { request, query, local, isAdmin: local.authId === privateKey }))))
        //If the plugins didn't generate a new error, we throw the original error event.
          .then(() => Promise.reject(err))
      );
  
    /** 
     * Function needed to query the database from rules or plugins.
     * Function provided to execute SimpleQL requests into the database, potentially with admin rights
     **/
    function query(request, { readOnly, admin } = { readOnly : false, admin : false }) {
      return resolve(request, { authId : admin ? privateKey : local.authId, readOnly });
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
      if(Array.isArray(request)) {
        return sequence(request.map(part => () => resolveInTable({tableName, request : part, parentRequest, local})))
          //[].concat(...array) will flatten array.
          .then(results => [].concat(...results));
      }

      function pluginCall(data, event) {
        //Function provided to edit local request parameters (authId, readOnly) during the request
        log('resolution part title', event, tableName);
        return sequence(plugins
          //Read the callback for the event in this table for each plugin
          .map(plugin => plugin[event] && plugin[event][tableName])
          //Keep only the plugins that have such a callback
          .filter(eventOnTable => eventOnTable)
          .map(callback => () => callback(data, {request, parent : parentRequest, query, local, isAdmin : local.authId === privateKey}))
        );
      }

      return pluginCall(request, 'onRequest')
        .then(() => resolveRequest({tableName, request, parentRequest}));



      /** This will handle a request workflow for a single table */
      function resolveRequest({tableName, request: initialRequest, parentRequest}) {
        log('resolution part', 'treating : ', tableName, JSON.stringify(initialRequest));

        //Classify the request into the elements we will need
        const table = tables[tableName];
        const {request, search, primitives, objects, arrays} = classifyRequestData(initialRequest, table);

        //Function used to execute a request into the database tables
        function applyInTable(req, tName) {
          return resolveInTable({tableName : tName || tableName, request : req, parentRequest : {...request, tableName, parent : parentRequest}, local});
        }

        if(!cache[tableName]) cache[tableName] = {};
        function addCache(elt) {
          if(!cache[tableName][elt.reservedId]) cache[tableName][elt.reservedId] = {};
          //We add the primitive content to the cache.
          Object.keys(elt).forEach(key => cache[tableName][elt.reservedId][key] = elt[key]);
        }
        function uncache(elt) {
          delete cache[tableName][elt.reservedId];
        }
        function readCache(elt, properties) {
          const cached = elt && cache[tableName][elt.reservedId];
          if(!cached) return;
          if(properties.find(key => cached[key]===undefined)) return;
          const result = {};
          properties.forEach(key => result[key] = cached[key]);
          return result;
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
                return pluginCall(results, 'onProcessing')
                //If request.delete is set, we need to make the access control prior to altering the tables
                  .then(() => (request.delete && controlAccess(results))).then(() => results)
                //Delete elements from the database if request.delete is set
                  .then(remove)
                //Update table data
                  .then(update)
                //Add or remove items from the association tables
                  .then(updateChildrenArrays);
              });
          })
            .then(results => pluginCall(results, 'onResult').then(() => results))
            //We control the data accesses
            .then(results => request.delete ? results : controlAccess(results))
            .catch(err => {
              //If nothing matches the request, the result should be an empty array
              if(err.name===NOT_FOUND) return Promise.resolve([]);
              if(err.name===WRONG_VALUE) return Promise.reject({ name: ACCESS_DENIED, message: `You are not allowed to access some data needed for your request in table ${tableName}.`});
              return Promise.reject(err);
            });
        });

        function integrityCheck() {
          //If this request is authenticated with the privateKey, we don't need to check integrity.
          if(local.authId === privateKey) return Promise.resolve();

          log('resolution part title', 'integrityCheck');

          /** Check if the values in the request are acceptable. */
          function checkEntry(req, primitives, objects, arrays) {

            /** Check if the value is acceptable for a primitive */
            function isValue(value, key) {
              if(value===null) return true;
              if(isPrimitive(value)) return true;
              //This is the way to represent OR condition
              if(Array.isArray(value)) return value.every(v => isValue(v, key));
              //This is the way to create a AND condition
              if(value instanceof Object) return Object.keys(value).every(k => operators.includes(k) && isValue(value[k], key));
              throw `Bad value ${value} provided for field ${key} in table ${tableName}. We expect null, a ${tablesModel[key].type}, an object, or an array of these types.`;
            }

            /** Check if the value is acceptable for an object or an array */
            function isObject(value, key) {
              if(value!==null && isPrimitive(value)) throw `Bad value ${value} provided for field ${key} in table ${tableName}. We expect null, an object, or an array of these types.`;
            }

            //Check if the values are acceptable for primitives, objects and arrays
            return primitives.every(key => isValue(req[key], key))
              && [...objects, ...arrays].every(key => isObject(req[key], key));
          }
          function wrongType(keys, values, model) {
            return keys.find(key => !isTypeCorrect(key, values[key], model[key].type));
            function isTypeCorrect(key, value, type) {
              if(value===undefined || value===null) return !model[key].notNull;
              switch(type) {
                case 'string':
                case 'varchar':
                case 'text':
                  return Object(value) instanceof String;
                case 'char':
                  return (Object(value) instanceof String) && value.length===1;
                case 'integer':
                case 'year': 
                  return Number.isInteger(value);
                case 'double':
                case 'decimal':
                case 'float':
                  return !Number.isNaN(value);
                case 'date':
                case 'dateTime':
                  return (Object(value) instanceof Date) || !isNaN(new Date(value));
                case 'boolean':
                  return Object(value) instanceof Boolean;
                case 'binary':
                case 'varbinary':
                  return value instanceof Buffer;
                case 'json':
                default:
                  return value instanceof Object;
              }
            }
          }

          try {
            checkEntry(request, primitives, objects, arrays);
            //Only one instructions among create, delete, get in each request
            if(request.create && request.delete) throw `Each request can contain only one among 'create' or 'delete'. The request was : ${JSON.stringify(request)}.`;
            //Check that set instruction is acceptable
            if(request.set) {
              if(Array.isArray(request.set) || !(request instanceof Object)) throw `The 'set' instruction ${JSON.stringify(request.set)} provided in table ${tableName} is not a plain object. A plain object is required for 'set' instructions.`;
              const { primitives : setPrimitives, objects : setObjects, arrays : setArrays } = classifyRequestData(request.set, table);
              checkEntry(request.set, setPrimitives, setObjects, setArrays);
              const wrongKey = wrongType(setPrimitives, request.set, tablesModel[tableName]);
              if(wrongKey) throw `The value ${stringify(request.set[wrongKey])} for ${wrongKey} in table ${tableName} is of type ${toType(request.set[wrongKey])} but it was expected to be of type ${tablesModel[tableName][wrongKey].type}.`;
            }
            //Check that create instruction is acceptable
            if(request.create) {
              const wrongKey = wrongType(primitives, request, tablesModel[tableName]);
              if(wrongKey) throw `The value ${stringify(request[wrongKey])} for ${wrongKey} in table ${tableName} is of type ${toType(request[wrongKey])} but it was expected to be of type ${tablesModel[tableName][wrongKey].type}.`;
            }
            //Check that there is not add or remove instruction in object fields
            const unwantedInstruction = objects.find(key => request[key].add || request[key].remove);
            if(unwantedInstruction) throw `Do not use 'add' or 'remove' instructions within ${unwantedInstruction} parameter in table ${tableName}. You should use the 'set' instruction instead.`;
            //Cannot add or remove elements from arrays in create or delete requests
            if(request.create || request.delete) {
              const addOrRemove = arrays.find(key => request[key].add || request[key].remove);
              if(addOrRemove) throw request.create ? `In create requests, you cannot have 'add' or 'remove' instructions in ${addOrRemove} in table ${tableName}. To add children, just write the constraints directly under ${addOrRemove}.`
                : `In delete requests, you cannot have 'add' or 'remove' instructions in ${addOrRemove} in table ${tableName}. When deleting an object, the associations with this object will be automatically removed.`;
            }
            //Check limit, offset and order instructions
            if(request.limit && !Number.isInteger(request.limit)) throw `'Limit' statements requires an integer within ${tableName}. We received: ${request.limit} instead.`;
            if(request.offset && !Number.isInteger(request.offset)) throw `'Offset' statements requires an integer within ${tableName}. We received: ${request.offset} instead.`;
            if(request.order) {
            //Ensure that order is an array of strings
              if(!Array.isArray(request.order)) throw `'order' statements requires an array of column names within ${tableName} request. We received: ${request.order} instead.`;
              //Ensure that it denotes only existing columns
              const columns = Object.keys(tablesModel[tableName]);
              const unfoundColumn = request.order.find(column =>
                column.startsWith('-') ? !columns.includes(column.substring(1)) : !columns.includes(column)
              );
              if(unfoundColumn) throw `'order' statement requires an array of property names within ${tableName}, but ${unfoundColumn} doesn't belong to this table.`;
            }
            return Promise.resolve();
          } catch(err) {
            return Promise.reject({ name: BAD_REQUEST, message: err });
          }
        }

        /** We look for objects that match the request constraints and store their id into the key+Id property and add the objects into this.resolvedObjects map */
        function getObjects() {
          log('resolution part title', 'getObjects');
          //We resolve the children objects
          return sequence(objects.map(key => () => {
            //If we are looking for null value...
            if(!request[key]) {
              request[key] = null;
              return Promise.resolve();
            }
            else {
            //We get the children id and define the key+Id property accordingly
              return applyInTable(request[key], table[key].tableName).then(result => {
                if(result.length===0 && request[key].required) return Promise.reject({
                  name: NOT_FOUND,
                  message: `Nothing found with these constraints : ${tableName}->${key}->${JSON.stringify(request[key])}`,
                });
                else if(result.length>1) return Promise.reject({
                  name: NOT_UNIQUE,
                  message: `We found multiple solutions for setting key ${key} in ${tableName}: ${JSON.stringify(request[key])}.`
                });
                else request[key] = result[0];
              });
            }
          }));
        }

        /** Filter the results that respond to the arrays constraints. **/
        function getChildrenArrays() {
          log('resolution part title', 'getChildrenArrays');
          return sequence(arrays.map(key =>
          //We resolve queries about arrays
            () => applyInTable(request[key], table[key][0].tableName)
              .then(arrayResults => request[key] = arrayResults)
          ));
        }

        /** Insert elements inside the table if request.create is defined */
        function create() {
          if(!request.create) return Promise.resolve();
          log('resolution part title', 'create');
          //TODO gérer les références internes entre créations (un message et un feed par exemple ? un user et ses contacts ?)
          return getObjects().then(getChildrenArrays).then(() => {
            const element = {};
            //FIXME : we should be able to create more than one object if necessary
            //Make sure we cannot create more than one object at a time
            const array = primitives.find(key => Array.isArray(request[key]));
            if(array) return Promise.reject({
              name : BAD_REQUEST,
              message : `It is not allowed to provide an array for key ${array} in table ${tableName} during creation.`,
            });

            //Add primitives values to be created
            primitives.forEach(key => element[key] = request[key]);
            //Link the object found to the new element if an object was found
            objects.forEach(key => element[key+'Id'] = request[key] ? request[key].reservedId : null);
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
              .then(() => element.created = true)
              .then(() => addCache(element))
              .then(() => pluginCall(element, 'onCreation'))
            //Return the element as results of the query
              .then(() => [element]);
          });
        }

        /** Look into the database for objects matching the constraints. */
        function get() {
          log('resolution part title', 'get');
          if(!search.includes('reservedId')) search.push('reservedId');
          //Create the where clause
          const where = {};
          const searchKeys = [...search, ...objects.map(key => key+'Id')];
          let impossible = false;
          primitives.map(key => {
            //If we have an empty array as a constraint, it means that no value can satisfy the constraint
            if(Array.isArray(request[key]) && !request[key].length) impossible = true;
            where[key] = request[key];//We don't consider empty arrays as valid constraints
            if(!searchKeys.includes(key)) searchKeys.push(key);
          });
          if(impossible) return Promise.resolve([]);
          //We try to read the data from the cache
          const cachedData = readCache(request, search);
          if(cachedData) return Promise.resolve([cachedData]);
          return driver.get({
            table : tableName,
            //we will need the objects ids to retrieve the corresponding objects
            search : searchKeys,
            where,
            limit : request.limit,
            offset : request.offset,
            order: request.order,
          })
          //We add the date to the cache as they were received from the database
            .then(results => {
              results.forEach(addCache);
              return results;
            });
        // .then(results => {
        //   //We add the primitives constraints to the result object
        //   results.forEach(result => primitives.forEach(key => result[key] = request[key]));
        //   return results;
        // });
        }

        function resolveObjects(results) {
          log('resolution part title', 'resolveObjects');
          return sequence(objects.map(key => () => sequence(results.map(result => () => {
            //If we are looking for null values, no need to query the foreign table.
            if(!request[key]) {
              request[key] = null;
              return Promise.resolve();
            }
            request[key].reservedId = result[key+'Id'];
            return applyInTable(request[key], table[key].tableName).then(objects => {
              if(objects.length===0 && request[key].required) {
                return Promise.reject({
                  name: NOT_FOUND,
                  message: `Nothing found with these constraints : ${tableName}->${key}->${JSON.stringify(request[key])}`,
                });
              }
              else if(objects.length>1) return Promise.reject({
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
          log('resolution part title', 'resolveChildrenArrays');
          //We keep only the arrays constraints that are truly constraints. Constraints that have keys other than 'add' or 'remove'.
          const realArrays = arrays.filter(key => request[key] && Object.keys(request[key]).find(k => !['add', 'remove'].includes(k)));
          return sequence(results.map(result =>
            () => sequence(realArrays.map(key =>
            //We look for all objects associated to the result in the association table
              () => driver.get({table : `${key}${tableName}`, search : [key+'Id'], where : {
                [tableName+'Id'] : result.reservedId,
              }, offset : request[key].offset, limit : request[key].limit, order : request[key].order})
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
          //If the constraint is 'required', we keep only the results that have a matching solution in the table for each array's constraint
            .then(() => results.filter(result => realArrays.every(key => !request[key].required || result[key].length)));
        }

        /** Remove elements from the table if request.delete is defined */
        function remove(results) {
          if(!request.delete) return Promise.resolve(results);
          log('resolution part title', 'delete');
          //If there is no results, there is nothing to delete
          if(!results.length) return Promise.resolve(results);
          //Look for matching objects
          return driver.delete({
            table : tableName,
            where : {reservedId: results.map(r => r.reservedId)},
          })
          //Mark the results as deleted inside the results
            .then(() => results.forEach(result => result.deleted = true))
            .then(() => results.forEach(uncache))//The content is not anymore in the database. Data became unsafe.
            .then(() => pluginCall(results, 'onDeletion'))
            .then(() => results);
        }
    
        /** Change the table's values if request.set is defined */
        function update(results) {
          if(!request.set) return Promise.resolve(results);
          if(!results.length) return Promise.resolve(results);
          log('resolution part title', 'update');
          const { primitives : primitivesSet, objects : objectsSet, arrays : arraysSet } = classifyRequestData(request.set, table);
          const values = {}; // The values to be edited
          //Mark the elements as being edited
          results.forEach(result => result.edited = true);
          //Update the results with primitives values
          primitivesSet.forEach(key => {
            results.forEach(result => result[key] = request.set[key]);
            values[key] = request.set[key];
          });
          //Cache the updated results
          results.forEach(addCache);
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
              return values.length ? driver.update({
                table : tableName,
                values,
                where : { reservedId : results.map(result => result.reservedId) },
              }) : Promise.resolve();
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
                  .then(() => result[key] = matches)
                )
            ))))
          //We return the research results
            .then(() => results);
        }


        function updateChildrenArrays(results) {
          log('resolution part title', 'updateChildrenArrays');
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
          log('resolution part title', 'controlAccess');
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
                  log('access warning', `Access denied for field ${key} in table ${tableName} for authId ${local.authId}. Error : ${err.message || err}`);
                  //Hiding sensitive data
                  // result[key] = 'Access denied';
                  delete result[key];
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
                    return Promise.resolve().then(() => {
                      if(ruleSet[key] && ruleSet[key].add) return ruleSet[key].add(ruleData);
                      else if(err) return Promise.reject(err);
                    }).catch(err => Promise.reject({
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
  if(create) return sequence(Object.keys(data).map(tableName => () => {
    //We retrieve tables indexes from the prepared table
    const index = data[tableName].index;
    delete data[tableName].index;
    return driver.createTable({table: tableName, data: data[tableName], index});
  })).then(() => driver.createForeignKeys(foreignKeys)).then(() => data);
  log('info', 'The "create" property was not set in the "database" object. Skipping tables creation.');
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
      answer.toLowerCase()==='y' ? resolve() : reject('If you don\'t want to erase the database, remove the "create" property from the "database" object.');
    })
  );
}

module.exports = createDatabase;
