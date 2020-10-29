// @ts-check

const { getOptionalDep, filterObject } = require('../utils')
const check = require('../utils/type-checking')
const { stripeCheckout: stripeModel } = require('../utils/types')
const URL = require('url').URL
const https = require('https')

/** @type {import('stripe').Stripe & { [object: string]: import('stripe').Stripe['customers'] }} */
let stripe

// Update the list of trustable ip everyday
let validIPs = []
let updatingInterval = null

/** Update Stripe Ip address to be sure the hooks are coming from there */
async function updateStripeIpList () {
  return new Promise((resolve, reject) => {
    const url = 'https://stripe.com/files/ips/ips_webhooks.json'
    https.get(url, (res) => {
      let body = ''

      res.on('data', (chunk) => {
        body += chunk
      })

      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          if (!json.WEBHOOKS) throw new Error(`Wrong file format for Stripe Ips: ${body}`)
          validIPs = json.WEBHOOKS
          console.log('Stripe IPs list updated')
          resolve()
          // do something with JSON
        } catch (error) {
          reject(`Error when retrieving Stripe IPs: ${error.message}`)
        }
      })
    }).on('error', (error) => {
      reject(`Error when retrieving Stripe IPs: ${error.message}`)
    })
  })
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
 * @typedef StripePluginConfig
 * @property {string} secretKey The Stripe secretKey
 * @property {string} customerTable The table where the users will be stored in the SimpleQL database
 * @property {string} customerStripeId The column where the Stripe customer id can be stored in the user table
 * @property {string=} subscriptionTable The table where the subscriptions will be stored in the SimpleQL database
 * @property {string=} subscriptionStripeId The column where the Stripe subscription id can be stored in the subscription table
 * @property {string=} subscriptionItemTable The table where the subscription items will be stored in the SimpleQL database
 * @property {string=} subscriptionItemStripeId The column where the Stripe subscriptionItem id can be stored in the subscriptionItem table
 * @property {string} webhookURL The URL were the Stripe webhooks should be sent
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
    secretKey, customerTable = 'User', customerStripeId = 'stripeId', webhookURL = 'stripe-webhooks', listeners = {},
    subscriptionTable = 'Subscription', subscriptionStripeId = 'stripeId',
    subscriptionItemTable = 'SubscriptionItem', subscriptionItemStripeId = 'stripeId'
  } = config
  stripe = getOptionalDep('stripe', 'StripePlugin')(secretKey)
  const bodyParser = require('body-parser')

  const url = new URL(webhookURL)

  // TODO : use only the hooks from the listeners list, and update the webhookEndpoint
  const { data } = await stripe.webhookEndpoints.list()
  const existingEndpoint = process.env.WH_SECRET ? { secret: process.env.WH_SECRET } : data.find(endpoint => endpoint.url === webhookURL)
  const { secret } = existingEndpoint || await stripe.webhookEndpoints.create({ url: webhookURL, enabled_events: ['*'] })
  // Match the raw body to content type application/json
  app.post(url.pathname, bodyParser.raw({ type: 'application/json' }), webhookListener(secret, listeners))

  return {
    onRequest: {
      [customerTable]: async (request) => {
        // We want to retrieve the customerStripId on every request
        if (request.get && request.get !== '*' && !request[customerStripeId] && !request.get.includes(customerStripeId)) request.get.push(customerStripeId)
      },
      [subscriptionTable]: async (request) => {
        // We want to retrieve the customerStripId on every request
        if (request.get && request.get !== '*' && !request[subscriptionStripeId] && !request.get.includes(subscriptionStripeId)) request.get.push(subscriptionStripeId)
      },
      [subscriptionItemTable]: async (request) => {
        // We want to retrieve the customerStripId on every request
        if (request.get && request.get !== '*' && !request[subscriptionItemStripeId] && !request.get.includes(subscriptionItemStripeId)) request.get.push(subscriptionItemStripeId)
      }
    },
    onCreation: {
      [customerTable]: async (created, { local }) => {
        if (!local.stripeCreated) local.stripeCreated = []
        local.stripeCreated.push(created)
      }
    },
    onDeletion: {
      [customerTable]: async (deleted, { local }) => {
        await stripe.customers.del(deleted[customerStripeId])
        if (!local.stripeDeleted) local.stripeDeleted = []
        local.stripeDeleted.push(deleted)
      }
    },
    onResult: {
      [customerTable]: async (results, { request }) => {
        if (!Array.isArray(request.get)) return
        return Promise.all(results.map(result => {
          const stripeId = result[customerStripeId];
          if (!stripeId) return Promise.resolve();
          const customer = stripe.customers.retrieve(stripeId, { expand: ['subscriptions'] });
          if (Array.isArray(request.get)) Object.assign(result, filterObject(customer, request.get));
        })).then(() => { });
      },
      [subscriptionTable]: async (results, { request }) => {
        if (!Array.isArray(request.get)) return
        return Promise.all(results.map(result => {
          const stripeId = result[subscriptionStripeId]
          if (!stripeId) return Promise.resolve()
          const subscription = stripe.subscription.retrieve(stripeId)
          if (Array.isArray(request.get)) Object.assign(result, filterObject(subscription, request.get));
        })).then(() => {})
      },
      [subscriptionItemTable]: async (results, { request }) => {
        if (!Array.isArray(request.get)) return
        return Promise.all(results.map(result => {
          const stripeId = result[subscriptionItemStripeId]
          if (!stripeId) return Promise.resolve()
          const subscriptionItem = stripe.customers.retrieve(stripeId)
          if (Array.isArray(request.get)) Object.assign(result, filterObject(subscriptionItem, request.get));
        })).then(() => {})
      }
    },
    onSuccess: async (_results, { local, query }) => {
      if (local.stripeCreated) {
        await Promise.all(local.stripeCreated.map(async created => {
        // Create the user in Stripe database and update the local database
          const customerKeys = ['email', 'phone', 'address', 'name', 'description', 'metadata']
          const stripeCustomer = filterObject(created, customerKeys)
          const { id: stripeId } = await stripe.customers.create(stripeCustomer)
          await query({ [customerTable]: { reservedId: created.reservedId, set: { stripeId } } }, { admin: true })
          stripe.customers.create(created[customerStripeId])
        }))
      }
      // Delete the user in Stripe database
      if (local.stripeDeleted) await Promise.all(local.stripeDeleted.map(deleted => stripe.customers.del(deleted[customerStripeId])))
    }
  }
}

/**
 * Ensure that the config is correct
 * @param {StripePluginConfig} config The Stripe Plugin config
 * @throws Throws an error if the config is wrong
 */
function checkPluginConfig (config) {
  check(stripeModel, config)
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
    if (!validIPs.includes(request.ip)) return response.status(403).end()
    const sig = request.headers['stripe-signature']
    let event

    try {
      event = stripe.webhooks.constructEvent(request.body, sig, webhookSecret)
    } catch (err) {
      return response.status(400).send(`Webhook Error: ${err.message}`)
    }

    // Handle the event
    if (stripeEvents.includes(event.type)) {
      console.log(`We received ${event.type} webhook.`)
      const callback = callbacks[event.type]
      if (callback) callback(event)
      // Return a 200 response to acknowledge receipt of the event
      response.json({ received: true })
    } else {
      return response.status(400).end()
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
