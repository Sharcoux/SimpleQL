#!/usr/bin/env node
const crypto = require('crypto');
const axios = require('axios');

const { red, cyan } = require('./src/utils/colors');//This is just to color the logs
const util = require('util');
const createTestServer = require('./example.js');
const logResponse = response => console.log('response ------', util.inspect(response.data, false, null, true), '\n\n') || response;

//We will use this as the password for our fake users.
const userHashedPassword = crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64');

createTestServer()
  .then(() => console.log('\x1b[32m%s\x1b[0m', 'Test server ready'))

  // Registering 2 users
  .then(() => console.log(cyan, 'Registration of 2 users'))
  .then(() => axios.post('/', {
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

  // Login as user1
  .then(() => console.log(cyan, 'Login as User1'))
  .then(() => axios.post('/', {
    User: {
      email: 'user1@email.com',
      password: userHashedPassword,
    }
  }))
  .then(logResponse)

  //Use the jwt for user1 
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.User[0].jwt)

  //Retrieve all current user info
  .then(() => console.log(cyan, 'Retrive current profile'))
  .then(() => axios.post('/', {
    User: {
      email: 'user1@email.com',
      get: '*',
    }
  }))
  .then(logResponse)
  
  //Forbidden : retrieve user2 private data
  .then(() => console.log(red, 'Forbidden : Retrive profile from another user'))
  .then(() => axios.post('/', {
    User: {
      email: 'user2@email.com',
      get: '*',
    }
  }))
  .then(logResponse)

  //Forbidden : Adding a user not invited as contact
  .then(() => console.log(red, 'Forbidden : Adding a contact'))
  .then(() => axios.post('/', {
    User: {
      email : 'user1@email.com',
      contacts : {
        add : {email: 'user2@email.com'},
      }
    }
  }))
  .catch(response => console.log('response ------', response.message, response.response.data, '\n\n') || response)

  //Invite a user as contact
  .then(() => console.log(cyan, 'Inviting a user as contact'))
  .then(() => axios.post('/', {
    User: {
      email : 'user1@email.com',
      invited : {
        add : {email: 'user2@email.com'},
      }
    }
  }))
  .then(logResponse)

//Editing the message

  // Login as user2
  .then(() => console.log(cyan, 'Login as User2'))
  .then(() => axios.post('/', {
    User: {
      email: 'user2@email.com',
      password: userHashedPassword,
    }
  }))
  .then(logResponse)

  //Use the jwt for user12
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.User[0].jwt)

  //Adding a user not invited as contact
  .then(() => console.log(cyan, 'Adding a contact'))
  .then(() => axios.post('/', {
    User: {
      email : 'user2@email.com',
      contacts : {
        add : {email: 'user1@email.com'},
      }
    }
  }))
  .then(logResponse)


  //Creating a feed
  .then(() => console.log(cyan, 'Creating a feed for the users'))
  .then(() => axios.post('/', {
    Feed: {
      create : true,
      participants : [
        {email : 'user1@email.com'},
        {email : 'user2@email.com'},
      ]
    }
  }))
  .then(logResponse)

  //Creating a message
  .then(() => console.log(cyan, 'Creating a message'))
  .then(() => axios.post('/', {
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

//Forbidden : editing a message from another user
  
//Forbidden : deleting a message from another user

  //Forbidden : editing another user
  .then(() => console.log(red, 'Forbidden : Edit another user'))
  .then(() => axios.post('/', {
    User : {
      email: 'user1@email.com',
      set: {
        pseudo : 'random',
      }
    }
  }))
  .then(logResponse)

//Retrieve all the messages between 2 dates

  //Forbidden : deleting another user
  .then(() => console.log(red, 'Forbidden : Deleting another user'))
  .then(() => axios.post('/', {
    User : {
      email: 'user1@email.com',
      delete : true,
    }
  }))
  .then(logResponse)

  //Deleting user
  .then(() => console.log(cyan, 'Deleting our own data'))
  .then(() => axios.post('/', {
    User : {
      email: 'user2@email.com',
      delete : true,
    }
  }))
  .then(logResponse)

  .catch(err => {
    if(err.response) {
      console.error(err.message, '\n', err.response.data);
    } else {
      console.error(err);
    }
  }).then(process.exit);

// const a = {
//   User : {
//     contacts : {
//       email : '',
//       contacts : {
//         remove : {
//           email : '',
//         }
//       },
//       remove : {
//         email : '',
//       }
//     }
//   }
// };