// import createDatabase, { is, request, or, member, none } from 'simple-ql';
const { createServer, is, request, or, member, none, all, not, and } = require('./src');
const loginPlugin = require('./src/plugins/login');

/*************************************************************************
 *************************** TABLES DECLARATION **************************/

// First, just focus on the structure of your data. Describe your table architecture
var User = {
  pseudo: 'string/25',
  email: 'string/40',
  password: 'binary/64',
  salt: 'binary/16',
  contacts: [User],
  invited: [User],
  index: [
    //You can use the object form
    {
      column: 'email',
      type: 'unique',
      length: '8',
    },
    //Or the short string form
    'pseudo/8'
  ],
};

const Comment = {
  content: 'text',
  title: {
    type : 'string',
    length: 60,
    nullable : true,
    defaultValue : null,
  },
  author: User,
  date: 'date',
  lastModification: 'date',
  index : ['date', 'content/fulltext'],
};

const Feed = {
  participants: [User],
  comments: [Comment],
};

//We need this step to use self-references or cross-references
User.contacts = [User];
User.invited = [User];

const tables = {User, Feed, Comment};

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
      read : none,          //no one can read the password
    },
    contacts : {
      add : and(
        is('self'),                       //Only ourself can add contacts
        request(not(member('contacts')))  //Cannot add oneself as our own contact
      ), 
    },
    invited : {
      add : and(
        is('self'),                       //Only ourself can invite contacts
        request(not(member('invited')))   //Cannot invite oneself as our own contact
      ), 
    },
    create : all,           //Creation is handled by login middleware. No one should create Users from request.
    delete : is('self'),    //Users can only delete their own profile
    write : is('self'),     //Users can only edit their own profile
    read : or(is('self'), member('contacts')), //Users and their contacts can read the profile data
  },
  Feed : {
    comments: {
      add : member('participants'),  //You need to be a member of the participants of the feed to create messages into the feed
      remove : is('comments.author'),   //Only the author of a message can decide to delete it
    },
    participants: {
      add : none,           //Once the feed is created, no one can add participants
      remove : none,        //Once the feed is created, no one can remove participants
    },
    delete : none,          //No one can delete a feed
    create : request(member('participants')), //Users always need to be a member of the feed they wish to create
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
    create : request(is('author')),   //To create a message, you need to declare yourself as the author
    write : request(is('author')),    //Only the author can edit their messages
    read : customRule                 //Only the feed's participants can read the message content ////FIXME TODO
  },
};

// You can always create your own rules. The parameters are described in the documentation.
/** Ensure that only the feed's participants can read the message content */
function customRule({authId}) {
  return ({request, query}) => query({
    Feed: {
      comments: {
        ...request,
        set: undefined,
        create: undefined,
        delete: undefined,
      },
      participants: {
        get: ['reservedId'],
      }
    },
  }).then(result => {
    return result.Feed.participants.includes(authId) || Promise.reject('Only feed participants can read message content');
  });
}

/*************************************************************************
 ****************************** CUSTOM PLUGINS ***************************/

// You can always create your own plugin if some fields requier extra attention. See the documentation for more details.
const customPlugin = {
  //This part will edit the request before querying the database
  onRequest: {
    User: (request, {query, isAdmin}) => {
      return Promise.resolve().then(() => {
        //Special management needed if we try to add a contact
        if(request.contacts && request.contacts.add) {
          //Before adding a contact, both involved contacts need to agree
          const user = {};
          if(request.email) user.email = request.email;
          if(request.pseudo) user.pseudo = request.pseudo;
          //We check if an invitation has already been made
          return query({ User : {...request.contacts.add, invited : user} }, {admin : true, readOnly : true})
            //Check if the user invited us and deny the request otherwise
            .then(({User : contacts}) => {
              //The contact didn't invite you yet. We cannot accept this request
              if(contacts.length===0) return Promise.reject({name : 'addingUnknownContact', status : 403, message: 'You cannot add a contact that didn\'t invite you before.'});
              //The contact will be added. We need to remove the user from the invited list of the contact
              return Promise.all(contacts.map(contact => query({User : {...contact, invited : { remove : user}}}, {admin : true, readOnly : true})));
            });
        }
      }).then(() => {
        //Special management needed if we try to invite a contact
        if(request.invited && request.invited.add && !isAdmin) {
          //You cannot invite someone already in your contacts
          const user = {};
          if(request.email) user.email = request.email;
          if(request.pseudo) user.pseudo = request.pseudo;
          //Looking for contact data
          return query({User : request.invited.add}, { admin : true, readOnly : true})
            .then(({User : results }) => query({User : { ...user, contacts : results }}, { admin : true, readOnly : true })
              .then(({ User : contacts }) => {
                if(contacts.length) return Promise.reject({name : 'alreadyAContact', status : 403, message : 'You cannot invite a user if they are already in your contacts list.'});
                //We insert the invitation manually because the user would not have enough credence.
                return query({User : { ...user, invited : { add : results }}}, { admin :true, readOnly : false}).then(() => {
                  console.log('--- results -----', results);
                  //We don't need anymore to add the invitee. We can just remove this part from the request
                  delete request.invited.add;
                  request.invited = results;
                });
              })
            );
        }
      });
    },
    Comment: (request, {parent}) => {
      console.log(parent);
      if(request.create) {
        //To create a message, the message needs to be associated to an existing feed
        if(parent.request && parent.request.tableName !== 'Feed') {
          return Promise.reject({
            error: 400,
            message: 'Message creation should always be made through a Feed'
          });
        }
        //Upon creation, we set the fields `date` and `lastModification`.
        const date = new Date();
        request.date = date;
        request.lastModification = date;
      }
      if(request.set) {
        //We update the `lastModification` field each time a modification happens
        const date = new Date();
        request.set.lastModification = date;
      }
    }
  }
};

const plugins = [
  loginPlugin({
    login: 'email',
    password: 'password',
    salt: 'salt',
    userTable: 'User',
  }),
  customPlugin,
];

module.exports = () => createServer({port : 80, tables, database, rules, plugins});
