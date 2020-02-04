/* eslint-disable no-cond-assign */
/** This is a sample code of a server that works like a messenger where you can exhange messages with your contacts. */
const { createServer, is, or, member, count, none, all, not, and, plugins : { loginPlugin, securityPlugin } } = require('./src');
const express = require('express');

/*************************************************************************
 *************************** TABLES DECLARATION **************************/

//Generate the tables. Doing it this way make us able to use self-references and cross references between tables
const [ User, Feed, Comment ] = new Array(3).fill().map(() => ({}));
const tables = {User, Feed, Comment};

// First, just focus on the structure of your data. Describe your table architecture
Object.assign(User, {
  pseudo: 'string/25',
  email: 'string/40',
  password: 'binary/64',
  salt: 'binary/16',
  contacts: [User],
  invited: [User],
  notNull: ['pseudo', 'email', 'password', 'salt'],
  index: [
    //You can use the object form
    {
      column: 'email',
      type: 'unique',
    },
    //Or the short string form
    'pseudo/8',
    'contacts/unique',
    'invited/unique'
  ],
});

Object.assign(Comment, {
  content: 'text',
  title: 'string/60',
  author: User,
  date: 'dateTime',
  lastModification: 'dateTime',
  notNull: ['title', 'author'],
  index : ['date', 'content/fulltext'],
});

Object.assign(Feed, {
  participants: [User],
  comments: [Comment],
  index: ['participants/unique', 'comments/unique']
});

/*************************************************************************
 ************************* DATABASE CONFIGURATION ************************/

// Provide every configuration detail about your database:
const database = {
  user: 'root',             // the login to access your database
  password: 'password',     // the password to access your database
  type: 'mysql',            // the database type that you wish to be using
  privateKey: 'key',        // a private key that will be used to identify requests that can ignore access rules
  host : 'localhost',       // the database server host
  database: 'simpleql',     // the name of your database
  create : true,            // we require to create the database
  insecureAuth : true
};

/*************************************************************************
 ************************** ACCESS CONTROL RULES *************************/

const rules = {
  User: {
    email : {
      write : none,         //emails cannot be changed
    },
    password : {
      read : none,          //no one can read the password
    },
    salt : {
      read : none,          //no one can read the salt
      write : none,         //no one can write the salt
    },
    contacts : {
      add : is('self'),     //Only ourself can add contacts
    },
    invited : {
      add : and(
        is('self'),              //Only ourself can invite contacts
        not(member('invited'))   //Cannot invite oneself as our own contact
      ), 
    },
    create : all,           //Creation is handled by login middleware. No one should create Users from request.
    delete : is('self'),    //Users can only delete their own profile
    write : is('self'),     //Users can only edit their own profile
    read : or(is('self'), member('contacts'), member('invited')), //Users and their contacts can read the profile data
  },
  Feed : {
    comments: {
      add : member('participants'),  //You need to be a member of the participants of the feed to create messages into the feed
      remove : none,        //To remove a comment, you need to delete it from the database
    },
    participants: {
      add : none,           //Once the feed is created, no one can add participants
      remove : none,        //Once the feed is created, no one can remove participants
    },
    delete : none,          //No one can delete a feed
    create : and(
      member('participants'), //Users always need to be a member of the feed they wish to create
      count('participants', { amount: 2 }) //When creating a Feed, the amount of participants must equal 2
    ),
    read : member('participants'),            //Only the members of a feed can read its content
    write : none,           //No one can edit a feed once created
  },
  Comment : {
    date : {
      write: none,          //The creation date of a message cannot be changed
    },
    author : {
      write : none,         //The author of a message cannot be changed
    },
    delete : is('author'),  //Only the author of a message can delete it
    create : is('author'),  //To create a message, you need to declare yourself as the author
    write : is('author'),   //Only the author can edit their messages
    read : customRule       //Only the feed's participants can read the message content
  },
};

