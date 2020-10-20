
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
  firstname: 'string',
  lastname: 'string',
  plugin: {
    google: 'string',
    facebook: 'string',
    strict: true,
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
};

const stripe = {
  app: 'function',
  secretKey: 'string',
  webhookURL: 'string',
  decimal: 'boolean',
  VAT: {
    country: 'string',
    percentage: 'number',
    required: ['country', 'percentage'],
    strict: true,
  },
  defaultCurrency: 'string',
  productsTable: 'string',
  plansTable: 'string',
  subscriptionsTable: 'string',
  customersTable: 'string',
  paymentMethodsTable: 'string',
  paymentsTable: 'string',

  productName: 'string',
  amount: 'string',
  currency: 'string',
  interval: 'string',
  intervalCount: 'string',
  trialPeriod: 'string',
  product: 'string',
  customer: 'string',
  subscriptionItems: 'string',
  paymentMethod: 'string',
  expMonth: 'string',
  expYear: 'string',
  cardNumber: 'string',
  cardCVC: 'string',
  iban: 'string',
  idealBank: 'string',
  paymentType: 'string',
  required: ['app', 'secretKey', 'webhookURL', 'planTable', 'subscrptionTable', 'userTable'],
  strict: true,
};

module.exports = {
  dbColumn,
  database,
  login,
  security,
  stripe,
};
