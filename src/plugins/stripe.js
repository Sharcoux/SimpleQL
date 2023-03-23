// @ts-check

const { getOptionalDep, filterObject } = require('../utils')
const check = require('../utils/type-checking')
const { stripe: stripeModel } = require('../utils/types')
const URL = require('url').URL
const https = require('https')
const createRequestHandler = require('../requestHandler')
const log = require('../utils/logger')
const plugin = require('../drivers/stripe/plugin')
const { getQuery, dbQuery } = require('../utils/query')

/** @type {Promise<import('../utils').Result>} */
let stripeQueryStack = Promise.resolve({})

/** @type {import('stripe').Stripe & { [object: string]: import('stripe').Stripe['customers'] }} */
let stripe

// Update the list of trustable ip everyday
let validIPs = [
  '3.18.12.63',
  '3.130.192.231',
  '13.235.14.237',
  '13.235.122.149',
  '18.211.135.69',
  '35.154.171.200',
  '52.15.183.38',
  '54.88.130.119',
  '54.88.130.237',
  '54.187.174.169',
  '54.187.205.235',
  '54.187.216.72',
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1'
]
let updatingInterval = null

/**
 * Update Stripe Ip address to be sure the hooks are coming from there
 * @returns {Promise<String[] | null>}
 **/
async function updateStripeIpList () {
  return new Promise((resolve, reject) => {
    const url = 'https://stripe.com/files/ips/ips_webhooks.json'
    https.get(url, (res) => {
      let body = ''

      res.on('data', (chunk) => {
        body += chunk
      })

      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) throw new Error(res.statusMessage + '\n' + body)
        try {
          const json = JSON.parse(body)
          if (!json.WEBHOOKS) throw new Error(`Wrong file format for Stripe Ips: ${body}`)
          validIPs = [...json.WEBHOOKS, '127.0.0.1', '::1', '::ffff:127.0.0.1']
          log('info', 'Stripe IPs list updated')
          resolve(validIPs)
          // do something with JSON
        } catch (error) {
          reject(`Error when retrieving Stripe IPs: ${error.message}`)
        }
      })
    }).on('error', (error) => {
      reject(`Error when retrieving Stripe IPs: ${error.message}`)
    })
  }).catch(console.error)
}

/**
 * @typedef {Object} StripeObject
 * @property {string} id The event id
 * @property {string} object The object type
 * @property {number} created The creation date of this event
 * @property {boolean} livemode true for live mode, false for test mode
 * @property {Object} metadata Client data
 * @property {string} description Optional object description
 * @property {number} updated Date of last update of the object
 */

/**
 * @callback StripeListener
 * @param {import('stripe').Stripe.Event} event The stripe event from the webhook
 * @returns {Promise<void>}
 */

/**
 * @typedef {Object} StripeCustomerAddress
 * @property {string=} city
 * @property {string=} country
 * @property {string=} line1
 * @property {string=} line2
 * @property {string=} state
 * @property {string=} postal_code
 */

/**
 * @typedef {Object} StripeCustomer
 * @property {string=} email
 * @property {string=} name
 * @property {string=} description
 * @property {StripeCustomerAddress=} address
 * @property {string=} phone
 * @property {Object.<string, string>=} metadata
 */

/**
 * @callback ElementParser
 * @param {import('../utils').Element} element The database element
 * @returns {StripeCustomer}
 */

/**
 * @typedef {Object} StripePluginConfig
 * @property {string} adminKey The id of admin user (this is the privateKey provided to the database. See [Database](../../docs/database.md))
 * @property {string} secretKey The Stripe secretKey
 * @property {string} customerTable The table where the users will be stored in the SimpleQL database
 * @property {ElementParser} toStripeFormat A function responsible to format a database Element to the stripe Customer format
 * @property {string} webhookURL The URL were the Stripe webhooks should be sent
 * @property {string=} proxyWebhookPath If using a proxy, the path the express app should actually be listening too
 * @property {string=} webhookSecret The secret key provided by stripe for [testing webhooks locally](https://stripe.com/docs/webhooks/test)
 * @property {string} database The name of the local database
 * @property {Object.<string, StripeListener>=} listeners The listeners to Stripe webhooks
 */

/**
 * Create the Stripe Plugin
 * @param {import('express').Express} app The express app
 * @param {StripePluginConfig} config The Stripe Plugin config
 * @returns {Promise<import('.').Plugin>} The Stripe Plugin
 */
