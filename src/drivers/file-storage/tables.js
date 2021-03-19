// @ts-check

const { modelFactory, now } = require('../../utils')
// Prepare your tables
const tables = {}
const { User, File } = modelFactory(tables)

Object.assign(User, {
  login: 'string/25',
  password: 'binary/64',
  used: 'integer/4',
  total: 'integer/4',
  notNull: ['login', 'password', 'used', 'total'],
  index: ['login/unique']
})

Object.assign(File, {
  name: 'string/255',
  owner: User,
  createdAt: {
    type: 'dateTime',
    defaultValue: now
  },
  lastModified: 'dateTime',
  notNull: ['name', 'owner', 'createdAt', 'lastModified'],
  index: [{
    column: ['name', 'owner'],
    type: 'unique'
  }]
})

module.exports = {
  User,
  File
}
