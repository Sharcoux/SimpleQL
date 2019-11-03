
const dbColumn = {
  type : 'string',
  length: 'integer',
  unsigned: 'boolean',
  notNull: 'boolean',
  defaultValue: '*',
  required : ['type'],
  strict : true,
};

const database = {
  user: 'string',
  password: 'string',
  type: 'string',
  privateKey: 'string',
  host : 'string',
  database: 'string',
  create : 'boolean',
  charset : 'string',
  connectionLimit : 'integer',
  required : ['user', 'password', 'type', 'privateKey', 'host', 'database'],
};

const login = {
  login: 'string', 
  password: 'string',
  salt: 'string',
  userTable: 'string',
  required : ['login', 'password', 'userTable'],
  strict : true,
};

const security = {
  app: 'function',
  domains: ['string'],
  emailACME: 'string',
  requestPerMinute: 'number',
  required: ['app', 'domains', 'emailACME'],
  strict: true,
}

module.exports = {
  dbColumn,
  database,
  login,
  security,
};