async function createStripePlugin (app, config) {
  await updateStripeIpList()
  if (!updatingInterval) updatingInterval = setInterval(updateStripeIpList, 1000 * 3600 * 24)
  checkPluginConfig(config)

  const {
    secretKey, customerTable = 'User', webhookURL = 'stripe-webhooks', listeners = {},
    database, webhookSecret, adminKey, proxyWebhookPath, toStripeFormat = data => ({ email: data.email })
  } = config
  stripe = getOptionalDep('stripe', 'StripePlugin')(secretKey)

  // Listen to Stripe webhooks
  const bodyParser = require('body-parser')
  // TODO : use only the hooks from the listeners list, and update the webhookEndpoint
  /** @type {import('stripe').Stripe.WebhookEndpoint} */
  let endpoint = /** @type {any} **/({})
  if (!webhookSecret) {
    // If an endpoint already exists, we need to delete it (otherwise we can't retrieve the webhook secret)
    const { data } = await stripe.webhookEndpoints.list()
    endpoint = data.find(endpoint => endpoint.url === webhookURL)
    if (endpoint) await stripe.webhookEndpoints.del(endpoint.id)
    // We now create the webhook
    try {
      endpoint = await stripe.webhookEndpoints.create({ url: webhookURL, enabled_events: ['*'] })
    } catch (error) {
      if (error.message && error.message.startsWith('Invalid URL')) {
        log('error', `To use Stripe webhooks locally, you need to do:
        - npm i -D @sharcoux/stripe-cli
        - npx stripe listen --forward-to ${webhookURL}
        - copy the provided webhook secret key into stripe plugins's config: 'config.webhookSecret'.`)
        log('warning', 'The script will continue without the webhooks')
        endpoint = /** @type {any} **/({})
      } else {
        return Promise.reject(error)
      }
    }
  }
  // Match the raw body to content type application/json
  app.post(proxyWebhookPath || new URL(webhookURL).pathname, bodyParser.raw({ type: 'application/json' }), webhookListener(webhookSecret || endpoint.secret, listeners))

  // Create the plugin
  const { tables, tablesModel } = require('../drivers/stripe/tables')
  const rules = require('../drivers/stripe/rules')
  const driver = require('../drivers/stripe')({ password: secretKey })
  const stripeRequestHandler = createRequestHandler({ tables, rules, tablesModel, plugins: [plugin], driver, privateKey: adminKey })
  /** @type {Promise<import('..').Query>} */
  dbQuery.stripe = Promise.resolve((req, params = { authId: adminKey, readOnly: false }) => (stripeQueryStack = stripeQueryStack.catch(() => {}).then(() => stripeRequestHandler(req, params))))
  let normalTableNames = []
  const stripeTableNames = Object.keys(tables)
  return {
    preRequisite: (tables) => {
      normalTableNames = Object.keys(tables)
      const duplicateTable = normalTableNames.find(name => stripeTableNames.includes(name))
      if (duplicateTable) return Promise.reject(`Table ${duplicateTable} is a Stripe table. You must rename it to prevent conflicts.`)
      if (!tables[customerTable]) return Promise.reject(`To use the Stripe plugin, you need a table for your users. You provided ${customerTable} in the config, but there is no such table.`)
      const customerStripeId = /** @type {import('../utils').Column} */(tables[customerTable].stripeId)
      if (!customerStripeId) return Promise.reject(`To use the Stripe plugin, you need a column to store the stripeId of your customers in your table ${customerTable}. The column 'stripeId' needs to be defined in your table ${customerTable}.`)
      if (customerStripeId.type !== 'string') return Promise.reject(`To use the Stripe plugin, you need a column 'stripeId' of type string in ${customerTable}, but it is of type ${customerStripeId.type}.`)
      if (customerStripeId.length < 40) return Promise.reject(`To use the Stripe plugin, you need a column 'stripeId' of length at least 40, but you specified ${customerStripeId.length}.`)
    },
    middleware: async (req, res, next) => {
      // We need to split the part of the request relative to Stripe from the rest
      const request = req.body
      const stripeRequest = filterObject(request, stripeTableNames)
      const normalRequest = filterObject(request, normalTableNames)
      const authId = res.locals.authId
      const isAdmin = authId === adminKey
      let stripeId = ''
      // We need to convert the User id into Customer id
      if (authId && Object.keys(stripeRequest).length && !isAdmin) {
        const query = await getQuery(database)
        const results = await query({ [customerTable]: { reservedId: authId, get: ['stripeId'] } }, { authId: adminKey, readOnly: true })
        const customer = results[customerTable][0]
        stripeId = customer && customer.stripeId
      }
      // We handle the normal part with the default behaviour
      req.body = normalRequest
      // We handle the stripe part with our stripe request handler
      // We need to ensure that the previous request ends before the next one can go on
      res.locals.results = await dbQuery.stripe.then(query => query(stripeRequest, { authId: isAdmin ? secretKey : stripeId, readOnly: false }))
      next()
    },
    onCreation: {
      [customerTable]: async (created, { local, query }) => {
        // Try to read the user from Stripe if it already exists
        const { data } = await stripe.customers.list({ email: created.email })
        if (data.length) await query({ [customerTable]: { reservedId: created.reservedId, set: { stripeId: data[0].id } } }, { admin: true })
        // Create the user otherwise
        else {
          if (!local.stripeCreated) local.stripeCreated = []
          local.stripeCreated.push(created)
        }
      }
    },
    onUpdate: {
      [customerTable]: async ({ objects, newValues }, { local }) => {
        local.stripeUpdated = objects.map(object => {
          // filter the updated fields with the customerKeys
          const toUpdate = toStripeFormat(newValues)
          return { object, toUpdate }
        })
      }
    },
    onDeletion: {
      [customerTable]: async (deleted, { local }) => {
        if (!local.stripeDeleted) local.stripeDeleted = []
        const unreadable = deleted.find(user => !user.stripeId)
        if (unreadable) {
          return Promise.reject(new Error(`The stripeId of user ${local.authId} needs to be readable for user ${unreadable.reservedId} for the stripe plugin to work correctly. Edit the ${customerTable} rules for 'stripeId' column.`))
        }
        local.stripeDeleted.push(...deleted)
      }
    },
    onSuccess: async (results, { local, query }) => {
      if (local.stripeCreated) {
        await Promise.all(local.stripeCreated.map(async created => {
        // Create the user in Stripe database and update the local database
          const stripeCustomer = toStripeFormat(created)
          // TODO : Check if a user already exists in stripe with this email?
          const { id: stripeId } = await stripe.customers.create(stripeCustomer)
          await query({ [customerTable]: { reservedId: created.reservedId, set: { stripeId } } }, { admin: true, readOnly: false })
        }))
      }
      // Delete the user in Stripe database
      if (local.stripeDeleted) await Promise.all(local.stripeDeleted.map(deleted => stripe.customers.del(deleted.stripeId)))
      // reset variables
      delete local.stripeDeleted
      delete local.stripeCreated
      // Add the request results to the results
      Object.assign(results, local.results || {})

      if (local.stripeUpdated) {
        // updates the stripe customer according with the changes on local customer
        local.stripeUpdated.forEach(async ({ object, toUpdate }) => {
          if (Object.keys(toUpdate).length > 0) {
            const { [customerTable]: [customer] } = await query({ [customerTable]: { reservedId: object.reservedId, get: ['stripeId'] } }, { admin: true, readOnly: true })
            customer && customer.stripeId && await stripe.customers.update(customer.stripeId, toUpdate)
          }
        })
      }
    }
  }
}

