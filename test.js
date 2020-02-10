#!/usr/bin/env node
const crypto = require('crypto');
const Testing = require('simple-ql-testing');

const log = require('./src/utils/logger');//This is just to color the logs
const createTestServer = require('./example.js');
const { getQuery } = require('./src');

//We will use this as the password for our fake users.
const userHashedPassword = crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64');
//This date will be used in our requests
const date = new Date();

const test = Testing('/');
const createTest = Testing.createTest;

createTestServer()
  .then(() => log('info', '\n', 'Test server ready'))
  .then(() => test([
    createTest(true, 'Registration of 2 users',
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
      }),

    createTest(false, 'Forbidden: Registration of a user with the same email',
      {
        User :
          {
            pseudo : 'User1',
            email : 'user1@email.com',
            password: userHashedPassword,
            create : true,
          },
      }),

    createTest(true, 'Login as User1',
      {
        User: {
          email: 'user1@email.com',
          password: userHashedPassword,
        }
      }
    ),

  ]))
  .then(response => Testing.setJWT(response.data.User[0].jwt))
  .then(() => test([
    createTest(true, 'Getting user with their contacts',
      {
        User : {
          contacts: {
            email: 'user2@email.com',
            get: '*',
          }
        }
      }),

    createTest(true, 'Getting only users that have user2 as a contact',
      {
        User : {
          contacts: {
            email: 'user2@email.com',
            get: '*',
            required: true,
          }
        }
      }),

    createTest(true, 'Retrive current profile',
      {
        User: {
          email: 'user1@email.com',
          get: '*',
        }
      }),

    createTest(true, 'Restricted : Retrive profile from another user',
      {
        User: {
          email: 'user2@email.com',
          get: '*',
        }
      }),

    createTest(false, 'Forbidden : Adding a contact',
      {
        User: {
          email : 'user1@email.com',
          contacts : {
            add : {email: 'user2@email.com'},
          }
        }
      }),

    createTest(false, 'Forbidden : Inviting oneself as a contact',
      {
        User: {
          email : 'user1@email.com',
          invited : {
            add : {email: 'user1@email.com'},
          }
        }
      }),

    createTest(true, 'Inviting a user as contact',
      {
        User: {
          email : 'user1@email.com',
          invited : {
            add : {email: 'user2@email.com'},
          }
        }
      }),

    createTest(false, 'Forbidden : Adding as a contact someone that didn\'t invite you nor accepted you as a contact',
      {
        User: {
          email : 'user1@email.com',
          contacts : {
            add : {email: 'user2@email.com'},
          }
        }
      }),

    createTest(true, 'Login as User2',
      {
        User: {
          email: 'user2@email.com',
          password: userHashedPassword,
        }
      })

  ]))
  .then(response => Testing.setJWT(response.data.User[0].jwt))
  .then(() => test([
    createTest(true, 'Adding a contact',
      {
        User: {
          email : 'user2@email.com',
          contacts : {
            add : {email: 'user1@email.com'},
          }
        }
      }),

    createTest(false, 'Forbidden : Adding a contact as a contact',
      {
        User: {
          email : 'user2@email.com',
          contacts : {
            add : {email: 'user1@email.com'},
          }
        }
      }),

    createTest(true, 'Creating a feed for the users',
      {
        Feed: {
          create : true,
          participants : [
            {email : 'user1@email.com'},
            {email : 'user2@email.com'},
          ]
        }
      }),

    createTest(true, 'Creating a message',
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
      }),

    createTest(false, 'Forbidden: Creating a message with no feed',
      {
        Comment : {
          create : true,
          content : 'test',
          title : 'Test',
          author: {
            email : 'user2@email.com',
          }
        }
      }),

    createTest(false, 'Forbidden: Creating a bad formatted message',
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
      }),

    createTest(true, 'Editing all messages between 2 dates',
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
      }),

    createTest(true, 'Retrieving messages using limit, offset and order',
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
      }),

    createTest(false, 'Forbidden : Edit another user',
      {
        User : {
          email: 'user1@email.com',
          set: {
            pseudo : 'random',
          }
        }
      }),

    createTest(true, 'Edit our personal data',
      {
        User : {
          email: 'user2@email.com',
          set: {
            pseudo : 'random',
          }
        }
      }),

    createTest(false, 'Forbidden : Deleting another user',
      {
        User : {
          email: 'user1@email.com',
          delete : true,
        }
      }),

    createTest(true, 'Deleting our own message',
      {
        Comment: {
          author: {
            email : 'user2@email.com',
            required: true,
          },
          delete: true,
        }
      }),

    createTest(false, 'Replacing all contacts with bad formatted instruction',
      {
        User : {
          email: 'user2@email.com',
          set: {
            contacts: 'id'
          }
        }
      }),

    createTest(true, 'Deleting our own data',
      {
        User : {
          email: 'user2@email.com',
          delete : true,
        }
      }),
  ]))

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
