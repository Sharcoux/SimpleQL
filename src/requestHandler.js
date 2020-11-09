// @ts-check

/** This is the core of SimpleQL where every request is cut in pieces and transformed into a query to the database */
const { isPrimitive, toType, classifyRequestData, operators, sequence, stringify, filterObject, classifyData } = require('./utils')
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, ACCESS_DENIED, DATABASE_ERROR, WRONG_VALUE } = require('./errors')
const log = require('./utils/logger')

/**
 * A function able to execute a request to the database
 * @callback RequestHandler
 * @param {import('./utils').Request} request The SimpleQL request
 * @param {import('./plugins').Local} locals An object used to share data through the request processing
 * @returns {Promise<import('./utils').Result>} The request results
 */

/**
 * @typedef {Object} CreateRequestHandlerParams
 * @property {import('./utils').FormattedTablesDeclaration} tables The tables as they were declared (without shorthand values)
 * @property {import('./accessControl').PreparedRules} rules The access rules for the database
 * @property {import('./utils').Tables} tablesModel The tables as they will appear in the database
 * @property {import('./drivers/template')} driver The driver to communicate with the database
 * @property {import('./plugins').Plugin[]} plugins The SimpleQL plugins
 * @property {string} privateKey A private key that will be used to identify requests that can ignore access rules
 */

/**
 * Create the request handler to make request to the database
 * @param {CreateRequestHandlerParams} requestHandlerParams
 * @returns {RequestHandler} Returns the request handler
 */