/**
 * Ensure that the config is correct
 * @param {StripePluginConfig} config The Stripe Plugin config
 * @throws Throws an error if the config is wrong
 */
function checkPluginConfig (config) {
  check(stripeModel, config, 'StripePluginConfig for Stripe Plugin')
  if (config.listeners) {
    const listeners = config.listeners
    const unknownHook = Object.keys(listeners).find(key => !stripeEvents.includes(key))
    if (unknownHook) throw new Error(`${unknownHook} is not a known Stripe hook in 'listeners' props of StripePlugin config`)
    const notAFunction = Object.keys(listeners).find(key => typeof listeners[key] !== 'function')
    if (notAFunction) throw new Error(`${listeners[notAFunction]} is not a function for webhook ${notAFunction} in 'listeners' of StripePlugin`)
  }
}

/**
 * Setup webhooks for Stripe
 * @param {string} webhookSecret The webhook secret received when creating the webhook
 * @param {Object.<string, StripeListener>=} callbacks The listeners for each webhook
 */
function webhookListener (webhookSecret, callbacks) {
  return async (request, response) => {
    if (!validIPs.includes(request.ip)) return response.status(403).end(`The ip address ${request.ip} is not a recognized IP from Stripe.`)
    const sig = request.headers['stripe-signature']
    let event

    try {
      event = stripe.webhooks.constructEvent(request.body, sig, webhookSecret)
    } catch (err) {
      return response.status(400).send(`Webhook Error: ${err.message}`)
    }

    // Handle the event
    if (stripeEvents.includes(event.type)) {
      log('info', `We received ${event.type} webhook.`)
      const callback = callbacks[event.type]
      if (callback) callback(event)
      // Return a 200 response to acknowledge receipt of the event
      response.json({ received: true })
    } else {
      return response.status(400).end(`The webhook ${event.type} is not a recognized Stripe webhook.`)
    }
  }
}

