// @ts-check

const exec = require('child_process').exec
const path = require('path')
const fs = require('fs').promises

/**
 * Return the size of the directory in octet
 * @param {string} path The folder path
 * @returns {Promise<number>} The size in octet
 */
async function _getDirectorySize (path) {
  if (!await fs.access(path, fs.constants.F_OK).then(() => true, () => false)) return 0
  return new Promise((resolve, reject) => {
    exec('du -s ' + path, function (error, stdout, stderr) {
      if (error !== null) {
        console.error('exec error: du -s', path, '\n', error)
        reject(error)
      } else {
        stderr && console.error(stderr)
        resolve(parseInt(stdout.split(/\s/)[0], 10))
      }
    })
  })
}

/** Try and remove a file if it exists
 * @param {string} file The path to the file
 * @returns {Promise<void>}
 **/
async function _removeIfExists (file) {
  return fs.unlink(file).catch(err => (err.code === 'ENOENT' || err.code === 'ENOENT') ? Promise.resolve() : Promise.reject(err))
}

class Storage {
  /**
   * Create a helper to access users files
   * @param {string} storagePath The path to the storage location
   * @param {string} backupPath The path to the backup location
   */
  constructor (storagePath, backupPath) {
    this.storagePath = path.normalize(storagePath)
    this.backupPath = path.normalize(backupPath)

    // Create the storage folders
    require('fs').mkdirSync(this.storagePath, { recursive: true })
    require('fs').mkdirSync(this.backupPath, { recursive: true })
  }

  /**
   * Return the backup location for the provided file
   * @param {string} file The file to look for
   * @returns {string} The backup file path
   **/
  _getBackup (file) {
    return file.replace(this.storagePath, this.backupPath)
  }

  /** Get the location to the user storage folder
   * @param {string} userId The user id
   * @returns {string} The path to the user storage
   **/
  _getUserStorage (userId) {
    return path.normalize(path.join(this.storagePath, userId + ''))
  }

  /** Get the location of a file in the user storage
   * @param {string} userId The id of the storage owner
   * @param {string} filename The name of the file we are looking for
   * @returns {string} The path to the file
   **/
  _getFilePath (userId, filename) {
    return path.normalize(path.join(this.storagePath, userId + '', filename))
  }

  /** Restore the backup of provided filename if exists
 * @param {string} userId The id of the file owner
 * @param {string} filename The file to restore
 * @returns {Promise<void>}
*/
  async restoreBackup (userId, filename) {
    const file = this._getFilePath(userId, filename)
    const backup = this._getBackup(file)
    return _renameFileAndHandleParents(backup, file)
  }

  /** Create a backup for the specified file
   * @param {string} userId the file's owner
   * @param {string} filename the file's path
   * @returns {Promise<void>}
   **/
  async backupFile (userId, filename) {
    const file = this._getFilePath(userId, filename)
    const backup = this._getBackup(file)
    return _renameFileAndHandleParents(file, backup)
  }

  /** Clear the backup of the provided file
   * @param {string} userId the file's owner
   * @param {string} filename the file's path
   * @returns {Promise<void>}
   **/
  async removeBackup (userId, filename) {
    const backup = this._getBackup(this._getFilePath(userId, filename))
    return _deleteFileAndEmptyParents(backup)
  }

  /** Create a file belonging to the user
   * @param {string} userId the file's owner
   * @param {string} filename the file's path
   * @param {Buffer} data the data we want to write
   * @returns {Promise<void>}
   **/
  async writeFile (userId, filename, data) {
    const file = this._getFilePath(userId, filename)
    return _createFileAndParents(file, data)
  }

  /** Return the content of target file
   * @param {string} userId the file's owner
   * @param {string} filename the file's path
   * @returns {Promise<Buffer>}
   **/
  async readFile (userId, filename) {
    const file = this._getFilePath(userId, filename)
    return fs.readFile(file)
  }

  /** Delete the target file and remove parent folder if they became empty
   * @param {string} userId the file's owner
   * @param {string} filename the file's path
   * @returns {Promise<void>}
   **/
  async removeFile (userId, filename) {
    const file = this._getFilePath(userId, filename)
    return _deleteFileAndEmptyParents(file)
  }

  /** Rename a file. Destroy or create folder as needed.
   * @param {string} userId the file's owner
   * @param {string} oldName the current file's path
   * @param {string} newName the target file's path
   * @returns {Promise<void>}
   **/
  async renameFile (userId, oldName, newName) {
    const oldFile = this._getFilePath(userId, oldName)
    const newFile = this._getFilePath(userId, newName)
    return _renameFileAndHandleParents(oldFile, newFile)
  }

  /** Return the used space of user storage
   * @param {string} userId The storage's owner
   * @returns {Promise<number>} The space in octet
   **/
  async getUsedSpace (userId) {
    return _getDirectorySize(this._getUserStorage(userId))
  }

  /** Prepare the storage for user userId
   * @param {string} userId The storage's owner
   * @returns {Promise<void>}
   **/
  async createUserStorage (userId) {
    return fs.mkdir(this._getUserStorage(userId))
  }

  /** Delete all the files and folder of target user
   * @param {string} userId The storage's owner
   * @returns {Promise<void>}
   **/
  async destroyUserStorage (userId) {
    return fs.rmdir(this._getUserStorage(userId), { recursive: true })
  }

  /**
   * Check if the file exist in the user's storage
   * @param {string} userId the file's owner
   * @param {string} filename the file's path
   * @returns {Promise<void>}
   */
  async fileExist (userId, filename) {
    const file = this._getFilePath(userId, filename)
    return fs.access(file)
  }
}

/** Recursively create the parents folder and then create the file denoted by the file path
 * @param {string} file The path to the file we want to create
 * @param {Buffer} content The content we want to write in the file (utf8)
 * @returns {Promise<void>}
 **/
async function _createFileAndParents (file, content) {
  const folder = path.dirname(file)
  return fs.mkdir(folder, { recursive: true })
    .then(() => fs.writeFile(file, content))
}

/** Delete the file and recursively delete any parent folder that became empty
 * @param {string} filename The name of the file to remove
 * @returns {Promise<void>}
*/
async function _deleteFileAndEmptyParents (filename) {
  const folder = path.normalize(path.dirname(filename))
  /**
   * delete every empty folder in the hierarchy
   * @param {string} folder the leaf folder to clean
   * @returns {Promise<void>}
   */
  async function clean (folder) {
    if (this.storagePath.startsWith(folder) || this.backupPath.startsWith(folder)) return Promise.resolve()
    return fs.rmdir(folder)
      .then(() => clean(path.dirname(folder))) // Recursive cleaning of empty directories
      .catch(err => err.code === 'ENOTEMPTY' ? Promise.resolve() : Promise.reject(err)) // Ignore not empty directory errors
  }
  return _removeIfExists(filename).then(() => clean(folder))
}

/** Delete the target file if exists, rename the file, and delete any parent folder of the previous location that became empty */
async function _renameFileAndHandleParents (oldFile, newFile) {
  const folder = path.dirname(newFile)
  return fs.mkdir(folder, { recursive: true }) // Create the destination folder
    .then(() => _removeIfExists(newFile)) // Remove the previous file if exists
    .then(() => fs.rename(oldFile, newFile)) // Rename the file
    .then(() => _deleteFileAndEmptyParents(oldFile)) // Delete any empty folder from the previous location
}

module.exports = Storage