// You can always create your own rules. The parameters are described in the documentation.
/** Ensure that only the feed's participants can read the message content */
function customRule() {
  return ({query, object, authId, request}) => {
    //In case of message creation, the feed might not exist yet but we don't mind reading the data anyway
    if(request.create) return Promise.resolve();
    //We want to make sure that only participants of a feed can read the messages from that feed.
    return query({
      //We look for feeds containing that comment, and the author as participant
      Feed: {
        comments: {
          reservedId : object.reservedId,
          required: true,     //We need this to indicate that we don't care about Feeds that have no Comments
        },
        participants: {
          reservedId : authId,
          required: true,     //We need this to indicate that we don't care about Feeds that have no Participants
        }
      }
    },
    //We give admin rights to this request to be able to read the data from the database, but we set readOnly mode to be safer.
    { admin: true, readOnly : true }).then(results => {
      //If we found no Feed matching the request, we reject the access to the message content.
      return results.Feed.length>0 ? Promise.resolve() : Promise.reject({status: 401, message: 'Only feed participants can read message content'});
    });
  };
}

/*************************************************************************
 ****************************** CUSTOM PLUGINS ***************************/

// You can always create your own plugin if some fields requier extra attention. See the documentation for more details.
/** This plugin will handle a complex set of business rule:
 * 1. Before being able to add a contact, this contact must have invited you or have you as a contact
 * 2. You cannot invite as a contact one of your contacts
 * 3. You cannot invite as a contact someone you already invited
 * 4. If you try to invite someone that invited you already, you will both be added as contacts of eachother and removed from your respective invited list
 * 5. If you try to add someone as a contact that is already in your invited list, we will remove it from your invited list
 * 
 * You will see that this complex list of constraints can be handled quite easily with SimpleQL plugins.
 */
