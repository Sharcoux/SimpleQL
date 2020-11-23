// @ts-check

class Cache {
  constructor () {
    /** @type {{ [tableName: string]: { [reservedId: string]: import('../utils').Element }}} */
    this.cache = {}
    this.addCache = this.addCache.bind(this)
    this.uncache = this.uncache.bind(this)
    this.removeCache = this.readCache.bind(this)
  }

  /**
   * Save data we found on every elements during the request to give faster results
   * @param {string} tableName The table where the data are stored
   * @param {import('../utils').Element} elt The element to cache
   */
  addCache (tableName, elt) {
    if (!elt.reservedId) return // We cannot cache the result as we cannot index it
    // Initialize the cache for the table if needed
    if (!this.cache[tableName]) this.cache[tableName] = {}
    // Initialize the cache for the object
    if (!this.cache[tableName][elt.reservedId]) this.cache[tableName][elt.reservedId] = /** @type {any} **/({})
    Object.assign(this.cache[tableName][elt.reservedId], elt)
    // We add the new data to the cache
  }

  /**
   * Remove the cached data for the specified element
   * @param {string} tableName The table where the data are stored
   * @param {import('../utils').Element} elt
   */
  uncache (tableName, elt) {
    if (!this.cache[tableName]) return
    delete this.cache[tableName][elt.reservedId]
  }

  /**
   * Read the data we have stored about the provided element
   * @param {string} tableName The table where the data are stored
   * @param {string} reservedId The id of the element we are trying to get data about
   * @param {string[]=} properties The column we want to read from the cache
   * @returns {import('../utils').Element | undefined} The data we found about the object
   */
  readCache (tableName, reservedId, properties) {
    if (!this.cache[tableName]) return
    const cached = reservedId && this.cache[tableName] && this.cache[tableName][reservedId]
    if (!cached) return
    if (!properties) properties = Object.keys(cached)
    // If some data were invalidated, we give up reading the cache as it might be outdated
    if (properties.find(key => cached[key] === undefined)) return
    const result = { reservedId }
    // We read from the cache the data we were looking for.
    properties.forEach(key => result[key] = cached[key])
    return result
  }
}

module.exports = Cache
