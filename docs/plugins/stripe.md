# Stripe Plugin

## General configuration

To use the plugin, you will need to provide the following parameters:

 * **app**: The Express application
 * **config**: The Stripe Plugin configuration.

 The `config` parameter is an object with the following properties:

 * **secretKey**: You Stripe secret API key
 * **customerTable**: The table where the users will be stored in the SimpleQL database
 * **customerStripeId**: The column where the Stripe customer id can be stored in the user table
 * **database**: The name of the SimpleQL database
 * **webhookURL**: The full url Stripe should use for webhooks. The app will be set to listen to this path. You don't have to do it.
 * **webhookSecret** (*optional*): The secret key provided by stripe for [testing webhooks locally](https://stripe.com/docs/webhooks/test) 
 * **listeners** (*optional*): An object mapping the stripe webhooks to their listeners

When **creating** or **deleting** a user with SimpleQL, the user will automatically be created/deleted on the **Stripe** database, and the `customerStripeId` will be added in the user table.

## Local webhooks tests

To test webhooks locally, you need to:

* run `npm run stripe-login`
* run `npm run local-webhooks`
* run `export WH_SECRET=<your secret>`

You can now run your webhooks

## Tables

This plugin will make you able to use the tables from Stripe database as if they were SimpleQL tables. Here are a few of them:

 * **Product** : Details about the [products](https://stripe.com/docs/api/products) you are selling
 * **Plan** : A table that will contains the [plans](https://stripe.com/docs/api/plans) for subscriptions
 * **Subscription** : A table containing details about [subscriptions](https://stripe.com/docs/api/subscriptions) of a customer, and the plans they subscribed to.
 * **Customer** : Details about your [customers](https://stripe.com/docs/api/customers).
 * **PaymentIntent** : Details about the [payments](https://stripe.com/docs/api/payments_intent) in progress.

## Event listeners

To react to Stripe [events](https://stripe.com/docs/api/events) through webhooks, you will need to pass the callbacks to the Stripe Plugin this way:

```javascript
  stripePlugin({
    app, secretKey, webhookURL,//Required properties

    listeners: {
      "customer.created": event => console.log(`customer ${data.data.object.id} was created`),
    }
  });
```

Check the full [list](https://stripe.com/docs/api/events/types) of Stripe events.

## Query the Stripe database within tables from another database

To make cross database queries, you always need to use the `getQuery` function.

Here is how you would make a request to the Stripe database from your main database treatment:

```javascript
const { getQuery } = require('simpleql')

const plugin = {
  onResult: {
    User: (results) => {
      getQuery('stripe').then(query => query({ Customer: { email: results.map(result => result.email)}, get: '*'}))
    }
  }
}
```