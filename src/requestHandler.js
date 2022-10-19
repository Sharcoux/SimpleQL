// @ts-check

/** This is the core of SimpleQL where every request is cut in pieces and transformed into a query to the database */
const { isPrimitive, toType, classifyRequestData, operators, sequence, stringify, filterObject, formatRequest } = require('./utils')
const { NOT_SETTABLE, NOT_UNIQUE, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, ACCESS_DENIED, WRONG_VALUE } = require('./errors')
const log = require('./utils/logger')
const Cache = require('./utils/cache')

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
function createRequestHandler (requestHandlerParams) {
  const processor = new RequestProcessor(requestHandlerParams)
  return processor.requestHandler
}

/**
 * This RequestProcessor will handle the logic of request processing
 * in SimpleQL. It builds a requestHandler, holding the data needed
 * for the requests to be treated.
 */
class RequestProcessor {
  /**
   * @param {CreateRequestHandlerParams} requestHandlerParams
   */
  constructor (requestHandlerParams) {
    this.inTransaction = false
    this.requestHandlerParams = requestHandlerParams
    this.requestHandler = this.requestHandler.bind(this)
    this.setInTransaction = this.setInTransaction.bind(this)
  }

  setInTransaction (inTransaction) {
    this.inTransaction = inTransaction
  }

  /** @type {RequestHandler} */
  async requestHandler (request, locals) {
    if (!locals.authId) locals.authId = ''
    if (!locals.readOnly) locals.readOnly = false
    if (this.inTransaction) return Promise.reject('A transaction is already in progress. You should not be calling this method right now. Check the documentation about plugins tu see how you can request your database within a plugin method.')

    const resolver = new RequestResolver(this.requestHandlerParams, request, locals)
    return resolver.handleRequest(this.setInTransaction)
  }
}

/**
 * This Request Resolver will take a request, cut it into small requests
 * for each table, and join the results.
 */
class RequestResolver {
  /**
   *
   * @param {CreateRequestHandlerParams} requestHandlerParams
   * @param {import('./utils').Request} request
   * @param {import('./plugins').Local} locals
   */
  constructor (requestHandlerParams, request, locals) {
    const { driver, plugins, privateKey, rules, tables, tablesModel } = requestHandlerParams
    this.driver = driver
    this.plugins = plugins
    this.privateKey = privateKey
    this.rules = rules
    this.tables = tables
    this.tablesModel = tablesModel
    this.locals = locals
    // We cache the requests made into the database
    this.cache = new Cache()
    this.request = request
    this.handleRequest = this.handleRequest.bind(this)
    this.resolve = this.resolve.bind(this)
    this.query = this.query.bind(this)
    this.resolveInTable = this.resolveInTable.bind(this)
  }

  /**
   * Handle a SimpleQL request in the database
   * @param {(inTransaction: boolean) => void} setInTransaction Calling this will lock or unlock the database for new requests while making a transaction
   * @returns {Promise<import('./utils').Result>}
   */
  async handleRequest (setInTransaction) {
    // We start a transaction to resolve the request
    try {
      await this.driver.startTransaction()
      setInTransaction(true)
      // We resolve the request in each table separately
      const results = await this.resolve(this.request, this.locals)
      // We let the plugins know that the request will be committed and terminate successfully
      await sequence(this.plugins.map(plugin => plugin.onSuccess).filter(s => s).map(onSuccess => () => onSuccess(results, { request: this.request, query: this.query, local: this.locals, isAdmin: this.locals.authId === this.privateKey })))
      // We terminate the request and commit all the changes made to the database
      await this.driver.commit()
      setInTransaction(false)
      return results
    } catch (err) {
      // We terminate the request and rollback all the changes made to the database
      await this.driver.rollback().catch(err => console.error(err)) // We hav to catch any error happening in the rollback
      setInTransaction(false)
      // We let the plugins know that the request failed and the changes will be discarded
      await sequence(this.plugins.map(plugin => plugin.onError).filter(e => e).map(onError => () => onError(err, { request: this.request, query: this.query, local: this.locals, isAdmin: this.locals.authId === this.privateKey })))
      // If the plugins didn't generate a new error, we throw the original error event.
      return Promise.reject(err)
    }
  }

  /**
   * Function needed to query the database from rules or plugins.
   * Function provided to execute SimpleQL requests into the database, potentially with admin rights
   * @param {import('./utils').Request} request The request to execute in the database
   * @param {import('./utils').RequestOptions} options The request options
   * @return {Promise<import('./utils').Result>} The result of the request
   **/
  async query (request, { readOnly, admin }) {
    return this.resolve(request, { authId: admin ? this.privateKey : this.locals.authId, readOnly })
  }

