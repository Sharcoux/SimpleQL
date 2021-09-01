// @ts-check

const { filterObject, intersection, isPrimitive } = require('../../utils')
const { expandable, asList } = require('./tables')

/**
 * @typedef {Object} StripeObject
 * @property {string} id
 * @property {string} object
 */

/**
 * @typedef {Object} Helper
 * @property {(elt: Object) => Promise<StripeObject>} create
 * @property {(elt: Object & StripeObject) => Promise<void>} delete
 * @property {(elt: Object & StripeObject, values: Object.<string, any>) => Promise<void>} update
 * @property {(params: Object, search: string[]) => Promise<StripeObject[]>} list
 * @property {(elt: Object & StripeObject, search: string[]) => Promise<StripeObject>} retrieve
 */

/**
 * @typedef { 'sourcesCustomer' | 'subscriptionsCustomer' | 'tax_idsCustomer' | 'itemsSubscription' |
'default_tax_ratesSubscription' | 'tax_ratesSubscriptionItem' | 'account_tax_idsInvoice' |
'customer_tax_idsInvoice' | 'default_tax_ratesInvoice' | 'discountsInvoice' | 'external_accountsAccount' |
'chargesPaymentIntent' | 'refundsCharge' | 'discountsInvoiceItem' | 'tax_ratesInvoiceItem' | 'reversalsTransfer' } AssociationTable
**/

/** @type {import('./index').StripeTables<string[]>} These are the props that we can provide to get more accurate data from list() */
const props = {
  Customer: ['created', 'email'],
  Product: ['active', 'created', 'type', 'url', 'shippable', 'ids'],
  Plan: ['active', 'created', 'product'],
  Price: ['active', 'created', 'recurring', 'product', 'currency', 'lookup_keys', 'type'],
  Subscription: ['collection_method', 'items', 'created', 'current_period_end', 'current_period_start', 'customer', 'plan', 'price', 'status'],
  SubscriptionItem: ['subscription'],
  SubscriptionSchedule: ['canceled_at', 'completed_at', 'created', 'customer', 'released_at', 'scheduled'],
  Account: ['created'],
  Invoice: ['collection_method', 'created', 'customer', 'due_date', 'status', 'subscription'],
  TaxRate: ['active', 'created', 'inclusive'],
  TaxId: [],
  Discount: [],
  PaymentMethod: ['customer', 'type'],
  SetupIntent: ['created', 'customer', 'payment_method'],
  PaymentIntent: ['created', 'customer'],
  Source: [],
  ExternalAccount: [],
  Coupon: ['created'],
  Session: ['object'],
  InvoiceItem: ['created', 'customer', 'invoice', 'pending'],
  PromotionCode: ['active', 'code', 'coupon', 'created', 'customer'],
  Mandate: [],
  Review: ['created'],
  BalanceTransaction: ['available_on', 'created', 'currency', 'payout', 'source', 'type'],
  Charge: ['created', 'customer', 'payment_intent', 'transfer_group'],
  Refund: [],
  Transfer: ['created', 'destination', 'transfer_group'],
  TransferReversal: []
}

/** @type {import('./index').StripeTables<string>} Convert a table name to it's prop equivalent in Stripe API */
const tableToTableProp = {
  Account: 'accounts',
  BalanceTransaction: 'balanceTransactions',
  Charge: 'charges',
  Coupon: 'coupons',
  Customer: 'customers',
  Discount: '', // customers...
  ExternalAccount: '', // accounts....
  Invoice: 'invoices',
  InvoiceItem: 'invoiceItems',
  Mandate: 'mandates',
  PaymentIntent: 'paymentIntents',
  PaymentMethod: 'paymentMethods',
  Plan: 'plans',
  Price: 'prices',
  Product: 'products',
  PromotionCode: 'promotionCodes',
  Refund: 'refunds',
  Review: 'reviews',
  Session: '', // checkout.sessions
  SetupIntent: 'setupIntents',
  Source: 'sources',
  Subscription: 'subscriptions',
  SubscriptionItem: 'subscriptionItems',
  SubscriptionSchedule: 'subscriptionSchedules',
  TaxId: '', // customers...
  TaxRate: 'taxRates',
  Transfer: 'transfers',
  TransferReversal: '' // transfer...
}

