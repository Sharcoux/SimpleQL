// @ts-check

const { checkColumn } = require('../utils/type-checking')

/** Ensure that only the feed's participants can read the message content */
function customRule () {
  return ({ query, object, authId, request }) => {
    // In case of message creation, the feed might not exist yet but we don't mind reading the data anyway
    if (request.create) return Promise.resolve()
    // We want to make sure that only participants of a feed can read the messages from that feed.
    return query({
      // We look for feeds containing that comment, and the author as participant
      Feed: {
        comments: {
          reservedId: object.reservedId,
          required: true // We need this to indicate that we don't care about Feeds that have no Comments
        },
        participants: {
          reservedId: authId,
          required: true // We need this to indicate that we don't care about Feeds that have no Participants
        }
      }
    },
    // We give admin rights to this request to be able to read the data from the database, but we set readOnly mode to be safer.
    { admin: true, readOnly: true }).then(results => {
      // If we found no Feed matching the request, we reject the access to the message content.
      return results.Feed.length > 0 ? Promise.resolve() : Promise.reject({ status: 401, message: 'Only feed participants can read message content' })
    })
  }
}

// First, just focus on the structure of your data. Describe your table architecture
Object.assign(User, {
  pseudo: 'string/25',
  email: 'string/40',
  password: 'binary/64',
  salt: 'binary/16',
  stripeId: 'string/40',
  contacts: [User],
  invited: [User],
  notNull: ['pseudo', 'email', 'password', 'salt'],
  index: [
    // You can use the object form
    {
      column: 'email',
      type: 'unique'
    },
    // Or the short string form
    'pseudo/8',
    'contacts/unique',
    'invited/unique',
    // You can create an index between multiple columns
    {
      column: ['email', 'pseudo'],
      length: [8, 8],
      type: 'unique'
    }
  ]
})

Object.assign(Comment, {
  content: 'text',
  title: 'string/60',
  author: User,
  date: {
    type: 'dateTime',
    defaultValue: now
  },
  lastModification: {
    type: 'dateTime',
    defaultValue: now
  },
  notNull: ['title', 'author'],
  index: ['date', 'content/fulltext']
})

Object.assign(Feed, {
  participants: [User],
  comments: [Comment],
  index: ['participants/unique', 'comments/unique']
})

/**
 * Create a storage plugin that will handle creating, storing, loading or deleting files on a "per user" basis
 * @param {{ userTableName: string; messageTableName: string; feedTableName: string; privateFeed?: string }} storagePluginParams
 * @return {import('../plugins').Plugin}
 */