function createRequestHandler ({ tables, rules, tablesModel, plugins, driver, privateKey }) {
  let inTransaction = false
  return (req, locals) => {
    if (!locals.authId) locals.authId = ''
    if (!locals.readOnly) locals.readOnly = false
    return request(req, locals)
  }
  /**
     * Generate a transaction, resolve the provided simple-QL request, and terminate the transaction.
     * @type {RequestHandler}
     */
  async function request (request, locals) {
    if (inTransaction) return Promise.reject('A transaction is already in progress. You should not be calling this method right now. Check the documentation about plugins tu see how you can request your database within a plugin method.')
    // We cache the requests made into the database
    const cache = {}
    // We start a transaction to resolve the request
    try {
      await driver.startTransaction()
      inTransaction = true
      // We resolve the request in each table separately
      const results = await resolve(request, locals)
      // We let the plugins know that the request will be committed and terminate successfully
      await sequence(plugins.map(plugin => plugin.onSuccess).filter(s => s).map(onSuccess => () => onSuccess(results, { request, query, local: locals, isAdmin: locals.authId === privateKey })))
      // We terminate the request and commit all the changes made to the database
      await driver.commit()
      inTransaction = false
      return results
    } catch (err) {
      // We terminate the request and rollback all the changes made to the database
      await driver.rollback()
      inTransaction = false
      // We let the plugins know that the request failed and the changes will be discarded
      await sequence(plugins.map(plugin => plugin.onError).filter(e => e).map(onError => () => onError(err, { request, query, local: locals, isAdmin: locals.authId === privateKey })))
      // If the plugins didn't generate a new error, we throw the original error event.
      return Promise.reject(err)
    }

    /**
       * Function needed to query the database from rules or plugins.
       * Function provided to execute SimpleQL requests into the database, potentially with admin rights
       * @type {import('./utils').QueryFunction}
       **/
    async function query (request, { readOnly, admin } = { readOnly: false, admin: false }) {
      return resolve(request, { authId: admin ? privateKey : locals.authId, readOnly })
    }

    /**
       * Resolve a full simple-QL request.
       * Note: local is unique for each query, while locals is being shared for the whole request
       * @param {import('./utils').Request} request The full request
       * @param {import('./plugins').Local} local An object containing all parameters persisting during the whole request resolving process for each query.
       * @returns {Promise<import('./utils').Result>} The full result of the request
       */
    async function resolve (request, local) {
      // We keep only the requests where objects requested are described inside a table
      const keys = Object.keys(request).filter(key => tables[key])
      return sequence(keys.map(key => () => resolveInTable({ tableName: key, request: request[key], local })))
        // We associate back the results to each key
        .then(results => keys.reduce((acc, key, index) => { acc[key] = results[index]; return acc }, {}))
    }

    /**
       * Resolve the provided local request for the specified table, including creation or deletion of elements.
       * @param {{ tableName: string; request: import('./utils').Request; parentRequest?: import('./utils').Request; local: import('./plugins').Local}} tableName the name of the table to look into
       * @returns {Promise<import('./utils').Element[]>} The result of the local (partial) request
       */
    async function resolveInTable ({ tableName, request, parentRequest, local }) {
      if (!request) console.error(new Error(`The request was empty in resolveInTable() for table ${tableName}.`))
      if (!request) {
        return Promise.reject({
          name: BAD_REQUEST,
          message: `The request was ${request} in table ${tableName}`
        })
      }
      // If an array is provided, we concatenate the results of the requests
      if (Array.isArray(request)) {
        return sequence(request.map(part => () => resolveInTable({ tableName, request: part, parentRequest, local })))
        // [].concat(...array) will flatten array.
          .then(results => [].concat(...results))
      }

      /**
         * Call
         * @param {import('./utils').Request | Object | import('./utils').Element[]} data The data this plugin should be called with
         * @param {'onRequest' | 'onCreation' | 'onDeletion' | 'onProcessing' | 'onUpdate' | 'onListUpdate' | 'onResult'} event The event that originated this call
         * @returns {Promise<any>}
         */
      async function pluginCall (data, event) {
        // Function provided to edit local request parameters (authId, readOnly) during the request
        log('resolution part title', event, tableName)
        // @ts-ignore
        return sequence(plugins
        // Read the callback for the event in this table for each plugin
          .map(plugin => plugin[event] && plugin[event][tableName])
        // Keep only the plugins that have such a callback
          .filter(eventOnTable => eventOnTable)
          .map(callback => () => callback(data, { request, parent: parentRequest, query, local, isAdmin: local.authId === privateKey }))
        )
      }

      return pluginCall(request, 'onRequest')
        .then(() => resolveRequest({ tableName, request, parentRequest }))

      /**
         * This will handle a request workflow for a single table
         * @param {{ tableName: string; request: import('./utils').Request; parentRequest?: import('./utils').Request }} resolveRequestParams
         * @returns {Promise<import('./utils').Element[]>}
         **/
      async function resolveRequest ({ tableName, request: initialRequest, parentRequest }) {
        log('resolution part', 'treating : ', tableName, JSON.stringify(initialRequest))

        /**
           * Apply a partial request in a table
           * @param {import('./utils').Request} req The partial request to apply
           * @param {string} tName Table name
           * @returns {Promise<import('./utils').Element[]>} The results of the partial request
           */
        async function applyInTable (req, tName) {
          return resolveInTable({ tableName: tName || tableName, request: req, parentRequest: { ...request, tableName, parent: parentRequest }, local })
        }

        /**
           * Save data we found on every elements during the request to give faster results
           * @param {import('./utils').Element} elt The element to cache
           */
        function addCache (elt) {
          if (!cache[tableName][elt.reservedId]) cache[tableName][elt.reservedId] = {}
          // We add the primitive content to the cache.
          Object.keys(elt).forEach(key => cache[tableName][elt.reservedId][key] = elt[key])
        }
        /**
           * Remove the cached data for the specified element
           * @param {import('./utils').Element} elt
           */
        function uncache (elt) {
          delete cache[tableName][elt.reservedId]
        }
        /**
           * Read the data we have stored about the provided element
           * @param {string | number} reservedId The id of the element we are trying to get data about
           * @param {string[]} properties The column we want to read from the cache
           * @returns {import('./utils').Element | undefined} The data we found about the object
           */
        function readCache (reservedId, properties) {
          const cached = reservedId && cache[tableName][reservedId]
          if (!cached) return
          // If some data were invalidated, we give up reading the cache as it might be outdated
          if (properties.find(key => cached[key] === undefined)) return
          const result = { reservedId }
          // We read from the cache the data we were looking for.
          properties.forEach(key => result[key] = cached[key])
          return result
        }

        /**
         * Handle special request values: '*' means all column, and when deleting, we retrieve all previous data.
         * @param {import('./utils').Request} request The request to analyse
         */
        function formatRequest (request, table) {
          // When we delete an object, we want to retrieve all their data before it disappear from the database
          if (request.delete) request.get = '*'
          // We allow using '*' to mean all columns
          if (request.get === '*') {
            const tableData = classifyData(table)
            request.get = [...tableData.primitives]
          }
        }

        // Initialize the cache for the table if it doesn't exist yet
        if (!cache[tableName]) cache[tableName] = {}

        // We will resolve the current request within the table, including creation or deletion of elements.
        const table = tables[tableName]
        // Ensure that the request is correctly formatted
        await formatRequest(initialRequest, table)
        // Classify the request into the elements we will need
        const { request, search, primitives, objects, arrays } = classifyRequestData(initialRequest, table)

        // We look for objects matching the objects constraints
        try {
          // Check that the request is valid
          await integrityCheck()
          // Create and delete requests are ignored if readOnly is set
          if (local.readOnly && (request.create || request.delete)) return []
          // Insert elements inside the database if request.create is set
          else if (request.create) return create()
          // Retrieve data from the database
          else {
            let results = await get()
            // retrieve the objects from other tables
            results = await resolveObjects(results)
            // Retrieve the objects associated through association tables
            results = await resolveChildrenArrays(results)
            // In read only mode, skip the next steps
            if (!local.readOnly) {
              await pluginCall(results, 'onProcessing')
              // If request.delete is set, we need to make the access control prior to altering the tables
              if (request.delete) results = await controlAccess(results)
              // Delete elements from the database if request.delete is set
              results = await remove(results)
              // Update table data
              results = await update(results)
              // Add or remove items from the association tables
              results = await updateChildrenArrays(results)
            }
            await pluginCall(results, 'onResult')
            // We control the data accesses
            if (!request.delete) results = await controlAccess(results)
            return results
          }
        } catch (err) {
          // If nothing matches the request, the result should be an empty array
          if (err.name === NOT_FOUND) return Promise.resolve([])
          if (err.name === WRONG_VALUE) return Promise.reject({ name: ACCESS_DENIED, message: `You are not allowed to access some data needed for your request in table ${tableName}.` })
          console.log(err.stack)
          return Promise.reject(err)
        }

        /**
           * Ensure that the request has a valid shape
           * @returns {Promise<void>} Resolves if the request is valid
           */
        async function integrityCheck () {
          // If this request is authenticated with the privateKey, we don't need to check integrity.
          if (local.authId === privateKey) return Promise.resolve()

          log('resolution part title', 'integrityCheck')

          /**
             * Check if the values in the request are acceptable.
             * @param {import('./utils').Request} req The request to analyse
             * @param {string[]} primitives The array of primitive keys corresponding to existing column tables
             * @param {string[]} objects The array of object keys corresponding to existing foreign keys
             * @param {string[]} arrays The array of arrays keys corresponding to existing association tables
             * @returns {boolean} True if valid, false otherwise.
             * @throws Throws an error if the request is malformed
             **/
          function checkEntry (req, primitives, objects, arrays) {
            /**
               * Check if the value is acceptable for a primitive
               * @param {any} value The value to check
               * @param {string} key The column name this value is relative to
               * @returns {boolean} True if valid, false otherwise.
               * @throws Throws an error if the request is malformed
               **/
            function isValue (value, key) {
              if (value === null) return true
              if (isPrimitive(value)) return true
              // This is the way to represent OR condition
              if (Array.isArray(value)) return value.every(v => isValue(v, key))
              // This is the way to create a AND condition
              if (value instanceof Object) return Object.keys(value).every(k => operators.includes(k) && isValue(value[k], key))
              throw new Error(`Bad value ${value} provided for field ${key} in table ${tableName}. We expect null, a ${tablesModel[key].type}, an object, or an array of these types during request ${stringify(req)}.`)
            }

            /**
               * Check if the value is acceptable for an object or an array
               * @param {any} value The value to check
               * @param {string} key The column name this value is relative to
               * @returns {boolean} True if valid, false otherwise.
               * @throws Throws an error if the request is malformed
               **/
            function isObject (value, key) {
              if (value !== null && isPrimitive(value)) throw new Error(`Bad value ${value} provided for field ${key} in table ${tableName}. We expect null, an object, or an array of these types during request ${stringify(req)}.`)
              return true
            }

            // Check if the values are acceptable for primitives, objects and arrays
            return primitives.every(key => isValue(req[key], key)) &&
                [...objects, ...arrays].every(key => isObject(req[key], key))
          }
          /**
             * Ensure that the types of each value are matching the column type
             * @param {string[]} keys The keys to check
             * @param {Object.<string, any>} values The values associated to those keys
             * @param {import('./utils').Table} model The data model where we can check the expected type
             * @returns {string} True if the value is
             */
          function wrongType (keys, values, model) {
            return keys.find(key => !isTypeCorrect(key, values[key], model[key].type))
            /**
               * Ensure that the types of each value are matching the column type
               * @param {string} key The key to check
               * @param {any} value The values associated to this keys
               * @param {import('./utils').ColumnType} type The data model where we can check the expected type
               * @returns {boolean} True if the value is
               */
            function isTypeCorrect (key, value, type) {
              if (value === undefined || value === null) return !model[key].notNull
              switch (type) {
                case 'string':
                case 'varchar':
                case 'text':
                  return Object(value) instanceof String
                case 'char':
                  return (Object(value) instanceof String) && value.length === 1
                case 'integer':
                case 'year':
                  return Number.isInteger(value)
                case 'double':
                case 'decimal':
                case 'float':
                  return !Number.isNaN(value)
                case 'date':
                case 'dateTime':
                  // isNaN(Data) makes it possible to check if a date is valid
                  return (Object(value) instanceof Date) || !isNaN(/** @type {any} **/(new Date(value)))
                case 'boolean':
                  return Object(value) instanceof Boolean
                case 'binary':
                case 'varbinary':
                  return value instanceof Buffer
                case 'json':
                default:
                  return value instanceof Object
              }
            }
          }

          try {
            checkEntry(request, primitives, objects, arrays)
            // Only one instructions among create, delete, get in each request
            if (request.create && request.delete) throw new Error(`Each request can contain only one among 'create' or 'delete'. The request was : ${stringify(request)}.`)
            // Check that set instruction is acceptable
            if (request.set) {
              if (Array.isArray(request.set) || !(request instanceof Object)) throw new Error(`The 'set' instruction ${stringify(request.set)} provided in table ${tableName} is not a plain object. A plain object is required for 'set' instructions. The request was : ${stringify(request)}.`)
              const { primitives: setPrimitives, objects: setObjects, arrays: setArrays } = classifyRequestData(request.set, table)
              checkEntry(request.set, setPrimitives, setObjects, setArrays)
              const wrongKey = wrongType(setPrimitives, request.set, tablesModel[tableName])
              if (wrongKey) throw new Error(`The value ${stringify(request.set[wrongKey])} for ${wrongKey} in table ${tableName} is of type ${toType(request.set[wrongKey])} but it was expected to be of type ${tablesModel[tableName][wrongKey].type}. The request was : ${stringify(request)}.`)
            }
            // Check that create instruction is acceptable
            if (request.create) {
              const wrongKey = wrongType(primitives, request, tablesModel[tableName])
              if (wrongKey) throw new Error(`The value ${stringify(request[wrongKey])} for ${wrongKey} in table ${tableName} is of type ${toType(request[wrongKey])} but it was expected to be of type ${tablesModel[tableName][wrongKey].type}. The request was : ${stringify(request)}.`)
            }
            // Check that there is not add or remove instruction in object fields
            const unwantedInstruction = objects.find(key => request[key].add || request[key].remove)
            if (unwantedInstruction) throw new Error(`Do not use 'add' or 'remove' instructions within ${unwantedInstruction} parameter in table ${tableName}. You should use the 'set' instruction instead. The request was : ${stringify(request)}.`)
            // Cannot add or remove elements from arrays in create or delete requests
            if (request.create || request.delete) {
              const addOrRemove = arrays.find(key => request[key].add || request[key].remove)
              if (addOrRemove) {
                throw new Error(request.create ? `In create requests, you cannot have 'add' or 'remove' instructions in ${addOrRemove} in table ${tableName}. To add children, just write the constraints directly under ${addOrRemove}. The request was : ${stringify(request)}.`
                  : `In delete requests, you cannot have 'add' or 'remove' instructions in ${addOrRemove} in table ${tableName}. When deleting an object, the associations with this object will be automatically removed. The request was : ${stringify(request)}.`)
              }
            }
            // Check limit, offset and order instructions
            if (request.limit && !Number.isInteger(request.limit)) throw new Error(`'Limit' statements requires an integer within ${tableName}. We received: ${request.limit} instead. The request was : ${stringify(request)}.`)
            if (request.offset && !Number.isInteger(request.offset)) throw new Error(`'Offset' statements requires an integer within ${tableName}. We received: ${request.offset} instead. The request was : ${stringify(request)}.`)
            if (request.order) {
              // Ensure that order is an array of strings
              if (!Array.isArray(request.order)) throw new Error(`'order' statements requires an array of column names within ${tableName} request. We received: ${request.order} instead. The request was : ${stringify(request)}.`)
              // Ensure that it denotes only existing columns
              const columns = Object.keys(tablesModel[tableName])
              const unfoundColumn = request.order.find(column =>
                column.startsWith('-') ? !columns.includes(column.substring(1)) : !columns.includes(column)
              )
              if (unfoundColumn) throw new Error(`'order' statement requires an array of property names within ${tableName}, but ${unfoundColumn} doesn't belong to this table. The request was : ${stringify(request)}.`)
            }
            return Promise.resolve()
          } catch (err) {
            return Promise.reject({ name: BAD_REQUEST, message: err.message })
          }
        }

        /**
           * We look for objects that match the request constraints and store their id into the key+Id property
           * and add the objects into this.resolvedObjects map
           * @returns {Promise<void>}
           **/
        async function getObjects () {
          log('resolution part title', 'getObjects')
          // We resolve the children objects
          return sequence(objects.map(key => () => {
            // If we are looking for null value...
            if (!request[key]) {
              request[key] = null
              return Promise.resolve([])
            } else {
              const column = /** @type {import('./utils').TableValue} */(table[key])
              // We get the children id and define the key+Id property accordingly
              return applyInTable(request[key], column.tableName).then(result => {
                if (result.length === 0 && request[key].required) {
                  return Promise.reject({
                    name: NOT_FOUND,
                    message: `Nothing found with these constraints : ${tableName}->${key}->${JSON.stringify(request[key])}`
                  })
                } else if (result.length > 1) {
                  return Promise.reject({
                    name: NOT_UNIQUE,
                    message: `We found multiple solutions for setting key ${key} in ${tableName}: ${JSON.stringify(request[key])}.`
                  })
                } else request[key] = result[0]
              })
            }
          })).then(() => {})
        }

        /** Filter the results that respond to the arrays constraints. **/
        async function getChildrenArrays () {
          log('resolution part title', 'getChildrenArrays')
          return sequence(arrays.map(key =>
            // We resolve queries about arrays
            () => applyInTable(request[key], table[key][0].tableName)
              .then(arrayResults => request[key] = arrayResults)
          )).then(() => {})
        }

        /**
           * Insert elements inside the table if request.create is defined
           * @returns {Promise<import('./utils').Element[]>} The objects created or an empty list
           **/
        async function create () {
          if (!request.create) return Promise.resolve([])
          log('resolution part title', 'create')
          // TODO gérer les références internes entre créations (un message et un feed par exemple ? un user et ses contacts ?)
          return getObjects().then(getChildrenArrays).then(() => {
            /** @type {import('./utils').Element} **/
            const element = { reservedId: undefined }
            // FIXME : we should be able to create more than one object if necessary
            // Make sure we cannot create more than one object at a time
            const array = primitives.find(key => Array.isArray(request[key]))
            if (array) {
              return Promise.reject({
                name: BAD_REQUEST,
                message: `It is not allowed to provide an array for key ${array} in table ${tableName} during creation. The request was : ${stringify(request)}.`
              })
            }

            // Add primitives values to be created
            primitives.forEach(key => element[key] = request[key])
            // Link the object found to the new element if an object was found
            objects.forEach(key => element[key + 'Id'] = request[key] ? request[key].reservedId : null)
            // Create the elements inside the database
            return driver.create({ table: tableName, elements: element })
              .then(([reservedId]) => {
                // Add the newly created reservedId
                element.reservedId = reservedId
                // Replace the ids by their matching objects in the result
                objects.forEach(key => {
                  element[key] = request[key]
                  delete element[key + 'Id']
                })
                // Add the arrays elements found to the newly created object
                arrays.forEach(key => element[key] = request[key])
                // Link the newly created element to the arrays children via the association table
                return sequence(arrays.map(key => () => driver.create({
                  table: `${key}${tableName}`,
                  elements: {
                    [tableName + 'Id']: element.reservedId,
                    [key + 'Id']: request[key].map(child => child.reservedId)
                  }
                })))
              })
              .then(() => element.created = true)
              .then(() => addCache(element))
              .then(() => pluginCall(element, 'onCreation'))
              // Return the element as results of the query
              .then(() => [element])
          })
        }

        /**
           * Look into the database for objects matching the constraints.
           * @returns {Promise<import('./utils').Element[]>} The request results
           **/
        async function get () {
          log('resolution part title', 'get')
          if (!search.includes('reservedId')) search.push('reservedId')
          // Create the where clause
          const where = {}
          const searchKeys = [...search, ...objects.map(key => key + 'Id')]
          // We need to retrieve the current values
          if (request.set) {
            const { primitives: primitivesSet, objects: objectsSet } = classifyRequestData(request.set, table)
            primitivesSet.forEach(key => { if (!searchKeys.includes(key)) searchKeys.push(key) })
            objectsSet.forEach(key => { if (!searchKeys.includes(key + 'Id')) searchKeys.push(key + 'Id') })
          }
          let impossible = false
          primitives.map(key => {
            // If we have an empty array as a constraint, it means that no value can satisfy the constraint
            if (Array.isArray(request[key]) && !request[key].length) impossible = true
            where[key] = request[key]// We don't consider empty arrays as valid constraints
            if (!searchKeys.includes(key)) searchKeys.push(key)
          })
          if (impossible) return Promise.resolve([])
          // We try to read the data from the cache
          const cachedData = readCache(request.reservedId, search)
          if (cachedData) return Promise.resolve([cachedData])
          return driver.get({
            table: tableName,
            // we will need the objects ids to retrieve the corresponding objects
            search: searchKeys,
            where,
            limit: parseInt(/** @type {any} **/(request.limit), 10),
            offset: parseInt(/** @type {any} **/(request.offset), 10),
            order: request.order
          })
            // We add the date to the cache as they were received from the database
            .then(results => {
              results.forEach(addCache)
              return results
            })
          // .then(results => {
          //   //We add the primitives constraints to the result object
          //   results.forEach(result => primitives.forEach(key => result[key] = request[key]));
          //   return results;
          // });
        }

        /**
           * We will now read the data of the objects we previously mapped to the results
           * @param {import('./utils').Element[]} results The current results
           * @returns {Promise<import('./utils').Element[]>} The updated results
           */
        async function resolveObjects (results) {
          log('resolution part title', 'resolveObjects')
          return sequence(objects.map(key => () => sequence(results.map(result => () => {
            // If we are looking for null values, no need to query the foreign table.
            if (!request[key]) {
              request[key] = null
              return Promise.resolve()
            }
            const foreignTable = /** @type {import('./utils').TableValue} **/(table[key])
            request[key].reservedId = result[key + 'Id']
            return applyInTable(request[key], foreignTable.tableName).then(objects => {
              if (objects.length === 0 && request[key].required) {
                return Promise.reject({
                  name: NOT_FOUND,
                  message: `Nothing found with these constraints : ${tableName}->${key}->${JSON.stringify(request[key])}`
                })
              } else if (objects.length > 1) {
                return Promise.reject({
                  name: DATABASE_ERROR,
                  message: `We found more than one object for key ${key} with the id ${result[key + 'Id']} in table ${foreignTable.tableName}`
                })
              } else {
                delete result[key + 'Id']
                result[key] = objects[0]
              }
            })
          })))).then(() => results)
        }

        /**
           * Filter the results that respond to the arrays constraints.
           * @param {import('./utils').Element[]} results The current results
           * @returns {Promise<import('./utils').Element[]>} The updated results
           **/
        async function resolveChildrenArrays (results) {
          log('resolution part title', 'resolveChildrenArrays')
          // We keep only the arrays constraints that are truly constraints. Constraints that have keys other than 'add' or 'remove'.
          const realArrays = arrays.filter(key => request[key] && Object.keys(request[key]).find(k => !['add', 'remove'].includes(k)))
          return sequence(results.map(result =>
            () => sequence(realArrays.map(key =>
              // We look for all objects associated to the result in the association table
              () => driver.get({
                table: `${key}${tableName}`,
                search: [key + 'Id'],
                where: {
                  [tableName + 'Id']: result.reservedId
                },
                offset: request[key].offset,
                limit: request[key].limit,
                order: request[key].order
              })
                .then(associatedResults => {
                  if (!associatedResults.length) return []
                  // We look for objects that match all the constraints
                  request[key].reservedId = associatedResults.map(res => res[key + 'Id'])
                  return applyInTable(request[key], table[key][0].tableName)
                })
                .then(arrayResults => {
                  // We register the data into the result
                  result[key] = arrayResults
                })
            ))
          ))
            // If the constraint is 'required', we keep only the results that have a matching solution in the table for each array's constraint
            .then(() => results.filter(result => realArrays.every(key => !request[key].required || result[key].length)))
        }

        /**
           * Remove elements from the table if request.delete is defined
           * @param {import('./utils').Element[]} results The current results
           * @returns {Promise<import('./utils').Element[]>} The updated results
           */
        async function remove (results) {
          if (!request.delete) return Promise.resolve(results)
          log('resolution part title', 'delete')
          // If there is no results, there is nothing to delete
          if (!results.length) return Promise.resolve(results)
          // Look for matching objects
          return driver.delete({
            table: tableName,
            where: { reservedId: results.map(r => r.reservedId) }
          })
            // Mark the results as deleted inside the results
            .then(() => results.forEach(result => result.deleted = true))
            .then(() => results.forEach(uncache))// The content is not anymore in the database. Data became unsafe.
            .then(() => pluginCall(results, 'onDeletion'))
            .then(() => results)
        }

        /**
           * Change the table's values if request.set is defined
           * @param {import('./utils').Element[]} results The current results
           * @returns {Promise<import('./utils').Element[]>} The updated results
           */
        async function update (results) {
          if (!request.set) return Promise.resolve(results)
          if (!results.length) return Promise.resolve(results)
          log('resolution part title', 'update')
          const { primitives: primitivesSet, objects: objectsSet, arrays: arraysSet } = classifyRequestData(request.set, table)
          // If previous values where not converted into objects yet, we do it now.
          objectsSet.forEach(key => results.forEach(result => result[key + 'Id'] && (result[key] = { reservedId: result[key + 'Id'] }) && delete result[key + 'id']))
          // Read the current values before update
          const currentValues = {}
          const updatedKeys = [...primitivesSet, ...objectsSet]
          results.forEach(result => currentValues[result.reservedId] = filterObject(result, updatedKeys))
          /** @type {Object.<string, string | number>} */
          const values = {} // The values to be edited
          const removed = {}// The elements that have been removed
          const added = {}// The elements that have been added
          // Mark the elements as being edited
          results.forEach(result => result.edited = true)
          // Update the results with primitives values
          primitivesSet.forEach(key => {
            results.forEach(result => result[key] = request.set[key])
            values[key] = request.set[key]
          })
          // Cache the updated results
          results.forEach(addCache)
          // Find the objects matching the constraints to be replaced
          return sequence(objectsSet.map(key =>
            () => applyInTable(request.set[key], /** @type {import('./utils').TableValue} **/(table[key]).tableName)
              .then(matches => {
                if (matches.length === 0) {
                  return Promise.reject({
                    name: NOT_SETTABLE,
                    message: `We could not find the object supposed to be set for key ${key} in ${tableName}: ${JSON.stringify(request.set[key])}.`
                  })
                } else if (matches.length > 1) {
                  return Promise.reject({
                    name: NOT_UNIQUE,
                    message: `We found multiple solutions for setting key ${key} in ${tableName}: ${JSON.stringify(request.set[key])}.`
                  })
                }
                // Only one result
                else {
                  // Update the results with found object values
                  results.forEach(result => {
                    result[key] = matches[0]
                    values[key + 'Id'] = matches[0].reservedId
                  })
                }
              })
          ))
            // Reduce the request to only the primitives and objects ids constraints
            .then(() => {
              return Object.keys(values).length ? driver.update({
                table: tableName,
                values,
                where: { reservedId: results.map(result => result.reservedId) }
              }) : Promise.resolve()
            })
            .then(() => pluginCall({ objects: results, oldValues: currentValues, newValues: results.length ? filterObject(results[0], updatedKeys) : {} }, 'onUpdate'))

            // Replace arrays of elements by the provided values
            .then(() => sequence(arraysSet.map(key => () =>
              driver.get({ table: `${key}${tableName}`, search: [key + 'Id'], where: { [tableName + 'Id']: results.map(r => r.reservedId) } })
                .then(deleted => removed[key] = deleted.map(d => ({ reservedId: d[key + 'Id'] })))
                .then(() =>
                // Delete any previous value
                  driver.delete({
                    table: `${key}${tableName}`,
                    where: {
                      [tableName + 'Id']: results.map(r => r.reservedId)
                    }
                  })
                  // Look for elements matching the provided constraints
                    .then(() => applyInTable(request.set[key], `${key}${tableName}`))
                  // Create the new links
                    .then(matches => driver.create({
                      table: `${key}${tableName}`,
                      elements: {
                        [tableName + 'Id']: results.map(r => r.reservedId),
                        [key + 'Id']: matches.map(match => match.reservedId)
                      }
                    })
                    // Attach the matching elements to the results
                      .then(() => added[key] = matches)
                      .then(() => results.forEach(result => result[key] = matches))
                    )
                ))))
          // If we added or removed something, we call the plugins listeners
            .then(() => pluginCall({ objects: results, added, removed }, 'onListUpdate'))
          // We return the research results
            .then(() => results)
        }

        /**
           * If we are using 'add' or 'remove' instruction on an associated table, we cut the link between the objects
           * @param {import('./utils').Element[]} results The current results
           * @returns {Promise<import('./utils').Element[]>} The updated results
           */
        async function updateChildrenArrays (results) {
          log('resolution part title', 'updateChildrenArrays')
          if (!results.length) return Promise.resolve(results)
          const removed = {}
          const added = {}
          return sequence(arrays.map(key => () => {
            const { add, remove } = request[key]
            return Promise.resolve()
              // We remove elements from the association table
              .then(() => {
                if (!remove) return Promise.resolve()
                return applyInTable(remove, table[key][0].tableName)
                  .then(arrayResults => driver.delete({
                    table: `${key}${tableName}`,
                    where: {
                      [tableName + 'Id']: results.map(result => result.reservedId),
                      [key + 'Id']: arrayResults.map(result => result.reservedId)
                    }
                  }).then(() => { removed[key] = arrayResults }))
              })
            // We add elements into the association table
              .then(() => {
                if (!add) return Promise.resolve()
                // We look for the elements we want to add in the association table
                return applyInTable(add, table[key][0].tableName)
                  // We link these elements to the results
                  .then(arrayResults => driver.create({
                    table: `${key}${tableName}`,
                    elements: {
                      [tableName + 'Id']: results.map(result => result.reservedId),
                      [key + 'Id']: arrayResults.map(result => result.reservedId)
                    }
                  })
                  // Attach the matching elements to the results
                    .then(() => added[key] = arrayResults)
                    .then(() => results.forEach(result => result[key] = arrayResults))
                  )
              })
          }))
          // If we added or removed something, we call the plugins listeners
            .then(() => pluginCall({ objects: results, added, removed }, 'onListUpdate'))
            .then(() => results)
        }

        /**
           * Check if the request is respecting the access rules
           * @param {import('./utils').Element[]} results The request results
           * @returns {Promise<import('./utils').Element[]>} The request results filtered according to access rules
           */
        async function controlAccess (results) {
          // If this request is authenticated with the privateKey, we don't need to control access.
          if (local.authId === privateKey) return Promise.resolve(results)
          log('resolution part title', 'controlAccess')
          const ruleSet = rules[tableName]

          return sequence(results.map(result => () => {
            const ruleData = { authId: local.authId, request: { ...request, parent: parentRequest }, object: result, query }

            // Read access
            return Promise.resolve().then(() => {
              // Check table level rules
              if (ruleSet.read) return ruleSet.read(ruleData).catch(err => err)
            }).then(err => sequence(Object.keys(table).map(key => () => {
              // Data not requested
              if (!result[key]) return Promise.resolve()
              // Check property specific rules
              return Promise.resolve().then(() => {
                if (ruleSet[key] && ruleSet[key].read) return ruleSet[key].read(ruleData)
                else if (err) return Promise.reject(err)
              })
                .catch(err => {
                  log('access warning', `Access denied for field ${key} in table ${tableName} for authId ${local.authId}. Error : ${err.message || err}`)
                  // Hiding sensitive data
                  // result[key] = 'Access denied';
                  delete result[key]
                })
            }))

              // Write access
              .then(() => {
                if (ruleSet.write) return ruleSet.write(ruleData).catch(err => err)
              }).then(err => {
                // Manage set instructions
                return Promise.resolve().then(() => {
                  if (!request.set) return Promise.resolve()
                  const { primitives: setPrimitives, objects: setObjects } = classifyRequestData(request.set, table)
                  return sequence([...setPrimitives, ...setObjects].map(key =>
                    () => Promise.resolve().then(() => {
                      if (ruleSet[key] && ruleSet[key].write) return ruleSet[key].write(ruleData)
                      else if (err) return Promise.reject(err)
                    }).catch(err => Promise.reject({
                      name: UNAUTHORIZED,
                      message: `User ${local.authId} is not allowed to edit field ${key} in table ${tableName}. Error : ${err.message || err}`
                    }))
                  )).then(() => {})
                })

                  // Manage create instructions
                  .then(() => {
                    if (!request.create) return Promise.resolve()
                    return Promise.resolve().then(() => {
                      if (ruleSet.create) return ruleSet.create(ruleData)
                      else if (err) return Promise.reject(err)
                    }).catch(err => Promise.reject({
                      name: UNAUTHORIZED,
                      message: `User ${local.authId} is not allowed to create elements in table ${tableName}. Error : ${err.message || err}`
                    }))
                  })

                  // Manage delete instructions
                  .then(() => {
                    if (!request.delete) return Promise.resolve()
                    return Promise.resolve().then(() => {
                      if (ruleSet.delete) return ruleSet.delete(ruleData)
                      else if (err) return Promise.reject(err)
                    }).catch(err => Promise.reject({
                      name: UNAUTHORIZED,
                      message: `User ${local.authId} is are not allowed to delete elements from table ${tableName}. Error : ${err.message || err}`
                    }))
                  })

                  // Manage add instructions
                  .then(() => sequence(arrays.map(key => () => {
                    if (!request[key].add) return Promise.resolve()
                    return Promise.resolve().then(() => {
                      if (ruleSet[key] && ruleSet[key].add) return ruleSet[key].add(ruleData)
                      else if (err) return Promise.reject(err)
                    }).catch(err => Promise.reject({
                      name: UNAUTHORIZED,
                      message: `User ${local.authId} is not allowed to create ${key} in table ${tableName}. Error : ${err.message || err}`
                    }))
                  })))

                  // Manage remove instructions
                  .then(() => sequence(arrays.map(key => () => {
                    if (!request[key].remove) return Promise.resolve()
                    return Promise.resolve().then(() => {
                      if (ruleSet[key] && ruleSet[key].remove) return ruleSet[key].remove(ruleData)
                      else if (err) return Promise.reject(err)
                    }).catch(err => Promise.reject({
                      name: UNAUTHORIZED,
                      message: `User ${local.authId} is not allowed to remove ${key} from table ${tableName}. Error : ${err.message || err}`
                    }))
                  })))
              })
            )
            // We return only the results where access was not fully denied
          }))
            .then(() => results.filter(result => Object.values(result).find(value => value !== 'Access denied')))
        }
      }
    }
  }
}

module.exports = createRequestHandler
