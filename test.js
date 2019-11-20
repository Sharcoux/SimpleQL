#!/usr/bin/env node
const crypto = require('crypto');
const axios = require('axios');

const log = require('./src/utils/logger');//This is just to color the logs
const util = require('util');
const createTestServer = require('./example.js');
const { getQuery } = require('./src');

//We will use this as the password for our fake users.
const userHashedPassword = crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64');
//This date will be used in our requests
const date = new Date();

function request(req) {
  log('test request', req);
  return axios.post('/', req);
}
function logResponse(response) {
  log('test response', util.inspect(response.data, false, null, true), '\n');
  return response;
}
function logError(response) {
  log('test error response', response.message, util.inspect(response.response.data, false, null, true), '\n');
  return response;
}

createTestServer()
  .then(() => log('test title', '\n', 'Test server ready'))

  // Registering 2 users
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Registration of 2 users'))
    .then(() => request({
      User : [
        {
          pseudo : 'User1',
          email : 'user1@email.com',
          password: userHashedPassword,
          create : true,
        },
        {
          pseudo : 'User2',
          email : 'user2@email.com',
          password: userHashedPassword,
          create : true,
        }
      ]
    }))
    .then(logResponse)
  )

  //Forbidden: Registration of a user with the same email
  .then(() => Promise.resolve()
    .then(() => log('test error title', '\n', 'Forbidden: Registration of a user with the same email'))
    .then(() => request({
      User :
        {
          pseudo : 'User1',
          email : 'user1@email.com',
          password: userHashedPassword,
          create : true,
        },
    }))
    .catch(logError)
  )
  
  // Login as user1
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Login as User1'))
    .then(() => request({
      User: {
        email: 'user1@email.com',
        password: userHashedPassword,
      }
    }))
    .then(logResponse)
  )
  
  //Use the jwt for user1 
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.User[0].jwt)

  //Getting accessible users with their contacts
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Getting user with their contacts'))
    .then(() => request({
      User : {
        contacts: {
          email: 'user2@email.com',
          get: '*',
        }
      }
    }))
    .then(logResponse)
  )
  
  //Getting only users that have contacts
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Getting only users that have user2 as a contact'))
    .then(() => request({
      User : {
        contacts: {
          email: 'user2@email.com',
          get: '*',
          required: true,
        }
      }
    }))
    .then(logResponse)
  )
  
  //Retrieve all current user info
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Retrive current profile'))
    .then(() => request({
      User: {
        email: 'user1@email.com',
        get: '*',
      }
    }))
    .then(logResponse)
  )
    
  //Forbidden : retrieve user2 private data
  .then(() => Promise.resolve()
    .then(() => log('test error title', '\n', 'Forbidden : Retrive profile from another user'))
    .then(() => request({
      User: {
        email: 'user2@email.com',
        get: '*',
      }
    }))
    .then(logResponse)
  )

  //Forbidden : Adding a user not invited as contact
  .then(() => Promise.resolve()
    .then(() => log('test error title', '\n', 'Forbidden : Adding a contact'))
    .then(() => request({
      User: {
        email : 'user1@email.com',
        contacts : {
          add : {email: 'user2@email.com'},
        }
      }
    }))
    .catch(logError)
  )
  
  //Invite a user as contact
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Inviting a user as contact'))
    .then(() => request({
      User: {
        email : 'user1@email.com',
        invited : {
          add : {email: 'user2@email.com'},
        }
      }
    }))
    .then(logResponse)
  )

  // Login as user2
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Login as User2'))
    .then(() => request({
      User: {
        email: 'user2@email.com',
        password: userHashedPassword,
      }
    }))
    .then(logResponse)
  )
  //Use the jwt for user12
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.User[0].jwt)

  //Adding a user invited as contact
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Adding a contact'))
    .then(() => request({
      User: {
        email : 'user2@email.com',
        contacts : {
          add : {email: 'user1@email.com'},
        }
      }
    }))
    .then(logResponse)
  )

  //Creating a feed
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Creating a feed for the users'))
    .then(() => request({
      Feed: {
        create : true,
        participants : [
          {email : 'user1@email.com'},
          {email : 'user2@email.com'},
        ]
      }
    }))
    .then(logResponse)
  )

  //Creating a message
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Creating a message'))
    .then(() => request({
      Feed : {
        participants : [
          { email : 'user1@email.com' },
          { email : 'user2@email.com' },
        ],
        comments : {
          add : {
            create : true,
            content : 'test',
            title : 'Test',
            author: {
              email : 'user2@email.com',
            }
          }
        }
      }
    }))
    .then(logResponse)
  )

  //Editing all messages between 2 dates
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Editing all messages between 2 dates'))
    .then(() => request({
      Comment : {
        title : 'Test',
        author: {
          email : 'user2@email.com',
        },
        date : {
          lt : new Date(new Date(date).setHours(date.getHours() + 2)).toISOString(),
          gt : new Date(new Date(date).setHours(date.getHours() - 2)).toISOString(),
        },
        set : {
          title : 'random',
        }
      }
    }))
    .then(logResponse)
  )

  //Retrieving messages using limit, offset and order
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Retrieving messages using limit, offset and order'))
    .then(() => request({
      Comment : {
        author: {
          email : 'user2@email.com',
        },
        limit: 1,
        offset: 0,
        order: ['-date', 'title'],
        get : '*',
      }
    }))
    .then(logResponse)
  )

  //Forbidden : editing another user data
  .then(() => Promise.resolve()
    .then(() => log('test error title', '\n', 'Forbidden : Edit another user'))
    .then(() => request({
      User : {
        email: 'user1@email.com',
        set: {
          pseudo : 'random',
        }
      }
    }))
    .catch(logError)
  )

  //Editing our personal data
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Edit our personal data'))
    .then(() => request({
      User : {
        email: 'user2@email.com',
        set: {
          pseudo : 'random',
        }
      }
    }))
    .then(logResponse)
  )

  //Forbidden : deleting another user
  .then(() => Promise.resolve()
    .then(() => log('test error title', '\n', 'Forbidden : Deleting another user'))
    .then(() => request({
      User : {
        email: 'user1@email.com',
        delete : true,
      }
    }))
    .catch(logError)
  )

  //Deleting our own message
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Deleting our own message'))
    .then(() => request({
      Comment: {
        author: {
          email : 'user2@email.com',
          required: true,
        },
        delete: true,
      }
    }))
    .then(logResponse)
  )

  //Deleting user
  .then(() => Promise.resolve()
    .then(() => log('test title', '\n', 'Deleting our own data'))
    .then(() => request({
      User : {
        email: 'user2@email.com',
        delete : true,
      }
    }))
    .then(logResponse)
  )

  //Server-side request test
  .then(() => {
    return Promise.all([getQuery('simpleql').then(query => query({User: {
      pseudo : 'Admin',
      email : 'admin@email.com',
      password: userHashedPassword,
      create : true,
    }})),
    getQuery('simpleql').then(query => query({User: {
      pseudo : 'Admin2',
      email : 'admin2@email.com',
      password: userHashedPassword,
      create : true,
    }}))]);
  })

  .catch(err => {
    if(err.response) {
      console.error(err.message, '\n', err.response.data);
    } else {
      console.error(err);
    }
  }).then(process.exit);