const customPlugin = {
  //This part will edit the request before querying the database
  onProcessing: {
    User: async (results, {request, query, local, isAdmin}) => {
      if(isAdmin) return Promise.resolve();//We don't control admin requests
      //When we invite a contact, we want to make sure that some rules are respected
      if((request.invited && request.invited.add) || (request.contacts && request.contacts.add)) {
        //This is the list of contacts being added
        const invited = ((!request.invited || !request.invited.add) ? [] : Array.isArray(request.invited.add) ? request.invited.add : [request.invited.add]);
        const contacts = ((!request.contacts || !request.contacts.add) ? [] : Array.isArray(request.contacts.add) ? request.contacts.add : [request.contacts.add]);
      
        //We need the user's contacts and invited list
        const { User: [user] } = await query({ User: { reservedId: results.map(u => u.reservedId), get: ['invited', 'contacts'] }}, { admin: true, readOnly: true });
        if(!user) return Promise.reject({status: 404, message: `No user was found with email ${request.email}`});
        const userId = user.reservedId;

        //We get the contacts data of the contacts being invited. We take good care to only read the data as we will need access root!
        const { User: addInvited } = !invited.length ? { User: [] } : await query({ User: invited.map(i => ({...i, get: ['contacts', 'invited']}))}, { admin: true, readOnly: true});
        //We get the contacts data of the contacts being added. We take good care to only read the data as we will need access root!
        const { User: addContacts } = !contacts.length ? { User: [] } : await query({ User: contacts.map(i => ({...i, get: ['contacts', 'invited']}))}, { admin: true, readOnly: true});

        const invitedIds = addInvited.map(u => u.reservedId);
        const contactsIds = addContacts.map(u => u.reservedId);
        const userInvitedIds = user.invited.map(u => u.reservedId);
        const userContactsIds = user.contacts.map(u => u.reservedId);
        const allContactsIds = [...userInvitedIds, ...userContactsIds];

        //If the user tries to add itself we deny the request
        if([...invitedIds, ...contactsIds].includes(userId)) return Promise.reject({status: 403, message: `User ${userId} cannot add itself as a contact.`});

        //If the user tries to invite someone that already has them as one of their contact member, we make it a contact instead
        const granted = addInvited.filter(contact => [...contact.contacts, ...contact.invited].map(u => u.reservedId).includes(userId));
        granted.forEach(contact => {
          contactsIds.push(contact.id);
          addContacts.push(contact);
          contacts.push(contact);
        });
        if(!request.contacts) request.contacts = {};
        request.contacts.add = contacts;
      
        //If the user invites someone that already invited them, we make them both contacts instead
        const promoted = [...addInvited, ...addContacts].filter(contact => contact.invited.map(u => u.reservedId).includes(userId));
        if(promoted.length) await query({ User: {
          reservedId: promoted.map(u => u.reservedId),        //Look for the users that have current user in their invited list
          invited: { remove: { reservedId: userId }},         //Remove the user from the invited list
          contacts: { add: { reservedId: userId }}            //Add the user to the contacts
        }}, { admin: true });

        //If the user tries to add and invite someone at the same time, we ignore the invitation
        const duplicates = invitedIds.filter(id => contactsIds.includes(id));
        duplicates.forEach(id => {
          const index = invitedIds.indexOf(id);
          invitedIds.splice(index, 1);
          addInvited.splice(index, 1);
          //Makes sure that the invited constraints can't match the found id
          invited.forEach(u => { if(u.not) u.not.reservedId = id; else u.not = {reservedId: id};});
          request.invited.add = invited;
        });
        let alreadyIn;
        //If the user tries to add as contact someone that didn't invite them nor has them as contact, we deny the request
        if(alreadyIn = addContacts.find(contact => ![...contact.invited, ...contact.contacts].find(u => u.reservedId===userId))) return Promise.reject({ status: 401, message: `The User ${alreadyIn.reservedId} must invite User ${userId} before User ${userId} can add it as a contact.`});
        //If we try to invite a user already in our contacts or invited list, we deny the request
        else if(alreadyIn = invitedIds.find(id => allContactsIds.includes(id))) return Promise.reject({ status: 403, message: `The User ${alreadyIn} is already in the contacts of User ${userId}.`});
        //If we try to add a contact which is already in our contacts list, we deny the request
        else if(alreadyIn = contactsIds.find(id => userContactsIds.includes(id))) return Promise.reject({ status: 403, message: `The User ${alreadyIn} is already a contact of User ${userId}.`});
        //If we try to add as contact someone we already invited, we need to remove it from the invited list.
        const alreadyInvited = contactsIds.filter(id => userInvitedIds.includes(id));
        if(alreadyInvited.length>0) await query({ User: { reservedId: userId, invited: { remove: { reservedId: alreadyInvited } } }}, { admin: true });

        //We need to manually add the users as they don't have enough credence to access another user's data
        if(addInvited.length) {
          await query({ User: { reservedId: userId, invited: { add: addInvited }} }, { admin: true });
          local.invited = addInvited;//We save the id to manually add them to the result (cf onResult). This is not necessary, and just for demonstration purpose
        }
      }
    }
  },
  onRequest: {
    Comment: (request, { parent }) => {
      //In case of message creation, the feed might not exist yet
      if(request.create) {
        //We want to make sure that the message belongs to a feed. The way to do so is to ensure that the parent of this request is Feed.
        if(!parent || parent.tableName!=='Feed') return Promise.reject({ status: 400, message: 'Comments must belong to a feed.'});
        //Upon creation, we set the fields `date` and `lastModification`.
        const date = new Date().toISOString();
        request.date = date;
        request.lastModification = date;
      }
      if(request.set) {
        //We update the `lastModification` field each time a modification happens
        const date = new Date().toISOString();
        request.set.lastModification = date;
      }
    }
  },
  //This part will edit the results before it is returned to the end user
  onResult: {
    User : (results, {request,local: { invited }}) => {
      if(request.invited && request.invited.add) {
        //We manually add the list of invited users that could not be added, due to credentials issues. This is just to demonstrate how `local` variable and onResult function might work
        //WARNING: This is probably a security issue. We only do this for demonstration purpose.
        results.forEach(result => result.invited = invited);
      }
    }
  }
};

const app = express();
app.listen(80).on('error', error => {
  console.error(error);
  if(error.code==='EACCES') console.log(`It seems that you don't have right to run node on port 80. You should try the following approaches:
    * Run the process as root, then drop the privileges
    * Run the following command to enable node to run on port 80:
        sudo apt-get install libcap2-bin
        sudo setcap cap_net_bind_service=+ep \`readlink -f \\\`which node\\\`\`
  `);
  process.exit();
});

const plugins = [];

//Add a plugin enforcing default security parameters in production
if(process.env.NODE_ENV==='production') plugins.push(securityPlugin({
  app,
  domains: ['mydomain.com', 'www.mydomain.com'],
  webmaster: 'webmaster@mydomain.com',
}));

//Add a plugin that enables basic login/password authentication
plugins.push(loginPlugin({
  login: 'email',
  password: 'password',
  salt: 'salt',
  userTable: 'User',
}));

//Add our custom plugin to handle specific behaviours for some requests
plugins.push(customPlugin);

module.exports = () => createServer({app, tables, database, rules, plugins});
