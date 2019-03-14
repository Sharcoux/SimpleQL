#!/usr/bin/env node
const crypto = require('crypto');
const axios = require('axios');

const createTestServer = require('./example.js');

createTestServer()
  .then(() => console.log('\x1b[32m%s\x1b[0m', 'Test server ready'))

  // Registering 2 users
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Registration of 2 users'))
  .then(() => axios.post('/', {
    User : {
      create : [{
        pseudo : 'User1',
        email : 'user1@email.com',
        password: crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64'),
      },
      {
        pseudo : 'User2',
        email : 'user2@email.com',
        password: crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64'),
      }
      ]}
  }))
  .then(response => console.log('response ------', response.data) || response)

  // Login user
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Login as a User'))
  .then(() => axios.post('/', {
    email: 'user1@email.com',
    password: crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64'),
  }))
  .then(response => console.log('response ------', response.data) || response)

  //Use the jwt for user1 
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.jwt)

  //Retrieve all current user info
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Retrive current profile'))
  .then(() => axios.post('/', {
    User: {
      email: 'user1@email.com',
      get: '*',
    }
  }))
  .then(response => console.log('response ------', response.data) || response)
  
  //Forbidden : retrieve user2 private data
  // .then(() => axios.post('/', {
  //   User: {
  //     get: '*',
  //   }
  // }))
  // .then(response => console.log(response.data))
  //Adding a user as contact
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Adding a contact'))
  .then(() => axios.post('/', {
    User: {
      email : 'user1@email.com',
      contacts : {
        add : {email: 'user2@email.com'},
      }
    }
  }))
  .then(response => console.log('response ------', response.data) || response)

  //Creating a feed
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Creating a feed for the users'))
  .then(() => axios.post('/', {
    Feed: {
      create : {
        participants : {
          add : [
            {email : 'user1@email.com'},
            {email : 'user2@email.com'},
          ]
        }
      }
    }
  }))
  .then(response => console.log('response ------', response.data) || response)


//Creating a message

//Editing the message

//Forbidden : editing a message from another user

//Forbidden : deleting a message from another user

//Forbidden : editing another user
  
//Forbidden : deleting another user

  //Deleting user
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