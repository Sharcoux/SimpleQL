#!/usr/bin/env node
const crypto = require('crypto');
const axios = require('axios');

const createTestServer = require('./example.js');

createTestServer()
  .then(() => console.log('\x1b[32m%s\x1b[0m', 'Test server ready'))
  // Registering user
  .then(() => axios.post('/', {
    User : {
      create : {
        email : 'test@email.com',
        password: crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64'),
      }
    }
  }))
  // Login user
  // .then(() => axios.post('/', {
  //   email: 'test@email.com',
  //   password: crypto.pbkdf2Sync('password', '', 1, 64, 'sha512').toString('base64'),
  // })).then(response => {
  //   console.log(response);
  // })
  .catch(err => {
    if(err.response) {
      console.error(err.message, '\n', err.response.data);
    } else {
      console.error(err);
    }
  }).then(process.exit);