  /**
   * Resolve a full simple-QL request.
   * Note: local is unique for each query, while locals is being shared for the whole request
   * @param {import('./utils').Request} request The full request
   * @param {import('./plugins').Local} local An object containing all parameters persisting during the whole request resolving process for each query.
   * @returns {Promise<import('./utils').Result>} The full result of the request
   */
  async resolve (request, local) {
    // We keep only the requests where objects requested are described inside a table
    const keys = Object.keys(request).filter(key => this.tables[key])
    /** @type {import('./utils').Result} */
    const finalResult = {}
    await sequence(keys.map(key => async () => {
      // We resolve each piece of request in each table
      const result = await this.resolveInTable({ tableName: key, request: request[key], local })
      // We associate back the results to each key
      finalResult[key] = result
    }))
    return finalResult
  }

  /**
   * Resolve the provided local request for the specified table, including creation or deletion of elements.
   * @param {{ tableName: string; request: import('./utils').Request; parentRequest?: import('./utils').Request; local: import('./plugins').Local}} tableName the name of the table to look into
   * @returns {Promise<import('./utils').Element[]>} The result of the local (partial) request
   */
  async resolveInTable ({ tableName, request, parentRequest, local }) {
    if (!request) {
      return Promise.reject({
        name: BAD_REQUEST,
        message: `The request was ${request} in table ${tableName}`
      })
    }

    // If an array is provided, we concatenate the results of the requests
    if (Array.isArray(request)) {
      const results = await sequence(request.map(part => () => this.resolveInTable({ tableName, request: part, parentRequest, local })))
      // [].concat(...array) will flatten the array.
      return [].concat(...results)
    }

    const tableResolver = new TableResolver(this, tableName, parentRequest, local)
    return tableResolver.resolve(request)
  }
}

/**
 * This Table Resolver is in charge of resolving a request within a specific table.
 */
class TableResolver {
  /**
   * The request resolver that created this TableResolver
   * @param {RequestResolver} requestResolver
   * @param {string} tableName The table where the request is being executed
   * @param {import('./utils').Request=} parentRequest The request that holds this inner request
   * @param {import('./plugins').Local=} local An object containing data shared suring the request processing
   */
  constructor (requestResolver, tableName, parentRequest, local) {
    this.requestResolver = requestResolver
    this.table = requestResolver.tables[tableName]
    this.tableName = tableName
    this.parentRequest = parentRequest
    this.local = local
    this.isAdmin = local.authId === requestResolver.privateKey
    this.rules = this.requestResolver.rules
    this.driver = this.requestResolver.driver
    this.cache = this.requestResolver.cache

    this.updateRequestData = this.updateRequestData.bind(this)
    this.create = this.create.bind(this)
    this.remove = this.remove.bind(this)
    this.update = this.update.bind(this)
    this.updateChildrenArrays = this.updateChildrenArrays.bind(this)
    this.resolveChildrenArrays = this.resolveChildrenArrays.bind(this)
    this.get = this.get.bind(this)
    this.resolve = this.resolve.bind(this)
    this.resolveObjects = this.resolveObjects.bind(this)
    this.getObjects = this.getObjects.bind(this)
    this.getChildrenArrays = this.getChildrenArrays.bind(this)
    this.controlAccess = this.controlAccess.bind(this)
    this.pluginCall = this.pluginCall.bind(this)
    this.applyInTable = this.applyInTable.bind(this)
  }

  /**
   * Split a request into its different parts
   * @param {import('./utils').FormattedRequest} req The request to analyse
   */
  updateRequestData (req) {
    const { request, search, primitives, objects, arrays } = classifyRequestData(req, this.table)
    this.request = request
    this.search = search
    this.primitives = primitives
    this.objects = objects
    this.arrays = arrays
  }

  /**
   * Resolve the provided local request for the specified table, including creation or deletion of elements.
   * @returns {Promise<import('./utils').Element[]>} The result of the local (partial) request
   */
  async resolve (initialRequest) {
    // Ensure that the request is correctly formatted
    const formattedRequest = formatRequest(initialRequest, this.table)

    await this.pluginCall(initialRequest, 'onRequest')
    log('resolution part', 'treating : ', this.tableName, JSON.stringify(initialRequest))
    this.updateRequestData(formattedRequest)

    // We look for objects matching the objects constraints
    try {
      // Check that the request is valid
      if (!this.isAdmin) { // If this request is authenticated with the privateKey, we don't need to check integrity.
        log('resolution part title', 'integrityCheck')
        const checker = new RequestChecker(this)
        await checker.check()
      }
      // Create and delete requests are ignored if readOnly is set
      if (this.local.readOnly && (this.request.create || this.request.delete)) return []
      else {
        // retrieve the objects from other tables
        await this.resolveObjects()
        let results = null
        // Insert elements inside the database if request.create is set
        if (this.request.create) results = await this.create()
        // Retrieve data from the database
        else results = await this.get()
        // Retrieve the objects associated through association tables
        results = await this.resolveChildrenArrays(results)
        // In read only mode, skip the next steps
        if (!this.local.readOnly) {
          await this.pluginCall(results, 'onProcessing')
          // If request.delete is set, we need to make the access control prior to altering the tables
          if (this.request.delete) results = await this.controlAccess(results)
          // Delete elements from the database if request.delete is set
          results = await this.remove(results)
          // Update table data
          results = await this.update(results)
          // Add or remove items from the association tables
          results = await this.updateChildrenArrays(results)
        }
        await this.pluginCall(results, 'onResult')
        // We control the data accesses
        if (!this.request.delete) results = await this.controlAccess(results)
        return results
      }
    } catch (err) {
      // If nothing matches the request, the result should be an empty array
      if (err.name === NOT_FOUND) return Promise.resolve([])
      if (err.name === WRONG_VALUE) return Promise.reject({ name: ACCESS_DENIED, message: `You are not allowed to access some data needed for your request in table ${this.tableName}.` })
      console.error(err)
      return Promise.reject(err)
    }
  }

