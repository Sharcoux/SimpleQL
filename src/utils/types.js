// @ts-check

/** @typedef { 'string' | 'integer' | 'boolean' | 'function' | 'float' | 'undefined' | 'null' |'*' } TypeValue */

/** @typedef { TypeValue | Record<string, TypeValue | string[] | Record<string, TypeValue | string[] | boolean> | boolean> & { required?: string[]; strict?: boolean }} Model */

/** @type Model */
const dbColumn = {
  type: 'string',
  length: 'integer',
  unsigned: 'boolean',
  notNull: 'boolean',
  defaultValue: '*',
  required: ['type'],
  strict: true
}

/** @type Model */
const database = {
  user: 'string',
  password: 'string',
  type: 'string',
  privateKey: 'string',
  host: 'string',
  database: 'string',
  create: 'boolean',
  charset: 'string',
  connectionLimit: 'integer',
  required: ['user', 'password', 'type', 'privateKey', 'host', 'database']
}

/** @type Model */
const login = {
  login: 'string',
  password: 'string',
  salt: 'string',
  userTable: 'string',
  firstname: 'string',
  lastname: 'string',
  plugin: {
    google: 'string',
    facebook: 'string',
    strict: true
  },
  jwtConfig: {
    algorithm: 'string',
    expiresIn: 'string',
    notBefore: 'string',
    audience: 'string',
    issuer: 'string',
    jwtid: 'string',
    subject: 'string',
    noTimestamp: 'string',
    header: '*',
    keyId: 'string',
    mutatePayload: 'string',
    strict: true
  },
  required: ['login', 'password', 'userTable'],
  strict: true
}

/** @type Model */
const security = {
  app: 'function',
  domains: ['string'],
  emailACME: 'string',
  requestPerMinute: 'integer',
  required: ['app', 'domains', 'emailACME'],
  strict: true
}

/** @type Model */
const stripe = {
  secretKey: 'string',
  customerTable: 'string',
  customerStripeId: 'string',
  subscriptionTable: 'string',
  subscriptionStripeId: 'string',
  subscriptionItemTable: 'string',
  subscriptionItemStripeId: 'string',
  webhookURL: 'string',
  listeners: {},
  database: 'string',
  required: ['app', 'secretKey', 'customerTable', 'customerStripeId', 'database', 'webhookURL', 'database'],
  strict: true
}

module.exports = {
  dbColumn,
  database,
  login,
  security,
  stripe
}