module.exports = createStripePlugin

const stripeEvents = [
  'account.updated',
  'account.application.authorized',
  'account.application.deauthorized',
  'account.external_account.created',
  'account.external_account.deleted',
  'account.external_account.updated',
  'application_fee.created',
  'application_fee.refunded',
  'application_fee.refund.updated',
  'balance.available',
  'billing_portal.session.created',
  'capability.updated',
  'charge.captured',
  'charge.expired',
  'charge.failed',
  'charge.pending',
  'charge.refunded',
  'charge.succeeded',
  'charge.updated',
  'charge.dispute.closed',
  'charge.dispute.created',
  'charge.dispute.funds_reinstated',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.updated',
  'charge.refund.updated',
  'checkout.session.async_payment_failed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.completed',
  'checkout.session.expired',
  'coupon.created',
  'coupon.deleted',
  'coupon.updated',
  'credit_note.created',
  'credit_note.updated',
  'credit_note.voided',
  'customer.created',
  'customer.deleted',
  'customer.updated',
  'customer.discount.created',
  'customer.discount.deleted',
  'customer.discount.updated',
  'customer.source.created',
  'customer.source.deleted',
  'customer.source.expiring',
  'customer.source.updated',
  'customer.subscription.created',
  'customer.subscription.deleted',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'customer.subscription.trial_will_end',
  'customer.subscription.updated',
  'customer.tax_id.created',
  'customer.tax_id.deleted',
  'customer.tax_id.updated',
  'file.created',
  'invoice.created',
  'invoice.deleted',
  'invoice.finalized',
  'invoice.marked_uncollectible',
  'invoice.paid',
  'invoice.payment_action_required',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'invoice.sent',
  'invoice.upcoming',
  'invoice.updated',
  'invoice.voided',
  'invoiceitem.created',
  'invoiceitem.deleted',
  'invoiceitem.updated',
  'issuing_authorization.created',
  'issuing_authorization.request',
  'issuing_authorization.updated',
  'issuing_card.created',
  'issuing_card.updated',
  'issuing_cardholder.created',
  'issuing_cardholder.updated',
  'issuing_dispute.closed',
  'issuing_dispute.created',
  'issuing_dispute.funds_reinstated',
  'issuing_dispute.submitted',
  'issuing_dispute.updated',
  'issuing_transaction.created',
  'issuing_transaction.updated',
  'mandate.updated',
  'order.created',
  'order.payment_failed',
  'order.payment_succeeded',
  'order.updated',
  'order_return.created',
  'payment_intent.amount_capturable_updated',
  'payment_intent.canceled',
  'payment_intent.created',
  'payment_intent.payment_failed',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.succeeded',
  'payment_method.attached',
  'payment_method.automatically_updated',
  'payment_method.detached',
  'payment_method.updated',
  'payout.canceled',
  'payout.created',
  'payout.failed',
  'payout.paid',
  'payout.updated',
  'person.created',
  'person.deleted',
  'person.updated',
  'plan.created',
  'plan.deleted',
  'plan.updated',
  'price.created',
  'price.deleted',
  'price.updated',
  'product.created',
  'product.deleted',
  'product.updated',
  'promotion_code.created',
  'promotion_code.updated',
  'radar.early_fraud_warning.created',
  'radar.early_fraud_warning.updated',
  'recipient.created',
  'recipient.deleted',
  'recipient.updated',
  'reporting.report_run.failed',
  'reporting.report_run.succeeded',
  'reporting.report_type.updated',
  'review.closed',
  'review.opened',
  'setup_intent.canceled',
  'setup_intent.created',
  'setup_intent.requires_action',
  'setup_intent.setup_failed',
  'setup_intent.succeeded',
  'sigma.scheduled_query_run.created',
  'sku.created',
  'sku.deleted',
  'sku.updated',
  'source.canceled',
  'source.chargeable',
  'source.failed',
  'source.mandate_notification',
  'source.refund_attributes_required',
  'source.transaction.created',
  'source.transaction.updated',
  'subscription_schedule.aborted',
  'subscription_schedule.canceled',
  'subscription_schedule.completed',
  'subscription_schedule.created',
  'subscription_schedule.expiring',
  'subscription_schedule.released',
  'subscription_schedule.updated',
  'tax_rate.created',
  'tax_rate.updated',
  'topup.canceled',
  'topup.created',
  'topup.failed',
  'topup.reversed',
  'topup.succeeded',
  'transfer.created',
  'transfer.failed',
  'transfer.paid',
  'transfer.reversed',
  'transfer.updated'
]
