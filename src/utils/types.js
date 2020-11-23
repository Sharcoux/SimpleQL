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
    nonce: 'string',
    subject: 'string',
    maxAge: 'string',
    issuer: 'string',
    complete: 'boolean',
    clockTolerance: 'integer',
    clockTimestamp: 'integer',
    algorithm: 'string',
    ignoreExpiration: 'boolean',
    ignoreNotBefore: 'boolean',
    expiresIn: 'string',
    notBefore: 'string',
    audience: 'string',
    jwtid: 'string',
    noTimestamp: 'string',
    header: '*',
    keyId: 'string',
    mutatePayload: 'boolean',
    encoding: 'string',
    strict: true
  },
  required: ['login', 'password', 'userTable'],
  strict: true
}

/** @type Model */
const security = {
  domains: ['string'],
  emailACME: 'string',
  requestPerMinute: 'integer',
  required: ['app', 'domains', 'emailACME'],
  strict: true
}

/** @type Model */
const stripe = {
  adminKey: 'string',
  secretKey: 'string',
  customerTable: 'string',
  webhookURL: 'string',
  webhookSecret: 'string',
  listeners: {},
  database: 'string',
  required: ['secretKey', 'customerTable', 'webhookURL', 'database'],
  strict: true
}

module.exports = {
  dbColumn,
  database,
  login,
  security,
  stripe
}
