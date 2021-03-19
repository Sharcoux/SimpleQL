// @ts-check
const { zipFiles, unzipFiles } = require('../utils/zip')
const Storage = require('../drivers/unixFiles')
const { toType } = require('../utils')
const { checkColumn } = require('../utils/type-checking')
const { isDeepStrictEqual } = require('util')

/**
 * Ensure that the name is compatible with the file system.
 * @param {string} name The name of the file to check
 * @param {boolean=} isFolder Is this name denoting a folder?
 **/
function isNameAllowed (name, isFolder) {
  if (!name || (name === '' && !isFolder) || name === '.' || name === '..') return false
  else if (name.includes('/')) {
    const parts = name.split('/')
    const fileName = parts.pop()
    return parts.every(partName => isNameAllowed(partName, true)) && isNameAllowed(fileName, false)
  }
  else return true
}

/**
 * Create a default File table model
 * @param {import('../utils').TableDeclaration} UserTable The table where the user's data are stored
 * @returns
 */
function createFileModel (UserTable) {
  return {
    owner: UserTable,
    name: 'string/255',
    createdAt: 'dateTime',
    lastModified: 'dateTime',
    notNull: ['name', 'owner', 'createdAt', 'lastModified'],
    index: [{
      column: ['name', 'owner'],
      type: 'unique'
    }]
  }
}

/**
 * Create a storage plugin that will handle creating, storing, loading or deleting files on a "per user" basis
 * @param {{ ownerTableName: string; fileTableName: string; userSpace: number; storagePath?: string; backupPath?: string }} storagePluginParams
 * @return {import('../plugins').Plugin}
 */
