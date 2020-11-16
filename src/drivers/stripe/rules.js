// @ts-check
const { all, none, is } = require('../../accessControl')
const { prepareRules } = require('../../prepare')

/** @type {import('../../accessControl').FullTableRule} */
const customerData = {
  create: is('customer'),
  delete: is('customer'),
  read: is('customer'),
  write: is('customer'),
  id: {
    write: none
  },
  object: {
    write: none
  },
  created: {
    write: none
  }
}

/** @type {import('../../accessControl').TableRule} */
const publicData = {
  create: none,
  delete: none,
  read: all,
  write: none
}

/** @type {import('../../accessControl').TableRule} */
const privateData = {
  create: none,
  delete: none,
  read: none,
  write: none
}

/** @type {import('../../accessControl').TableRule} */
const customerReadOnlyData = {
  create: none,
  delete: none,
  read: is('customer'),
  write: none
}

/** @type {import('../../accessControl').FullTableRule} */
const Customer = {
  create: none,
  delete: none,
  read: is('self'),
  write: none,
  address: {
    write: is('self')
  },
  description: {
    write: is('self')
  },
  phone: {
    write: is('self')
  },
  shipping: {
    write: is('self')
  },
  preferred_locales: {
    write: is('self')
  }
}

/** @type {import('../../accessControl').TableRule} */
const SubscriptionItem = {
  create: none,
  delete: none,
  read: is('subscription.customer'),
  write: none
}

/** @type {import('../../accessControl').TableRule} */
const Review = {
  create: none,
  delete: none,
  read: is('session.customer'),
  write: none
}

/** @type {import('./').StripeTables<import('../../accessControl').TableRule>} */
const rules = {
  Customer,
  SubscriptionItem,
  Review,
  Plan: publicData,
  Product: publicData,
  Price: publicData,
  Discount: publicData,
  Coupon: publicData,
  TaxRate: publicData,
  //   Item: publicData,
  PaymentMethod: customerData,
  SetupIntent: customerData,
  SubscriptionSchedule: customerData,
  PaymentIntent: customerData,
  Source: customerData,
  Subscription: customerReadOnlyData,
  TaxId: customerReadOnlyData,
  Invoice: customerReadOnlyData,
  InvoiceItem: customerReadOnlyData,
  //   LineItem: customerReadOnlyData,
  PromotionCode: customerReadOnlyData,
  //   SetupAttempt: customerReadOnlyData,
  Charge: customerReadOnlyData,
  Session: customerReadOnlyData,
  Account: privateData,
  //   ExternalAccount: privateData,
  Mandate: privateData,
  Refund: privateData,
  BalanceTransaction: privateData,
  Transfer: privateData,
  TransferReversal: privateData,
  ExternalAccount: privateData
}

const { tables } = require('./tables')
const preparedRules = prepareRules({ rules, tables })
module.exports = preparedRules
