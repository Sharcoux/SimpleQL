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

createTestServer()
  .then(() => log('test title', '\n', 'Test server ready'))

  // Registering 2 users
  .then(() => positiveTest('Registration of 2 users',
    {
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

  //Forbidden: Registration of a user with the same email
  .then(() => negativeTest('Forbidden: Registration of a user with the same email',
    {
      User :
        {
          pseudo : 'User1',
          email : 'user1@email.com',
          password: userHashedPassword,
          create : true,
        },
    }))
  
  // Login as user1
  .then(() => positiveTest('Login as User1',
    {
      User: {
        email: 'user1@email.com',
        password: userHashedPassword,
      }
    }))
  
  //Use the jwt for user1 
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.User[0].jwt)

  //Getting accessible users with their contacts
  .then(() => positiveTest('Getting user with their contacts',
    {
      User : {
        contacts: {
          email: 'user2@email.com',
          get: '*',
        }
      }
    }))
  
  //Getting only users that have contacts
  .then(() => positiveTest('Getting only users that have user2 as a contact',
    {
      User : {
        contacts: {
          email: 'user2@email.com',
          get: '*',
          required: true,
        }
      }
    }))
  
  //Retrieve all current user info
  .then(() => positiveTest('Retrive current profile',
    {
      User: {
        email: 'user1@email.com',
        get: '*',
      }
    }))
    
  //Forbidden : retrieve user2 private data
  .then(() => positiveTest('Restricted : Retrive profile from another user',
    {
      User: {
        email: 'user2@email.com',
        get: '*',
      }
    }))

  //Forbidden : Adding a user not invited as contact
  .then(() => negativeTest('Forbidden : Adding a contact',
    {
      User: {
        email : 'user1@email.com',
        contacts : {
          add : {email: 'user2@email.com'},
        }
      }
    }))
  
  //Forbidden : Inviting oneself as contact
  .then(() => negativeTest('Forbidden : Inviting oneself as a contact',
    {
      User: {
        email : 'user1@email.com',
        invited : {
          add : {email: 'user1@email.com'},
        }
      }
    }))
    
  //Invite a user as contact
  .then(() => positiveTest('Inviting a user as contact',
    {
      User: {
        email : 'user1@email.com',
        invited : {
          add : {email: 'user2@email.com'},
        }
      }
    }))

  //Forbidden : Adding a contact as contact
  .then(() => negativeTest('Forbidden : Inviting a contact as a contact',
    {
      User: {
        email : 'user1@email.com',
        contacts : {
          add : {email: 'user2@email.com'},
        }
      }
    }))
  
  // Login as user2
  .then(() => positiveTest('Login as User2',
    {
      User: {
        email: 'user2@email.com',
        password: userHashedPassword,
      }
    }))
  //Use the jwt for user12
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.User[0].jwt)

  //Adding a user invited as contact
  .then(() => positiveTest('Adding a contact',
    {
      User: {
        email : 'user2@email.com',
        contacts : {
          add : {email: 'user1@email.com'},
        }
      }
    }))

  //Creating a feed
  .then(() => positiveTest('Creating a feed for the users',
    {
      Feed: {
        create : true,
        participants : [
          {email : 'user1@email.com'},
          {email : 'user2@email.com'},
        ]
      }
    }))

  //Creating a message
  .then(() => positiveTest('Creating a message',
    {
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

  //Forbidden: Creating a message with no feed
  .then(() => negativeTest('Forbidden: Creating a message with no feed',
    {
      Comment : {
        create : true,
        content : 'test',
        title : 'Test',
        author: {
          email : 'user2@email.com',
        }
      }
    }))

  //Forbidden: Creating a bad formatted message 
  .then(() => negativeTest('Forbidden: Creating a bad formatted message',
    {
      Feed : {
        participants : [
          { email : 'user1@email.com' },
          { email : 'user2@email.com' },
        ],
        comments : {
          add : {
            create : true,
            content : { title: 'test', content: 'content'},
            title : 'Test',
            author: {
              email : 'user2@email.com',
            }
          }
        }
      }
    }))

  //Editing all messages between 2 dates
  .then(() => positiveTest('Editing all messages between 2 dates',
    {
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

  //Retrieving messages using limit, offset and order
  .then(() => positiveTest('Retrieving messages using limit, offset and order',
    {
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

  //Forbidden : editing another user data
  .then(() => negativeTest('Forbidden : Edit another user',
    {
      User : {
        email: 'user1@email.com',
        set: {
          pseudo : 'random',
        }
      }
    }))

  //Editing our personal data
  .then(() => positiveTest('Edit our personal data',
    {
      User : {
        email: 'user2@email.com',
        set: {
          pseudo : 'random',
        }
      }
    }))

  //Forbidden : deleting another user
  .then(() => negativeTest('Forbidden : Deleting another user',
    {
      User : {
        email: 'user1@email.com',
        delete : true,
      }
    }))

  //Deleting our own message
  .then(() => positiveTest('Deleting our own message',
    {
      Comment: {
        author: {
          email : 'user2@email.com',
          required: true,
        },
        delete: true,
      }
    }))

  //Deleting user
  .then(() => positiveTest('Deleting our own data',
    {
      User : {
        email: 'user2@email.com',
        delete : true,
      }
    }))

  //Concurrent server-side request test
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




function request(req) {
  log('test request', req);
  return axios.post('/', req);
}
function logResponse(response) {
  log('test response', util.inspect(response.data, false, null, true), '\n');
  return response;
}
function logError(response) {
  log('test error response', response.message, util.inspect(response.response && response.response.data, false, null, true), '\n');
  return response;
}
function shouldFail(response) {
  console.error('The previous request succeeded whereas it should have failed');
  log('test response', util.inspect(response.data, false, null, true), '\n');
  process.exit();
}
function shouldSucceed(response) {
  console.error('The previous request failed whereas it should have succeeded');
  log('test error response', response.message, util.inspect(response.response && response.response.data, false, null, true), '\n');
  process.exit();
}
function positiveTest(name, query) {
  return Promise.resolve()
    .then(() => log('test title', '\n', name))
    .then(() => request(query))
    .then(logResponse)
    .catch(shouldSucceed);
}
function negativeTest(name, query) {
  return Promise.resolve()
    .then(() => log('test error title', '\n', name))
    .then(() => request(query))
    .then(shouldFail)
    .catch(logError);
}