function storagePlugin ({ ownerTableName: User, fileTableName: File, userSpace, storagePath = './storage', backupPath = './storage/backup' }) {
  if (storagePath === backupPath) throw new Error(`storagePath cannot be equal to backupPath. You provided: ${storagePath} for both.`)

  const storage = new Storage(storagePath, backupPath)
  return {
    preRequisite: (tables) => {
      // Ensure that the tables are correctly defined
      const ownerTable = /** @type {import('../utils').FormattedTableValue} */(tables[User])
      if (!ownerTable) return Promise.reject(`You need ${User} table to use the FileStorage plugin.`)
      const fileTable = /** @type {import('../utils').FormattedTableValue} */(tables[File])
      if (!fileTable) return Promise.reject(`You need ${File} table to use the FileStorage plugin.`)
      if (tables[File].owner !== ownerTable) return Promise.reject(`You need your table ${User} to be associated to the table ${File} through the 'owner' property.`)

      // Ensure that the Files column are correctly defined
      try {
        checkColumn('name', fileTable, 'string', 255, File)
        checkColumn('createdAt', fileTable, 'dateTime', undefined, File)
        checkColumn('lastModified', fileTable, 'dateTime', undefined, File)
      } catch (err) {
        return Promise.reject(`To use the FileStorage plugin, you need to fix the following error.\n${err.message}`)
      }

      // Ensure that notNull and index are correctly defined
      const missingRequiredField = ['name', 'owner', 'createdAt', 'lastModified'].find(key => !fileTable.notNull || !fileTable.notNull.includes(key))
      if (missingRequiredField) return Promise.reject(`To use the FileStorage plugin, you need to add ${missingRequiredField} to the list of notNull fields`)
      if (!fileTable.index || !fileTable.index.find(index => isDeepStrictEqual(index, {
        column: ['name', 'owner'],
        type: 'unique'
      }))) return Promise.reject('To use the FileStorage plugin, you need to add the following index: { column: ["name", "owner"], type: "unique" }')
    },
    onRequest: {
      [File]: async (request, { query, local: { authId }, isAdmin }) => {
        const isNameAString = Object(request.name) instanceof String
        const folderName = isNameAString ? request.name.endsWith('/') ? request.name : request.name + '/' : request.name
        const asFolder = isNameAString ? { like: folderName + '%' } : request.name
        request.originalPath = request.name
        request.folderName = folderName
        // We interprete folders as a research for all files contained within
        if (isNameAString && request.name.endsWith('/')) request.name = asFolder
        const now = Date.now()
        // Handle requesting a zip of resulting files,
        if (request.zip) {
          // The content will already be included in the zip file
          if (request.get && request.get.includes('content')) /** @type {string[]} */(request.get).splice(request.get.indexOf('content', 1))
          // If we are receiving content as zip, we need to unzip and create contained files in the database and the file system
          if (request.create || (request.set && request.set.content)) {
            if (!isNameAString) return Promise.reject({ status: 400, message: `Name constraint must be a string in File requests when creating files from zip. We received ${typeof request.name} instead.` })
            const content = request.create ? request.content : request.set.content
            if (!(Object(content) instanceof String)) return Promise.reject({ status: 400, message: `The 'content' field must be the base64 encoded string of the file content, but we received a ${toType(content)}.` })
            const files = await unzipFiles(content)
            // Delete all the files from the folder if any
            await query({ [File]: { name: asFolder, delete: true } }, { admin: true, readOnly: false })
            // Create the new files
            await query({ [File]: files.map(({ name, content }) => ({ name: folderName + name, content, create: true, createdAt: now, lastModified: now })) }, { admin: false, readOnly: false })
            // This part was just done manually. We remove it from the request
            request.create ? delete request.create : delete request.set.content
          }
          // We will look for all files included into the folder
          request.name = asFolder
        }
        // Set the creation time when creating a file
        if (request.create) {
          // Ensure that the name is allowed
          if (!isNameAString) return Promise.reject({ status: 400, message: `Name constraint must be a string in File requests when creating files from zip. We received ${typeof request.name} instead.` })
          if (!isNameAllowed(request.originalPath, request.zip)) return Promise.reject({ status: 400, message: `${request.originalPath} is not a valid pathname and cannot be created.` })
          // Set the creation time
          request.lastModified = now
          request.createdAt = now
        } else if (request.set) {
          request.set.lastModified = Date.now()
        }
        // We set the current user as the default owner for all File requests
        if (!isAdmin && !request.owner) request.owner = { reservedId: authId }
      }
    },
    onUpdate: {
      [File]: async ({ objects, newValues, oldValues }, { local }) => {
        // If the name changed, we need to rename the file on the filesystem too
        if (newValues.name) {
          // TODO handle changing folder name
          if (objects.length > 1) return Promise.reject({ status: 400, message: `You cannot rename multiple files with the same name, but you tried to edit the following files: ${Object.values(oldValues).map(({ name }) => name).join(', ')} results were found.` })
          if (objects.length === 0) return
          const userId = objects[0].owner && objects[0].owner.reservedId
          const oldName = oldValues[objects[0].reservedId].name
          const newName = newValues.name
          // Ensure that the name is allowed
          if (!isNameAllowed(newName, false)) return Promise.reject({ status: 400, message: `${newName} is not a valid pathname and cannot be created.` })
          // If the file exist, we need to back it up
          try {
            await storage.fileExist(userId, newName)
            await storage.backupFile(userId, newName)
            if (!local.deleted) local.deleted = []
            local.deleted.push({ userId, filename: newName })
          } catch (err) {
            if (err.code !== 'ENOENT') return Promise.reject(err)
          }
          // Rename the file on the file system
          await storage.renameFile(userId, oldName, newName)
          // Mark the file as renamed for rolling back if needed
          if (!local.renamed) local.renamed = []
          local.renamed.push({ userId, oldName, newName })
        }
      }
    },
    onResult: {
      [File]: async (results, { request, query, local }) => {
        // If the content changed, we need to update the file content on the file system and update the user available space
        if (request.set && request.set.content) {
          const content = request.set.content
          const editedUsers = [] // The users being concerned

          if (!(Object(content) instanceof String)) return Promise.reject({ status: 400, message: `The 'content' field must be the base64 encoded string of the file content, but we received a ${toType(content)}.` })
          // Treating each File sequencially to make sure we can rollback properly
          await results.reduce(async (previousPromise, resolvedObject) => {
            await previousPromise
            const userId = resolvedObject.owner && resolvedObject.owner.reservedId
            const filename = resolvedObject.name
            // We backup the file and mark it as updated in case we need to rollback
            await storage.backupFile(userId, filename)
            if (!local.updated) local.updated = []
            local.updated.push({ filename, userId })
            // We erase the file
            await storage.writeFile(userId, filename, Buffer.from(content, 'base64'))
            if (!editedUsers.includes(userId)) editedUsers.push(userId)
            return Promise.resolve()
          }, Promise.resolve())
          // We update the user's available space
          const queryContent = await Promise.all(editedUsers.map(async userId => ({
            reservedId: userId,
            get: ['total'],
            set: { used: await storage.getUsedSpace(userId) }
          })))
          const { [User]: users } = await query({ [User]: queryContent }, { admin: true })
          const userOverflow = users.find(user => user.total < user.size)
          if (userOverflow) return Promise.reject({ status: 507, message: `User ${userOverflow.reservedId} with ${Math.floor(userOverflow.size / 1000)}ko exeeded the available space of ${userOverflow.total}.` })
        }
        // We read the file if the field "content" is requested
        if (request.get && request.get.includes('content')) {
          await Promise.all(results.map(async resolvedObject => {
            const userId = resolvedObject.owner && resolvedObject.owner.reservedId
            const content = await storage.readFile(userId, resolvedObject.name)
            resolvedObject.content = Buffer.from(content).toString('base64')
          }))
        }
        // We create a zip with the files contained in the result
        if (request.zip) {
          // Read the files content
          const filesContent = await Promise.all(results.map(({ name, owner: { reservedId: userId } }) => storage.readFile(userId, name)))
          let files = results.map(({ name }) => name)

          // If we can, we remove the root path from the files paths
          if (Object(request.folderName) instanceof String) files = files.map(file => file.replace(request.folderName, ''))

          // Create the zip files
          const zip = await zipFiles(files.map((name, i) => ({ name, content: filesContent[i].toString('base64') })))

          // We empty the results to set only the zip as sole file.
          const name = request.originalPath
          results.splice(0, results.length)
          results.push({ reservedId: undefined, name, owner: request.owner, content: zip, files, zip: true })
        }
      }
    },
    onCreation: {
      // Create the storage folder for every new user
      [User]: async (createdObject, { query }) => {
        const userId = createdObject.reservedId
        await storage.createUserStorage(userId)
        // We set the available space for the user
        await query({
          [User]: {
            reservedId: userId,
            set: { used: 0, total: userSpace }
          }
        }, { admin: true })
      },
      [File]: async (createdObject, { query, request, local }) => {
        // When creating a file in the database, we need to create the file on the file system and update the user's available space
        const content = request.content
        const userId = createdObject.owner.reservedId
        const filename = createdObject.name
        if (!(Object(content) instanceof String)) return Promise.reject({ status: 400, message: `The 'content' field must be the base64 encoded string of the file content, but we received a ${typeof content}.` })
        const fileContent = Buffer.from(content, 'base64')
        await storage.writeFile(userId, filename, fileContent)
        // Rememeber the file being created in case of rolling back
        if (!local.created) local.created = []
        local.created.push({ filename, userId })
        // We update the user's available space
        const size = await storage.getUsedSpace(userId)
        const { [User]: [{ total }] } = await query({
          // Set the space usage for the User
          [User]: { reservedId: userId, get: ['total'], set: { used: size } }
        }, { admin: true })
        if (total < size) return Promise.reject({ status: 507, message: `User ${createdObject.owner.reservedId} with ${Math.floor(size / 1000)}ko exeeded the available space of ${total}.` })
      }
    },
    onDeletion: {
      [User]: async (deletedObjectsArray, { local }) => {
        // We will just mark the user as deleted. The content deletion will be made only on onSuccess
        if (!local.deletedUsers) local.deletedUsers = []
        local.deletedUsers.push(...deletedObjectsArray.map(u => u.reservedId))
      },
      [File]: async (deletedObjectsArray, { query, local }) => {
        const editedUsers = [] // The users being concerned
        await Promise.all(deletedObjectsArray.map(async file => {
          const userId = file.owner && file.owner.reservedId
          const filename = file.name
          // If the file was already missing, we ignore the error
          try {
            await storage.backupFile(userId, filename)
            if (!local.deleted) local.deleted = []
            local.deleted.push({ userId, filename })
            if (!editedUsers.includes(userId)) editedUsers.push(userId)
          }
          catch (err) {
            if (err.code === 'ENOENT') console.error(`File ${filename} for user ${userId} was already missing`)
            else throw err
          }
        }))
        // Update available space per user
        const queryContent = await Promise.all(editedUsers.map(async userId => ({
          reservedId: userId,
          set: { used: await storage.getUsedSpace(userId) }
        })))
        await query({ [User]: queryContent }, { admin: true })
      }
    },
    onError: async (results, { local: { created = [], deleted = [], updated = [], renamed = [] } }) => {
      // We need to delete the created files, put back the edited files and rename the backup files
      // We catch the errors here as we don't want to throw nor interrupt the process in case of an issue with one of the files
      await Promise.all(renamed.map(({ userId, oldName, newName }) => storage.renameFile(userId, newName, oldName).catch(console.error)))
      await Promise.all(created.map(({ userId, filename }) => storage.removeFile(userId, filename).catch(console.error)))
      await Promise.all(updated.map(({ userId, filename }) => storage.restoreBackup(userId, filename).catch(console.error)))
      await Promise.all(deleted.map(({ userId, filename }) => storage.restoreBackup(userId, filename).catch(console.error)))
    },
    onSuccess: async (results, { local: { deleted = [], updated = [], deletedUsers = [] } }) => {
      // We can delete the backups
      // We catch the errors here as we don't want to throw nor interrupt the process in case of an issue with one of the files
      await Promise.all(deleted.map(({ userId, filename }) => storage.removeBackup(userId, filename).catch(console.error)))
      await Promise.all(updated.map(({ userId, filename }) => storage.removeBackup(userId, filename).catch(console.error)))
      await Promise.all(deletedUsers.map(user => storage.destroyUserStorage(user).catch(console.error)))
    }
  }
}

module.exports = {
  create: storagePlugin,
  createFileModel
}
