// @ts-check

/* eslint-disable require-atomic-updates */
const { createServer, modelFactory, is, none, all, plugins: { loginPlugin } } = require('../src')
const express = require('express')
const storagePlugin = require('../src/plugins/fileStorage')

const privateKey = require('crypto').randomFillSync(Buffer.alloc(20)).toString('base64')// Random private key

// Prepare your tables
const tables = /** @type {import('../src/utils').TablesDeclaration} */({})
const { User, File } = modelFactory(tables)

// User table
Object.assign(User, {
  login: 'string/25',
  password: 'binary/64',
  used: 'integer/4',
  total: 'integer/4',
  notNull: ['login', 'password', 'used', 'total'],
  index: ['login/unique']
})

Object.assign(File, storagePlugin.createFileModel(User))

// Log into your database solution like mysql
const database = {
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PWD,
  host: 'localhost',
  type: /** @type {'mysql'} */('mysql'),
  privateKey,
  database: 'inschool',
  create: !!process.env.CREATE_DATABASE
}

// Create your access table
const rules = {
  User: {
    login: {
      write: none
    },
    password: {
      write: is('self'), // Only the password can be changed by the user
      read: none // No one can access the passwords
    },
    salt: {
      read: none, // no one can read the salt
      write: none // no one can write the salt
    },
    used: {
      write: none
    },
    total: {
      write: none
    },
    create: all, // Creation is handled by login middleware. No one should create Users from request.
    delete: none, // Users profile cannot be deleted from any request except from admin
    write: is('self'),
    read: is('self') // Users can only read their own storage data
  },
  File: {
    owner: {
      write: none
    },
    create: is('owner'),
    delete: is('owner'),
    write: is('owner'),
    read: is('owner')
  }
}
// Create the app
const app = express()

// Create your plugins
const plugins = [
  loginPlugin({
    login: 'login',
    password: 'password',
    salt: 'salt',
    userTable: 'User'
  }),
  storagePlugin.create({
    ownerTableName: 'User',
    fileTableName: 'File',
    userSpace: 500
  })
]
app.listen(process.env.PORT)

// Create the server (we export for testing purpose only)
module.exports = createServer({ app, tables, database, rules, plugins }, { sizeLimit: '50mb' }).catch(err => {
  console.error(err)
  process.exit(1)
})
