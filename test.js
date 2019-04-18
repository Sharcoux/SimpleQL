#!/usr/bin/env node
const crypto = require('crypto');
const axios = require('axios');

const createTestServer = require('./example.js');

//We will use this as the password for our fake users.
const userHashedPassword = crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64');

createTestServer()
  .then(() => console.log('\x1b[32m%s\x1b[0m', 'Test server ready'))

  // Registering 2 users
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Registration of 2 users'))
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
  .then(response => console.log('response ------', response.data, '\n\n') || response)

  // Login as user1
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Login as User1'))
  .then(() => axios.post('/', {
    User: {
      email: 'user1@email.com',
      password: userHashedPassword,
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

  //Use the jwt for user1 
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.User[0].jwt)

  //Retrieve all current user info
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Retrive current profile'))
  .then(() => axios.post('/', {
    User: {
      email: 'user1@email.com',
      get: '*',
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)
  
  //Forbidden : retrieve user2 private data
  .then(() => axios.post('/', {
    User: {
      get: '*',
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

  //Forbidden : Adding a user not invited as contact
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Adding a contact'))
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
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Inviting a user as contact'))
  .then(() => axios.post('/', {
    User: {
      email : 'user1@email.com',
      invited : {
        add : {email: 'user2@email.com'},
      }
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

  //Creating a feed
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Creating a feed for the users'))
  .then(() => axios.post('/', {
    Feed: {
      create : true,
      participants : [
        {email : 'user1@email.com'},
        {email : 'user2@email.com'},
      ]
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

  //Creating a message
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Creating a message'))
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
            email : 'user1@email.com',
          }
        }
      }
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

//Editing the message

  // Login as user1
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Login as User2'))
  .then(() => axios.post('/', {
    User: {
      email: 'user2@email.com',
      password: userHashedPassword,
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

  //Use the jwt for user12
  .then(response => axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.User[0].jwt)

//Forbidden : editing a message from another user
  
//Forbidden : deleting a message from another user

  //Forbidden : editing another user
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Edit another user'))
  .then(() => axios.post('/', {
    User : {
      email: 'user1@email.com',
      set: {
        pseudo : 'random',
      }
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

//Retrieve all the messages between 2 dates

  //Forbidden : deleting another user
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Deleting another user'))
  .then(() => axios.post('/', {
    User : {
      email: 'user1@email.com',
      delete : true,
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

  //Deleting user
  .then(() => console.log('\x1b[36m%s\x1b[0m', 'Deleting our own data'))
  .then(() => axios.post('/', {
    User : {
      email: 'user2@email.com',
      delete : true,
    }
  }))
  .then(response => console.log('response ------', response.data, '\n\n') || response)

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