  /**
   * Insert elements inside the table if request.create is defined
   * @returns {Promise<import('./utils').Element[]>} The objects created or an empty list
   **/
  async create () {
    if (!this.request.create) return Promise.resolve([])
    log('resolution part title', 'create')
    // TODO gérer les références internes entre créations (un message et un feed par exemple ? un user et ses contacts ?)
    await this.getObjects()
    await this.getChildrenArrays()
    /** @type {import('./utils').Element} **/
    const element = { reservedId: undefined }
    // FIXME : we should be able to create more than one object if necessary
    // Make sure we cannot create more than one object at a time
    const array = this.primitives.find(key => Array.isArray(this.request[key]))
    if (array) {
      return Promise.reject({
        name: BAD_REQUEST,
        message: `It is not allowed to provide an array for key ${array} in table ${this.tableName} during creation. The request was : ${stringify(this.request)}.`
      })
    }

    // Add primitives values to be created
    this.primitives.forEach(key => element[key] = this.request[key])
    // Link the object found to the new element if an object was found
    this.objects.forEach(key => element[key + 'Id'] = this.request[key] ? this.request[key].reservedId : null)
    // Create the elements inside the database
    const [reservedId] = await this.driver.create({ table: this.tableName, elements: element })
    // Add the newly created reservedId
    element.reservedId = reservedId
    // Replace the ids by their matching objects in the result
    this.objects.forEach(key => {
      element[key] = this.request[key]
      delete element[key + 'Id']
    })
    // Add the arrays elements found to the newly created object
    this.arrays.forEach(key => element[key] = this.request[key])
    // Link the newly created element to the arrays children via the association table
    await sequence(this.arrays.map(key => () => this.driver.create({
      table: `${key}${this.tableName}`,
      elements: {
        [this.tableName + 'Id']: element.reservedId,
        [key + 'Id']: this.request[key].map(child => child.reservedId)
      }
    })))
    element.created = true
    this.cache.addCache(this.tableName, element)
    await this.pluginCall(element, 'onCreation')
    // Return the element as results of the query
    return [element]
  }

  /**
   * We look for objects that match the request constraints and store their id into the key+Id property
   * and add the objects into this.resolvedObjects map
   * @returns {Promise<void>}
   **/
  async getObjects () {
    log('resolution part title', 'getObjects')
    // We resolve the children objects
    await sequence(this.objects.map(key => async () => {
      // If we are looking for null value...
      if (!this.request[key]) {
        this.request[key] = null
        return Promise.resolve([])
      } else {
        const column = /** @type {import('./utils').TableValue} */(this.table[key])
        // We get the children id and define the key+Id property accordingly
        const results = await this.applyInTable(this.request[key], column.tableName)
        if (results.length === 0 && this.request[key].required) {
          return Promise.reject({
            name: NOT_FOUND,
            message: `Nothing found with these constraints : ${this.tableName}->${key}->${JSON.stringify(this.request[key])}`
          })
        } else if (results.length > 1) {
          return Promise.reject({
            name: NOT_UNIQUE,
            message: `We found multiple solutions for setting key ${key} in ${this.tableName}: ${JSON.stringify(this.request[key])}.`
          })
        } else this.request[key] = results[0]
      }
    }))
  }

  /** Filter the results that respond to the arrays constraints. **/
  async getChildrenArrays () {
    log('resolution part title', 'getChildrenArrays')
    await sequence(this.arrays.map(key =>
    // We resolve queries about arrays
      async () => this.request[key] = await this.applyInTable(this.request[key], this.table[key][0].tableName)
    ))
  }