/**
 * Build the extra parameter for retrieve and list requests
 * @param {string} table The table name
 * @param {string[]} search The list of columns to search in the database
 * @param {boolean} retrieve Is this list() or retrieve()? We need this because Stripe API is inconsistent for expand fields
 * @param {Object=} source The constraints on the objects we are looking for
 */
function buildParameter (table, search, retrieve, source) {
  // We keep only the parameters accepted by the list() API form Stripe
  const base = source ? filterObject(source, props[table]) : {}
  // Single child array are flatten
  Object.keys(base).forEach(key => Array.isArray(base[key]) && base[key].length === 1 && (base[key] = base[key][0]))
  // We cannot accept complex condition object for now. Only primitives are accepted.
  Object.keys(base).forEach(key => !isPrimitive(base[key]) && delete base[key])
  // We expand the expandable fields from Stripe (see Expandable in Stripe documentation)
  Object.assign(base, {
    expand: intersection(search, expandable[table]).map(key => {
      return retrieve ? key : ('data.' + key)
    })
  })
  return base
}

/**
 * @param {import('stripe').Stripe} stripe
 * @returns {(table: import('.').StripeTable | AssociationTable) => Helper}
 */
function helperGetter (stripe) {
  /** @type {(table: string) => Helper} */
  function defaultHelper (table) {
    return {
      create: element => stripe[tableToTableProp[table]].create(element),
      delete: element => stripe[tableToTableProp[table]].del(element.id),
      update: (element, values) => stripe[tableToTableProp[table]].update(element.id, values),
      list: async (params, search) => (await stripe[tableToTableProp[table]].list(buildParameter(table, search, false, params))).data,
      retrieve: (element, search) => stripe[tableToTableProp[table]].retrieve(element.id, buildParameter(table, search, true))
    }
  }

  /** @type {() => Helper} */
  function reversalHelper () {
    const table = 'TransferReversal'
    return {
      create: element => stripe.transfers.createReversal(element.transfert, element),
      delete: () => Promise.reject(`Impossible to delete ${table} with Stripe API`),
      update: async (element, values) => { stripe.transfers.updateReversal(element.transfert, element.id, values) },
      list: async (params, search) => (await stripe.transfers.listReversals(params.transfert, buildParameter(table, search, false, params))).data,
      retrieve: (element, search) => stripe.transfers.retrieve(element.transfert, element.id, buildParameter(table, search, true))
    }
  }

  /** @type {(table: string) => Helper} */
  function subscriptionHelper () {
    const table = 'Subscription'
    return {
      ...defaultHelper(table),
      list: async (params, search) => {
        if (search.includes('items')) {
          const subscriptions = (await stripe.subscriptions.list(params.transfert, buildParameter(table, search, false, params))).data
          return await Promise.all(subscriptions.map(async subs => {
            const items = await stripe.subscriptionItems.list({ subscription: subs.id })
            return { ...subs, items }
          }))
        }
        else return (await stripe.subscriptions.list(buildParameter(table, search, false, params))).data
      }
    }
  }

  /** @type {(table: string) => Helper} */
  function undelatableHelper (table) {
    return {
      ...defaultHelper(table),
      delete: () => Promise.reject(`Impossible to delete ${table} with the Stripe API`)
    }
  }

  /** @type {(table: string) => Helper} */
  function unretrievableHelper (table) {
    return {
      create: () => Promise.reject(`Impossible to create ${table} with the Stripe API`),
      delete: () => Promise.reject(`Impossible to delete ${table} with the Stripe API`),
      list: () => Promise.reject(`Impossible to list ${table} with the Stripe API`),
      update: () => Promise.reject(`Impossible to update ${table} with the Stripe API`),
      retrieve: () => Promise.reject(`Impossible to retrieve ${table} with the Stripe API`)
    }
  }

  /** @type {(table: 'Discount' | 'BalanceTransaction' | 'TaxId' | 'Source') => Helper} */
  function customerHelper (table) {
    return {
      create: element => table === 'Discount'
        ? Promise.reject('impossible to create discount from Stripe API')
        : stripe.customers['create' + table](element.customer, element),
      delete: element => table === 'BalanceTransaction'
        ? Promise.reject('Impossible to delete balanceTransaction from Stripe API')
        : stripe.customers['delete' + table](element.customer, element),
      list: async (params, search) => table === 'Discount'
        ? Promise.reject('Impossible to list discounts from Stripe API')
        : (await stripe.customers['list' + table + 's'](params.customer, buildParameter(table, search, false, params))).data,
      update: element => (table === 'TaxId' || table === 'Discount')
        ? Promise.reject(`Impossible to update ${table} from Stripe API`)
        : stripe.customers['update' + table](element),
      retrieve: (element, search) => table === 'Discount'
        ? Promise.reject('Impossible to retrieve discount from Stripe API')
        : stripe.customers['retrieve' + table](element.id, buildParameter(table, search, true))
    }
  }

  /** @type {(table: 'Capability' | 'ExternalAccount' | 'Person') => Helper} */
  function accountHelper (table) {
    return {
      create: element => stripe.accounts['create' + table](element.account, element),
      delete: element => stripe.accounts['delete' + table](element.account, element),
      list: async (params, search) => (table === 'Capability')
        ? (await stripe.accounts.listCapabilities(params.account, buildParameter(table, search, false, params))).data
        : (await stripe.accounts['list' + table + 's'](params.account, buildParameter(table, search, false, params))).data,
      update: element => stripe.accounts['update' + table](element.account, element),
      retrieve: (element, search) => stripe.accounts['retrieve' + table](element.account, element.id, buildParameter(table, search, true))
    }
  }

  /** @type {() => Helper} */
  function sessionHelper () {
    const table = 'Session'
    return {
      create: element => stripe.checkout.sessions.create(element),
      delete: () => Promise.reject(`Impossible to delete ${table} from Stripe API`),
      list: async (params, search) => (await stripe.checkout.sessions.list(buildParameter(table, search, false, params))).data,
      update: () => Promise.reject(`Impossible to update ${table} from Stripe API`),
      retrieve: element => stripe.checkout.sessions.retrieve(element.id)
    }
  }

  /** @type {(sourceTable: import('.').StripeTable, currentTable: AssociationTable, field: string) => Helper} */
  function associationHelper (sourceTable, currentTable, field) {
    return {
      // We should do nothing during this step, as it should have been done during a previous step
      create: async element => ({ id: 'empty', object: 'empty' }), // TODO check if this is enough or if we should use the parameter's id, and cache data to be able to create through originalHelper.create
      // We should do nothing during this step, as it should be done during a previous step
      delete: async () => {}, // TODO check if this is enough or if we should use the parameter's id, and cache data to be able to delete through originalHelper.delete
      list: async (params, search) => {
        const elements = await getTableHelper(sourceTable).retrieve({ id: params[sourceTable] }, [field])
        // Results can be just a list or an ApiList.
        const array = asList[sourceTable].includes(field) ? /** @type {import('stripe').Stripe.ApiList} **/(elements[field]).data : elements[field]
        const results = array.map(d => ({ id: params[sourceTable] + d.id, [sourceTable]: { id: params[sourceTable] }, [field]: { id: d.id } }))
        return results
      },
      // This step should normally never be called
      update: () => Promise.reject(`This 'update' in table ${currentTable} should normally never happen`),
      retrieve: async (element, search) => {
        const list = await associationHelper(sourceTable, currentTable, field).list(element, search)
        const result = list.find(d => d[sourceTable].id === element[sourceTable] && d[field].id === element[field])
        return result
      }
    }
  }

  function getTableHelper (table) {
    switch (table) {
      case 'Customer': return defaultHelper(table)
      case 'Product': return defaultHelper(table)
      case 'Plan': return defaultHelper(table)
      case 'Price': return undelatableHelper(table)
      case 'Subscription': return subscriptionHelper()
      case 'SubscriptionItem': return defaultHelper(table)
      case 'SubscriptionSchedule': return undelatableHelper(table)
      case 'Account': return defaultHelper(table)
      case 'Invoice': return defaultHelper(table)
      case 'TaxRate': return undelatableHelper(table)
      case 'TaxId': return customerHelper(table)
      case 'Discount': return customerHelper(table)
      case 'PaymentMethod': return undelatableHelper(table)
      case 'SetupIntent': return undelatableHelper(table)
      case 'PaymentIntent': return undelatableHelper(table)
      case 'Source': return { ...undelatableHelper(table), list: () => Promise.reject('Impossible to list Source from Stripe API') }
      case 'ExternalAccount': return accountHelper(table)
      case 'Coupon': return defaultHelper(table)
      case 'Session': return sessionHelper()
      case 'Charge': return undelatableHelper(table)
      case 'InvoiceItem': return defaultHelper(table)
      case 'PromotionCode': return undelatableHelper(table)
      case 'Mandate': return { ...unretrievableHelper(table), retrieve: element => stripe.mandates.retrieve(element.id) }
      case 'Review': return { ...unretrievableHelper(table), retrieve: element => stripe.reviews.retrieve(element.id), list: async (params, search) => (await stripe.reviews.list(buildParameter(table, search, false, params))).data }
      case 'BalanceTransaction': return customerHelper(table)
      // { ...unretrievableHelper('table'), retrieve: element => stripe.balanceTransactions.retrieve(element.id), list: params => stripe.balanceTransactions.list(params)}
      case 'Refund': return undelatableHelper(table)
      case 'Transfer': return undelatableHelper(table)
      case 'TransferReversal': return reversalHelper()
      // case 'LineItem': return this.stripe.invoices.
      // case 'SetupAttempt': return this.stripe.setupAttempts
      // case 'Item': return this.stripe.
      case 'account_tax_idsInvoice': return associationHelper('Invoice', table, 'account_tax_ids')
      case 'chargesPaymentIntent': return associationHelper('PaymentIntent', table, 'charges')
      case 'customer_tax_idsInvoice': return associationHelper('Invoice', table, 'customer_tax_rates')
      case 'default_tax_ratesInvoice': return associationHelper('Invoice', table, 'default_tax_rates')
      case 'default_tax_ratesSubscription': return associationHelper('Subscription', table, 'default_tax_rates')
      case 'discountsInvoice': return associationHelper('Invoice', table, 'discounts')
      case 'discountsInvoiceItem': return associationHelper('InvoiceItem', table, 'discounts')
      case 'external_accountsAccount': return associationHelper('Account', table, 'external_accounts')
      case 'itemsSubscription': return associationHelper('Subscription', table, 'items')
      case 'refundsCharge': return associationHelper('Invoice', table, 'default_tax_rates')
      case 'reversalsTransfer': return associationHelper('Transfer', table, 'reversals')
      case 'sourcesCustomer': return associationHelper('Customer', table, 'sources')
      case 'subscriptionsCustomer': return associationHelper('Customer', table, 'subscriptions')
      case 'tax_idsCustomer': return associationHelper('Customer', table, 'tax_ids')
      case 'tax_ratesInvoiceItem': return associationHelper('InvoiceItem', table, 'tax_rates')
      case 'tax_ratesSubscriptionItem': return associationHelper('SubscriptionItem', table, 'tax_rates')
    }
  }

  return getTableHelper
}

/** @type {Partial<import('./').StripeTables<string>>} Those are the tables that require a linked object to be able to retrieve their data */
const dependantTables = {
  TransferReversal: 'transfer',
  Discount: 'customer',
  BalanceTransaction: 'customer',
  Source: 'customer',
  TaxId: 'customer',
  ExternalAccount: 'account'
}

module.exports = {
  helperGetter,
  dependantTables
  // associationHelperGetter
}