function messengerPlugin ({ userTableName: User, messageTableName: Message, feedTableName: Feed, privateFeed }) {
  return {
    preRequisite: (tables) => {
      // Ensure that the tables are correctly defined
      const userTable = /** @type {import('../utils').FormattedTableValue} */(tables[User])
      if (!userTable) return Promise.reject(`You need ${User} table to use the FileStorage plugin.`)
      const messageTable = /** @type {import('../utils').FormattedTableValue} */(tables[Message])
      if (!messageTable) return Promise.reject(`You need ${Message} table to use the FileStorage plugin.`)
      const feedTable = /** @type {import('../utils').FormattedTableValue} */(tables[Feed])
      if (!feedTable) return Promise.reject(`You need ${Feed} table to use the FileStorage plugin.`)
      if (tables[User].contacts[0] !== userTable) return Promise.reject(`You need your table ${User} to have ${User} contacts as a list.`)
      if (tables[User].invited[0] !== userTable) return Promise.reject(`You need your table ${User} to have ${User} invited as a list.`)
      if (tables[Message].author !== userTable) return Promise.reject(`You need your table ${Message} to be associated to ${User} as author.`)
      if (tables[Feed].participants[0] !== userTable) return Promise.reject(`You need your table ${Feed} to have ${User} participants as a list.`)
      if (tables[Feed].comments[0] !== messageTable) return Promise.reject(`You need your table ${Feed} to have ${Message} comments as a list.`)

      // Ensure that the User column are correctly defined
      try {
        checkColumn('email', userTable, 'string', 40, User)
      } catch (err) {
        return Promise.reject(`To use the MessengerStorage plugin, you need to fix the following error.\n${err.message}`)
      }

      // Ensure that notNull and index are correctly defined
      const missingRequiredField = ['name', 'owner', 'createdAt', 'lastModified'].find(key => !messageTable.notNull || !messageTable.notNull.includes(key))
      if (missingRequiredField) return Promise.reject(`To use the FileStorage plugin, you need to add ${missingRequiredField} to the list of notNull fields`)
      if (!messageTable.index || !messageTable.index.find(index => isDeepStrictEqual(index, {
        column: ['name', 'owner'],
        type: 'unique'
      }))) return Promise.reject('To use the FileStorage plugin, you need to add the following index: { column: ["name", "owner"], type: "unique" }')
    },
    onProcessing: {
      User: async (results, { request, query, local, isAdmin }) => {
        if (isAdmin) return Promise.resolve()// We don't control admin requests
        // When we invite a contact, we want to make sure that some rules are respected
        if ((request.invited && request.invited.add) || (request.contacts && request.contacts.add)) {
        // This is the list of contacts being added
          const invited = ((!request.invited || !request.invited.add) ? [] : Array.isArray(request.invited.add) ? request.invited.add : [request.invited.add])
          const contacts = ((!request.contacts || !request.contacts.add) ? [] : Array.isArray(request.contacts.add) ? request.contacts.add : [request.contacts.add])

          // We need the user's contacts and invited list
          const { User: [user] } = await query({ User: { reservedId: results.map(u => u.reservedId), get: ['invited', 'contacts'] } }, { admin: true, readOnly: true })
          if (!user) return Promise.reject({ status: 404, message: `No user was found with email ${request.email}` })
          const userId = user.reservedId

          // We get the contacts data of the contacts being invited. We take good care to only read the data as we will need access root!
          const { User: addInvited } = !invited.length ? { User: [] } : await query({ User: invited.map(i => ({ ...i, get: ['contacts', 'invited'] })) }, { admin: true, readOnly: true })
          // We get the contacts data of the contacts being added. We take good care to only read the data as we will need access root!
          const { User: addContacts } = !contacts.length ? { User: [] } : await query({ User: contacts.map(i => ({ ...i, get: ['contacts', 'invited'] })) }, { admin: true, readOnly: true })

          const invitedIds = addInvited.map(u => u.reservedId)
          const contactsIds = addContacts.map(u => u.reservedId)
          const userInvitedIds = user.invited.map(u => u.reservedId)
          const userContactsIds = user.contacts.map(u => u.reservedId)
          const allContactsIds = [...userInvitedIds, ...userContactsIds]

          // If the user tries to add itself we deny the request
          if ([...invitedIds, ...contactsIds].includes(userId)) return Promise.reject({ status: 403, message: `User ${userId} cannot add itself as a contact.` })

          // If the user tries to invite someone that already has them as one of their contact member, we make it a contact instead
          const granted = addInvited.filter(contact => [...contact.contacts, ...contact.invited].map(u => u.reservedId).includes(userId))
          granted.forEach(contact => {
            contactsIds.push(contact.id)
            addContacts.push(contact)
            contacts.push(contact)
          })
          if (!request.contacts) request.contacts = {}
          request.contacts.add = contacts

          // If the user invites someone that already invited them, we make them both contacts instead
          const promoted = [...addInvited, ...addContacts].filter(contact => contact.invited.map(u => u.reservedId).includes(userId))
          if (promoted.length) {
            await query({
              User: {
                reservedId: promoted.map(u => u.reservedId), // Look for the users that have current user in their invited list
                invited: { remove: { reservedId: userId } }, // Remove the user from the invited list
                contacts: { add: { reservedId: userId } } // Add the user to the contacts
              }
            }, { admin: true })
          }

          // If the user tries to add and invite someone at the same time, we ignore the invitation
          const duplicates = invitedIds.filter(id => contactsIds.includes(id))
          duplicates.forEach(id => {
            const index = invitedIds.indexOf(id)
            invitedIds.splice(index, 1)
            addInvited.splice(index, 1)
            // Makes sure that the invited constraints can't match the found id
            invited.forEach(u => { if (u.not) u.not.reservedId = id; else u.not = { reservedId: id } })
            request.invited.add = invited
          })
          let alreadyIn
          // If the user tries to add as contact someone that didn't invite them nor has them as contact, we deny the request
          if (alreadyIn = addContacts.find(contact => ![...contact.invited, ...contact.contacts].find(u => u.reservedId === userId))) return Promise.reject({ status: 401, message: `The User ${alreadyIn.reservedId} must invite User ${userId} before User ${userId} can add it as a contact.` })
          // If we try to invite a user already in our contacts or invited list, we deny the request
          else if (alreadyIn = invitedIds.find(id => allContactsIds.includes(id))) return Promise.reject({ status: 403, message: `The User ${alreadyIn} is already in the contacts of User ${userId}.` })
          // If we try to add a contact which is already in our contacts list, we deny the request
          // else if(alreadyIn = contactsIds.find(id => userContactsIds.includes(id))) return Promise.reject({ status: 403, message: `The User ${alreadyIn} is already a contact of User ${userId}.`});
          // If we try to add as contact someone we already invited, we need to remove it from the invited list.
          const alreadyInvited = contactsIds.filter(id => userInvitedIds.includes(id))
          if (alreadyInvited.length > 0) await query({ User: { reservedId: userId, invited: { remove: { reservedId: alreadyInvited } } } }, { admin: true })

          // We need to manually add the users as they don't have enough credence to access another user's data
          if (addInvited.length) {
            await query({ User: { reservedId: userId, invited: { add: addInvited } } }, { admin: true })
            local.invited = addInvited// We save the id to manually add them to the result (cf onResult). This is not necessary, and just for demonstration purpose
          }
        }
      }
    },
    onRequest: {
      Comment: (request, { parent }) => {
      // In case of message creation, the feed might not exist yet
        if (request.create) {
        // We want to make sure that the message belongs to a feed. The way to do so is to ensure that the parent of this request is Feed.
          if (!parent || parent.tableName !== 'Feed') return Promise.reject({ status: 400, message: 'Comments must belong to a feed.' })
        }
        if (request.set) {
        // We update the `lastModification` field each time a modification happens
          const date = new Date().toISOString()
          request.set.lastModification = date
        }
      }
    },
    // This part will edit the results before it is returned to the end user
    onResult: {
      User: async (results, { request, local: { invited } }) => {
        if (request.invited && request.invited.add) {
        // We manually add the list of invited users that could not be added, due to credentials issues. This is just to demonstrate how `local` variable and onResult function might work
        // WARNING: This is probably a security issue. We only do this for demonstration purpose.
          results.forEach(result => result.invited = invited)
        }
      }
    }
  }
}

module.exports = {
  create: messengerPlugin
}