  /**
   * Look into the database for objects matching the constraints.
   * @returns {Promise<import('./utils').Element[]>} The request results
   **/
  async get () {
    log('resolution part title', 'get')
    if (!this.search.includes('reservedId')) this.search.push('reservedId')
    // Create the where clause
    const where = {}
    const searchKeys = [...this.search, ...this.objects.map(key => key + 'Id')]
    // We need to retrieve the current values
    if (this.request.set) {
      const { primitives: primitivesSet, objects: objectsSet } = classifyRequestData(this.request.set, this.table)
      primitivesSet.forEach(key => { if (!searchKeys.includes(key)) searchKeys.push(key) })
      objectsSet.forEach(key => { if (!searchKeys.includes(key + 'Id')) searchKeys.push(key + 'Id') })
    }
    let impossible = false
    this.primitives.forEach(key => {
      // If we have an empty array as a constraint, it means that no value can satisfy the constraint
      if (Array.isArray(this.request[key]) && !this.request[key].length) impossible = true
      where[key] = this.request[key]// We don't consider empty arrays as valid constraints
      if (!searchKeys.includes(key)) searchKeys.push(key)
    })
    this.objects.forEach(key => where[key + 'Id'] = this.request[key + 'Id'])
    if (impossible) return Promise.resolve([])
    // We try to read the data from the cache
    const ids = Array.isArray(this.request.reservedId) ? this.request.reservedId : [this.request.reservedId]
    const cachedData = ids.map(id => this.cache.readCache(this.tableName, id, searchKeys)).filter(data => data)
    if (cachedData.length === ids.length) return Promise.resolve(cachedData)
    const results = await this.driver.get({
      table: this.tableName,
      // we will need the objects ids to retrieve the corresponding objects
      search: searchKeys,
      where,
      limit: this.request.limit,
      offset: this.request.offset,
      order: this.request.order
    })
    // We add the date to the cache as they were received from the database
    this.objects.forEach(key => results.forEach(result => {
      result[key] = this.cache.readCache(/** @type {import('./utils').Table} **/(this.table[key]).tableName, result[key + 'Id'])
      delete this.request[key + 'Id']
      delete result[key + 'Id']
    }))
    results.forEach(result => this.cache.addCache(this.tableName, result))
    return results
    // .then(results => {
    //   //We add the primitives constraints to the result object
    //   results.forEach(result => primitives.forEach(key => result[key] = request[key]));
    //   return results;
    // });
  }

  /**
   * We will now read the data of the objects we previously mapped to the results
   * @returns {Promise<void>} The updated results
   */
  async resolveObjects () {
    log('resolution part title', 'resolveObjects')
    await sequence(this.objects.map(key => async () => {
      // If we are looking for null values, no need to query the foreign table.
      if (!this.request[key]) {
        this.request[key] = null
        return Promise.resolve()
      }
      const foreignTable = /** @type {import('./utils').TableValue} **/(this.table[key])
      let results = await this.applyInTable(this.request[key], foreignTable.tableName)
      results = results.filter(result => result.reservedId)
      if (results.length === 0) {
        if (this.request[key].required) { return Promise.reject({
          name: NOT_FOUND,
          message: `Nothing found with these constraints : ${this.tableName}->${key}->${JSON.stringify(this.request[key])}`
        }) }
        this.request[key + 'Id'] = []
      } else if (results.length > 1) {
        // return Promise.reject({
        //   name: DATABASE_ERROR,
        //   message: `We found more than one object for key ${key} with the constraint ${this.request[key]} in table ${foreignTable.tableName}`
        // })
        this.request[key + 'Id'] = results.map(res => res.reservedId)
        results.map(result => this.cache.addCache(foreignTable.tableName, result))
      } else {
        this.request[key + 'Id'] = results[0].reservedId
        this.cache.addCache(foreignTable.tableName, results[0])
      }
    }))
  }

  /**
   * Filter the results that respond to the arrays constraints.
   * @param {import('./utils').Element[]} results The current results
   * @returns {Promise<import('./utils').Element[]>} The updated results
   **/
  async resolveChildrenArrays (results) {
    log('resolution part title', 'resolveChildrenArrays')
    // We keep only the arrays constraints that are truly constraints. Constraints that have keys other than 'add' or 'remove'.
    const realArrays = this.arrays.filter(key => (this.request.get && this.request.get.includes(key)) || (this.request[key] && Object.keys(this.request[key]).find(k => !['add', 'remove'].includes(k))))
    await sequence(results.map(result =>
      async () => sequence(realArrays.map(key =>
      // We look for all objects associated to the result in the association table
        async () => {
          const associatedResults = await this.driver.get({
            table: `${key}${this.tableName}`,
            search: [key + 'Id'],
            where: {
              [this.tableName + 'Id']: result.reservedId
            },
            offset: this.request[key].offset,
            limit: this.request[key].limit,
            order: this.request[key].order
          })
          if (!associatedResults.length) result[key] = []
          else {
            // We look for objects that match all the constraints
            this.request[key].reservedId = associatedResults.map(res => res[key + 'Id'])
            // We register the data into the result
            result[key] = await this.applyInTable(this.request[key], this.table[key][0].tableName)
          }
        }
      ))
    ))
    // If the constraint is 'required', we keep only the results that have a matching solution in the table for each array's constraint
    return results.filter(result => realArrays.every(key => !this.request[key].required || result[key].length))
  }

  /**
   * Remove elements from the table if request.delete is defined
   * @param {import('./utils').Element[]} results The current results
   * @returns {Promise<import('./utils').Element[]>} The updated results
   */
  async remove (results) {
    if (!this.request.delete) return Promise.resolve(results)
    log('resolution part title', 'delete')
    // If there is no results, there is nothing to delete
    if (!results.length) return Promise.resolve(results)
    // Look for matching objects
    await this.driver.delete({
      table: this.tableName,
      where: { reservedId: results.map(r => r.reservedId) }
    })
    // Mark the results as deleted inside the results
    results.forEach(result => result.deleted = true)
    // The content is not anymore in the database. Data became unsafe.
    results.forEach(result => this.cache.uncache(this.tableName, result))
    await this.pluginCall(results, 'onDeletion')
    return results
  }

  /**
   * Change the table's values if request.set is defined
   * @param {import('./utils').Element[]} results The current results
   * @returns {Promise<import('./utils').Element[]>} The updated results
   */
  async update (results) {
    if (!this.request.set) return Promise.resolve(results)
    if (!results.length) return Promise.resolve(results)
    log('resolution part title', 'update')
    const { primitives: primitivesSet, objects: objectsSet, arrays: arraysSet } = classifyRequestData(this.request.set, this.table)
    // If previous values where not converted into objects yet, we do it now.
    objectsSet.forEach(key => results.forEach(result => result[key + 'Id'] && (result[key] = { reservedId: result[key + 'Id'] }) && delete result[key + 'id']))
    // Read the current values before update
    const currentValues = {}
    const updatedKeys = [...primitivesSet, ...objectsSet]
    results.forEach(result => currentValues[result.reservedId] = filterObject(result, updatedKeys))
    /** @type {Object.<string, string>} */
    const values = {} // The values to be edited
    const removed = {}// The elements that have been removed
    const added = {}// The elements that have been added
    // Mark the elements as being edited
    results.forEach(result => result.edited = true)
    // Update the results with primitives values
    primitivesSet.forEach(key => {
      results.forEach(result => result[key] = this.request.set[key])
      values[key] = this.request.set[key]
    })
    // Cache the updated results
    results.forEach(result => this.cache.addCache(this.tableName, result))
    // Find the objects matching the constraints to be replaced
    await sequence(objectsSet.map(key =>
      async () => {
        const matches = await this.applyInTable(this.request.set[key], /** @type {import('./utils').TableValue} **/(this.table[key]).tableName)
        if (matches.length === 0) {
          return Promise.reject({
            name: NOT_SETTABLE,
            message: `We could not find the object supposed to be set for key ${key} in ${this.tableName}: ${JSON.stringify(this.request.set[key])}.`
          })
        } else if (matches.length > 1) {
          return Promise.reject({
            name: NOT_UNIQUE,
            message: `We found multiple solutions for setting key ${key} in ${this.tableName}: ${JSON.stringify(this.request.set[key])}.`
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
    )
    // Reduce the request to only the primitives and objects ids constraints
    if (Object.keys(values).length) { await this.driver.update({
      table: this.tableName,
      values,
      where: { reservedId: results.map(result => result.reservedId) }
    }) }
    await this.pluginCall({ objects: results, oldValues: currentValues, newValues: results.length ? filterObject(results[0], updatedKeys) : {} }, 'onUpdate')
    // Replace arrays of elements by the provided values
    await sequence(arraysSet.map(key => async () => {
      const deleted = await this.driver.get({ table: `${key}${this.tableName}`, search: [key + 'Id'], where: { [this.tableName + 'Id']: results.map(r => r.reservedId) } })
      removed[key] = deleted.map(d => ({ reservedId: d[key + 'Id'] }))
      // Delete any previous value
      await this.driver.delete({
        table: `${key}${this.tableName}`,
        where: {
          [this.tableName + 'Id']: results.map(r => r.reservedId)
        }
      })
      // Look for elements matching the provided constraints
      const matches = await this.applyInTable(this.request.set[key], `${key}${this.tableName}`)
      // Create the new links
      await this.driver.create({
        table: `${key}${this.tableName}`,
        elements: {
          [this.tableName + 'Id']: results.map(r => r.reservedId),
          [key + 'Id']: matches.map(match => match.reservedId)
        }
      })

      // Attach the matching elements to the results
      added[key] = matches
      results.forEach(result => result[key] = matches)
    }))
    // If we added or removed something, we call the plugins listeners
    await this.pluginCall({ objects: results, added, removed }, 'onListUpdate')
    // We return the research results
    return results
  }

  /**
   * If we are using 'add' or 'remove' instruction on an associated table, we cut the link between the objects
   * @param {import('./utils').Element[]} results The current results
   * @returns {Promise<import('./utils').Element[]>} The updated results
   */
  async updateChildrenArrays (results) {
    log('resolution part title', 'updateChildrenArrays')
    if (!results.length) return Promise.resolve(results)
    const removed = {}
    const added = {}
    await sequence(this.arrays.map(key => async () => {
      const { add, remove } = this.request[key]
      // We remove elements from the association table
      if (remove) {
        const removeArrayResults = await this.applyInTable(remove, this.table[key][0].tableName)
        await this.driver.delete({
          table: `${key}${this.tableName}`,
          where: {
            [this.tableName + 'Id']: results.map(result => result.reservedId),
            [key + 'Id']: removeArrayResults.map(result => result.reservedId)
          }
        })
        removed[key] = removeArrayResults
      }
      // We add elements into the association table
      if (add) {
        // We look for the elements we want to add in the association table
        const addArrayResults = await this.applyInTable(add, this.table[key][0].tableName)
        // We link these elements to the results
        await this.driver.create({
          table: `${key}${this.tableName}`,
          elements: {
            [this.tableName + 'Id']: results.map(result => result.reservedId),
            [key + 'Id']: addArrayResults.map(result => result.reservedId)
          }
        })
        // Attach the matching elements to the results
        added[key] = addArrayResults
        results.forEach(result => result[key] = addArrayResults)
      }
    }))
    // If we added or removed something, we call the plugins listeners
    this.pluginCall({ objects: results, added, removed }, 'onListUpdate')
    return results
  }

  /**
           * Check if the request is respecting the access rules
           * @param {import('./utils').Element[]} results The request results
           * @returns {Promise<import('./utils').Element[]>} The request results filtered according to access rules
           */
  async controlAccess (results) {
    // If this request is authenticated with the privateKey, we don't need to control access.
    if (this.isAdmin) return Promise.resolve(results)
    log('resolution part title', 'controlAccess')
    const ruleSet = this.rules[this.tableName]

    await sequence(results.map(result => async () => {
      const ruleData = { authId: this.local.authId, request: { ...this.request, parent: this.parentRequest }, object: result, query: this.requestResolver.query }

      // Read access
      // Check table level rules
      if (ruleSet.read) {
        const err = await ruleSet.read(ruleData).catch(err => err || {
          name: UNAUTHORIZED,
          message: `User ${this.local.authId} is not allowed to read table ${this.tableName}`
        })
        await sequence(Object.keys(this.table).map(key => async () => {
          // Data not requested
          if (!result[key]) return await Promise.resolve()
          // If the reservedId is provided in the request, we consider it's access as free
          if (key === 'reservedId' && this.request[key] && result[key]) return await Promise.resolve()
          // Check property specific rules
          try {
            if (ruleSet[key] && ruleSet[key].read) return await ruleSet[key].read(ruleData)
            else if (err) return await Promise.reject(err)
          } catch (err) {
            log('access warning', `Access denied for field ${key} in table ${this.tableName} for authId ${this.local.authId}. Error : ${err.message || err}`)
            // Hiding sensitive data
            // result[key] = 'Access denied';
            delete result[key]
          }
        }))
      }

      // Write access
      if (ruleSet.write) {
        const err = await ruleSet.write(ruleData).catch(err => err || {
          name: UNAUTHORIZED,
          message: `User ${this.local.authId} is not allowed to write in table ${this.tableName}`
        })
        // Manage set instructions
        if (this.request.set) {
          const { primitives: setPrimitives, objects: setObjects } = classifyRequestData(this.request.set, this.table)
          await sequence([...setPrimitives, ...setObjects].map(key => async () => {
            try {
              if (ruleSet[key] && ruleSet[key].write) return await ruleSet[key].write(ruleData)
              else if (err) return await Promise.reject(err)
            } catch (err) {
              return Promise.reject({
                name: UNAUTHORIZED,
                message: `User ${this.local.authId} is not allowed to edit field ${key} in table ${this.tableName}. Error : ${err.message || err}`
              })
            }
          }))
        }

        // Manage create instructions
        if (this.request.create) {
          try {
            if (ruleSet.create) return await ruleSet.create(ruleData)
            else if (err) return await Promise.reject(err)
          } catch (err) {
            return Promise.reject({
              name: UNAUTHORIZED,
              message: `User ${this.local.authId} is not allowed to create elements in table ${this.tableName}. Error : ${err.message || err}`
            })
          }
        }

        // Manage delete instructions
        if (this.request.delete) {
          try {
            if (ruleSet.delete) return await ruleSet.delete(ruleData)
            else if (err) return await Promise.reject(err)
          } catch (err) {
            return Promise.reject({
              name: UNAUTHORIZED,
              message: `User ${this.local.authId} is are not allowed to delete elements from table ${this.tableName}. Error : ${err.message || err}`
            })
          }
        }

        // Manage add instructions
        await sequence(this.arrays.map(key => async () => {
          if (this.request[key].add) {
            try {
              if (ruleSet[key] && ruleSet[key].add) return await ruleSet[key].add(ruleData)
              else if (err) return await Promise.reject(err)
            } catch (err) {
              return Promise.reject({
                name: UNAUTHORIZED,
                message: `User ${this.local.authId} is not allowed to create ${key} in table ${this.tableName}. Error : ${err.message || err}`
              })
            }
          }
        }))

        // Manage remove instructions
        await sequence(this.arrays.map(key => async () => {
          if (this.request[key].remove) {
            try {
              if (ruleSet[key] && ruleSet[key].remove) return await ruleSet[key].remove(ruleData)
              else if (err) return await Promise.reject(err)
            } catch (err) {
              return Promise.reject({
                name: UNAUTHORIZED,
                message: `User ${this.local.authId} is not allowed to remove ${key} from table ${this.tableName}. Error : ${err.message || err}`
              })
            }
          }
        }))
      }
    }))
    // We return only the results where access was not fully denied
    // WARNING: Using Object.values here would not work because value can be null
    return results.filter(result => Object.keys(result).length)
  }

  /**
   * Call
   * @param {import('./utils').Request | Object | import('./utils').Element[]} data The data this plugin should be called with
   * @param {'onRequest' | 'onCreation' | 'onDeletion' | 'onProcessing' | 'onUpdate' | 'onListUpdate' | 'onResult'} event The event that originated this call
   * @returns {Promise<any>}
   */
  async pluginCall (data, event) {
    // Function provided to edit local request parameters (authId, readOnly) during the request
    log('resolution part title', event, this.tableName)
    return sequence(this.requestResolver.plugins
    // Read the callback for the event in this table for each plugin
      .map(plugin => plugin[event] && plugin[event][this.tableName])
    // Keep only the plugins that have such a callback
      .filter(eventOnTable => eventOnTable)
      .map(callback => () => callback(data, { request: this.request, parent: this.parentRequest, query: this.requestResolver.query, local: this.requestResolver.locals, isAdmin: this.local.authId === this.requestResolver.privateKey }))
    )
  }

  /**
     * Apply a partial request in a table
     * @param {import('./utils').Request} request The partial request to apply
     * @param {string} tableName Table name
     * @returns {Promise<import('./utils').Element[]>} The results of the partial request
     */
  async applyInTable (request, tableName) {
    return this.requestResolver.resolveInTable({ tableName, request, parentRequest: { ...this.request, tableName: this.tableName, parent: this.parentRequest }, local: this.local })
  }
}

class RequestChecker {
  /**
   * @param {TableResolver} tableResolver The TableResolver needing this check
   */
  constructor (tableResolver) {
    this.request = tableResolver.request
    this.primitives = tableResolver.primitives
    this.objects = tableResolver.objects
    this.arrays = tableResolver.arrays
    this.tableName = tableResolver.tableName
    this.table = tableResolver.table
    this.tablesModel = tableResolver.requestResolver.tablesModel
    this.isValue = this.isValue.bind(this)
    this.isObject = this.isObject.bind(this)
    this.isTypeCorrect = this.isTypeCorrect.bind(this)
    this.checkEntry = this.checkEntry.bind(this)
    this.wrongType = this.wrongType.bind(this)
    this.check = this.check.bind(this)
  }

  /**
   * Check if the value is acceptable for a primitive
   * @param {any} value The value to check
   * @param {string} key The column name this value is relative to
   * @returns {boolean} True if valid, false otherwise.
   * @throws Throws an error if the request is malformed
   **/
  isValue (value, key) {
    if (value === null) return true
    if (isPrimitive(value)) return true
    // This is the way to represent OR condition
    if (Array.isArray(value)) return value.every(v => this.isValue(v, key))
    // This is the way to create a AND condition
    if (value instanceof Object) return Object.keys(value).every(k => operators.includes(k) && this.isValue(value[k], key))
    throw new Error(`Bad value ${value} provided for field ${key} in table ${this.tableName}. We expect null, a ${this.table[key].type}, an object, or an array of these types during request ${stringify(this.request)}.`)
  }

  /**
   * Check if the value is acceptable for an object or an array
   * @param {any} value The value to check
   * @param {string} key The column name this value is relative to
   * @returns {boolean} True if valid, false otherwise.
   * @throws Throws an error if the request is malformed
   **/
  isObject (value, key) {
    if (value !== null && isPrimitive(value)) throw new Error(`Bad value ${value} provided for field ${key} in table ${this.tableName}. We expect null, an object, or an array of these types during request ${stringify(this.request)}.`)
    return true
  }

  /**
   * Check if the values in the request are acceptable.
   * @param {import('./utils').Request} req The request to analyse
   * @param {string[]} primitives The array of primitive keys corresponding to existing column tables
   * @param {string[]} objects The array of object keys corresponding to existing foreign keys
   * @param {string[]} arrays The array of arrays keys corresponding to existing association tables
   * @returns {boolean} True if valid, false otherwise.
   * @throws Throws an error if the request is malformed
   **/
  checkEntry (req, primitives, objects, arrays) {
    // Check if the values are acceptable for primitives, objects and arrays
    return primitives.every(key =>
      this.isValue(req[key], key)) && [...objects, ...arrays].every(key => this.isObject(req[key], key)
    )
  }

  /**
   * Ensure that the types of each value are matching the column type
   * @param {string} key The key to check
   * @param {any} value The values associated to this keys
   * @param {import('./utils').Table} model The data model where we can check the expected type
   * @returns {boolean} True if the value is
   */
  isTypeCorrect (key, value, model) {
    const type = model[key].type // The column type
    if (value === undefined || value === null) return !model[key].notNull
    switch (type) {
      case 'string':
      case 'varchar':
      case 'time':
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

  /**
   * Ensure that the types of each value are matching the column type
   * @param {string[]} keys The keys to check
   * @param {Object.<string, any>} values The values associated to those keys
   * @param {import('./utils').Table} model The data model where we can check the expected type
   * @returns {string} True if the value is
   */
  wrongType (keys, values, model) {
    return keys.find(key => !this.isTypeCorrect(key, values[key], model))
  }

  check () {
    try {
      this.checkEntry(this.request, this.primitives, this.objects, this.arrays)
      // Only one instructions among create, delete, get in each request
      if (this.request.create && this.request.delete) throw new Error(`Each request can contain only one among 'create' or 'delete'. The request was : ${stringify(this.request)}.`)
      // Check that set instruction is acceptable
      if (this.request.set) {
        if (Array.isArray(this.request.set) || !(this.request instanceof Object)) throw new Error(`The 'set' instruction ${stringify(this.request.set)} provided in table ${this.tableName} is not a plain object. A plain object is required for 'set' instructions. The request was : ${stringify(this.request)}.`)
        const { primitives: setPrimitives, objects: setObjects, arrays: setArrays } = classifyRequestData(this.request.set, this.table)
        this.checkEntry(this.request.set, setPrimitives, setObjects, setArrays)
        const wrongKey = this.wrongType(setPrimitives, this.request.set, this.tablesModel[this.tableName])
        if (wrongKey) throw new Error(`The value ${stringify(this.request.set[wrongKey])} for ${wrongKey} in table ${this.tableName} is of type ${toType(this.request.set[wrongKey])} but it was expected to be of type ${this.tablesModel[this.tableName][wrongKey].type}. The request was : ${stringify(this.request)}.`)
      }
      // Check that create instruction is acceptable
      if (this.request.create) {
        const wrongKey = this.wrongType(this.primitives, this.request, this.tablesModel[this.tableName])
        if (wrongKey) throw new Error(`The value ${stringify(this.request[wrongKey])} for ${wrongKey} in table ${this.tableName} is of type ${toType(this.request[wrongKey])} but it was expected to be of type ${this.tablesModel[this.tableName][wrongKey].type}. The request was : ${stringify(this.request)}.`)
      }
      // Check that there is not add or remove instruction in object fields
      const unwantedInstruction = this.objects.find(key => this.request[key].add || this.request[key].remove)
      if (unwantedInstruction) throw new Error(`Do not use 'add' or 'remove' instructions within ${unwantedInstruction} parameter in table ${this.tableName}. You should use the 'set' instruction instead. The request was : ${stringify(this.request)}.`)
      // Cannot add or remove elements from arrays in create or delete requests
      if (this.request.create || this.request.delete) {
        const addOrRemove = this.arrays.find(key => this.request[key].add || this.request[key].remove)
        if (addOrRemove) {
          throw new Error(this.request.create ? `In create requests, you cannot have 'add' or 'remove' instructions in ${addOrRemove} in table ${this.tableName}. To add children, just write the constraints directly under ${addOrRemove}. The request was : ${stringify(this.request)}.`
            : `In delete requests, you cannot have 'add' or 'remove' instructions in ${addOrRemove} in table ${this.tableName}. When deleting an object, the associations with this object will be automatically removed. The request was : ${stringify(this.request)}.`)
        }
      }
      // Check limit, offset and order instructions
      if (this.request.limit && !Number.isInteger(this.request.limit)) throw new Error(`'Limit' statements requires an integer within ${this.tableName}. We received: ${this.request.limit} instead. The request was : ${stringify(this.request)}.`)
      if (this.request.offset && !Number.isInteger(this.request.offset)) throw new Error(`'Offset' statements requires an integer within ${this.tableName}. We received: ${this.request.offset} instead. The request was : ${stringify(this.request)}.`)
      if (this.request.order) {
        // Ensure that order is an array of strings
        if (!Array.isArray(this.request.order)) throw new Error(`'order' statements requires an array of column names within ${this.tableName} request. We received: ${this.request.order} instead. The request was : ${stringify(this.request)}.`)
        // Ensure that it denotes only existing columns
        const columns = Object.keys(this.tablesModel[this.tableName])
        const unfoundColumn = this.request.order.find(column =>
          column.startsWith('-') ? !columns.includes(column.substring(1)) : !columns.includes(column)
        )
        if (unfoundColumn) throw new Error(`'order' statement requires an array of property names within ${this.tableName}, but ${unfoundColumn} doesn't belong to this table. The request was : ${stringify(this.request)}.`)
      }
      return Promise.resolve()
    } catch (err) {
      return Promise.reject({ name: BAD_REQUEST, message: err.message })
    }
  }
}

module.exports = createRequestHandler
