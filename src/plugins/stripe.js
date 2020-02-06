const { getOptionalDep, sequence, stringify } = require('../utils');
const check = require('../utils/type-checking');
const { stripe : stripeModel } = require('../utils/types');
const URL = require('url');
const https = require('https');

//Update the list of trustable ip everyday
let validIPs = [];
let updatingInterval = null;

const createStripePlugin = async config => {
  updateStripeIpList();
  if(!updatingInterval) updatingInterval = setInterval(updateStripeIpList, 1000*3600*24);
  check(stripeModel, config, plansTable, subscriptionsTable, customersTable, productsTable);
  const {app, secretKey, webhookURL, defaultCurrency, storePaymentMethods = false, /*VAT,*/
    plansTable = 'Plan', subscriptionsTable = 'Subscription', customersTable = 'Customer', productsTable = 'Product', paymentsTable = 'Payment',
    paymentMethodsTable = 'PaymentMethod', productName = 'name', amount = 'amount', decimal = false, currency = 'currency', interval = 'interval', intervalCount = 'intervalCount',
    trialPeriod = 'trialPeriod', product = 'product', customer = 'customer', subscriptionItems = 'items', paymentMethod='paymentMethod',
    expMonth = 'expMonth', expYear = 'expYear', cardNumber = 'card', cardCVC = 'cvc', iban = 'iban', idealBank = 'ideal', paymentType = 'paymentType',
    clientSecret = 'clientSecret', listeners = {},
  } = config;
  const stripe = getOptionalDep('stripe', 'StripePlugin')(secretKey);
  const bodyParser = require('body-parser');

  const url = new URL(webhookURL);
  const { secret } = await createWebhooks(stripe, url.hrf);
  // await createVAT(stripe, VAT);

  /** Convert database data into stripe model **/
  function convertToStripe(type, source) {
    const result = {id: source.reservedId};
    //prevent possible injection
    delete source[''];
    switch(type) {
      case 'plans': Object.assign(result, {
        currency: source[currency] || defaultCurrency,
        trial_period_days: source[trialPeriod],
        amount: decimal ? Math.floor((source[amount] || 0)*100) : source[amount],
        interval: source[interval],
        interval_count: source[intervalCount] || 1,
        product: source[product] && source[product].reservedId
      });
        break;
      case 'products': Object.assign(result, {
        name: source[productName]
      });
        break;
      case 'subscriptions': {
      //Count the quantity of each item
        const items = source[subscriptionItems].reduce((acc, item) => (acc[item.reservedId] = (acc[item.reservedId] || 0) + 1) && acc, {});
        //Convert the items into plans/quantity
        const plans = Object.keys(items).map(id => ({plan: id, quantity: items[id]}));
        Object.assign(result, {
          customer: source[customer] && source[customer].reservedId,
          items: plans,
          trial_from_plan: true,
        });
      }
        break;
      case 'customers':
        Object.assign(result, {
          paymentMethod: source[paymentMethod] && source[paymentMethod].reservedId,
        });
        break;
      case 'paymentIntents': 
        Object.assign(result, {
          payment_method_types: ['card', 'ideal', 'sepa_debit'],
          customer: source[customer] && source[customer].reservedId,
          paymentMethod: source[paymentMethod],
          amount: decimal ? Math.floor((source[amount] || 0)*100) : source[amount],
          currency: source[currency] || defaultCurrency,
        });
        break;
      case 'paymentMethods': {
        if(source[paymentType]==='card') result.card = { exp_month: source[expMonth], exp_year: source[expYear], number: source[cardNumber], cvc: source[cardCVC]};
        Object.assign(result, {
          type: source[paymentType] || 'card',
          ideal: source[idealBank] && { bank: source[idealBank] },
          sepa_debit: source[iban] && { iban: source[iban] }
        });
      }
        break;
      default: throw new Error(`Undefined object type: ${type} in Stripe Plugin.`);
    }
    Object.keys(result).map(key => {
      if(result[key]===undefined) delete result[key];
    });
    return result;
  }

  // Match the raw body to content type application/json
  app.post(url.pathname, bodyParser.raw({type: 'application/json'}), webhookListener(stripe, secret, listeners));

  return {
    preRequisite: async tables => {
      //All required tables must be defined
      const requiredTable = [plansTable, subscriptionsTable, customersTable, productsTable, paymentsTable].find(tableName => !tables[tableName]);
      if(requiredTable) return Promise.reject(`The table ${requiredTable} is missing whereas it is required for the Stripe Plugin. Check the documentation.`);
      //Plans must be linked to a product and the product cannot be null
      if(tables[plansTable][product]!==tables[productsTable]) return Promise.reject(`The table ${plansTable} must associate the field ${product} to table ${productsTable} for the Stripe Plugin. Check the documentation.`);
      if(!tables[plansTable][product].notNull && !tables[plansTable].notNull.includes(product)) return Promise.reject(`The table ${plansTable} must declare field ${product} to be not null for the Stripe Plugin.`);
      //Subscriptions must be linked to a list of plans
      if(tables[subscriptionsTable][subscriptionItems].length!==1 || tables[subscriptionsTable][subscriptionItems][0]!==tables[plansTable]) return Promise.reject(`The table ${subscriptionsTable} must associate ${subscriptionItems} to a list of ${plansTable} for Stripe Plugin. See the documentation.`);
      //Subscriptions must be linked to a customer and the customer cannot be null
      if(tables[subscriptionsTable][product]!==tables[customersTable]) return Promise.reject(`The table ${subscriptionsTable} must associate the field ${customer} to table ${customersTable} for the Stripe Plugin. Check the documentation.`);
      if(!tables[subscriptionsTable][customer].notNull && !tables[subscriptionsTable].notNull.includes(customer)) return Promise.reject(`The table ${subscriptionsTable} must declare field ${customer} to be not null for the Stripe Plugin.`);
      //PaymentIntents must be linked to a customer and a payment method
      function check(table, prop, type) {if(prop && (!tables[table][prop] || tables[table][prop].type!==type)) return Promise.reject(`The table ${table} must contain a field ${prop} of type ${type} (Stripe Plugin).`);}
      if(storePaymentMethods) {
        if(!tables[paymentMethodsTable]) return Promise.reject(`The table ${paymentMethodsTable} is missing whereas it is required for the Stripe Plugin. Check the documentation.`);
        //if paymentMethodsTable is defined, expMonth, expYear, cardNumber, cvc are integers
        await Promise.all([expMonth, expYear, cardNumber, cardCVC].map(prop => check(paymentMethodsTable, prop, 'integer')));
        //card, iban, idealBank, paymentType are string
        await Promise.all([cardNumber, iban, idealBank, paymentType].map(prop => check(paymentMethodsTable, prop, 'integer')));
        //Customers must be linked to payment mathods
        if(tables[customersTable][paymentMethod]!==tables[paymentMethodsTable]) return Promise.reject(`The table ${customersTable} must associate the field ${paymentMethod} to the table ${paymentMethodsTable} for the Stripe Plugin. Check the documentation.`);
      }
      //Product name, currency, payment are string, plans interval, plans trialPeriod and amount are integer
      await Promise.all([
        check(productsTable, productName, 'string'),
        check(plansTable, interval, 'integer'),
        check(plansTable, intervalCount, 'integer'),
        check(plansTable, trialPeriod, 'integer'),
        check(plansTable, amount, decimal ? 'decimal': 'integer'),
        check(paymentsTable, amount, decimal ? 'decimal': 'integer'),
      ]);
      //Ensure that required properties are provided
      await Promise.all(['productName', 'interval', 'amount'].map(key => config[key] || Promise.reject(`The property ${key} must be defined in the Stripe Plugin configuration.`)));
      //Ensure that the currency column exist or that a default currency has been selected
      if(!defaultCurrency && (!tables[plansTable][currency] || tables[plansTable][currency].type!=='string')) return Promise.reject(`You need to define a default currency or to create a ${currency} column of type 'string' for the table ${plansTable}.`);
    },
    onUpdate: {
      [productsTable]: async ({objects, newValues, oldValues}, { local }) => {
        if(newValues[productName]) {
          return updateStripe(objects.map(o => Object.assign({}, o, oldValues[o.reservedId])), newValues, 'products', local);
        }
      },
      [plansTable]: async ({objects, newValues, oldValues}, { local }) => {
        if(newValues[currency] || newValues[trialPeriod] || newValues[amount] || newValues[product]) {
          return updateStripe(objects.map(o => Object.assign({}, o, oldValues[o.reservedId])), newValues, 'plans', local);
        }
      },
      [subscriptionsTable]: async ({objects, newValues, oldValues}, { local }) => {
        if(newValues[customer]) {
          return updateStripe(objects.map(o => Object.assign({}, o, oldValues[o.reservedId])), newValues, 'subscriptions', local);
        }
      },
      [paymentsTable]: async ({objects, newValues, oldValues}, { local }) => {
        if(newValues[amount]) {
          return updateStripe(objects.map(o => Object.assign({}, o, oldValues[o.reservedId])), newValues, 'payments', local);
        }
      },
      [customersTable]: async ({objects, newValues, oldValues}, { local }) => {
        if(newValues[paymentMethod] && objects.length) {
          if(!local.stripePaymentMethod) local.stripePaymentMethod = [];
          return sequence(objects.map(o => async () => {
            const newPM = newValues[paymentMethod];
            const oldPM = oldValues[o.reservedId][paymentMethod];
            if(oldPM) await detachPM(oldPM.reservedId);
            if(newPM) await attachPM(newPM.reservedId, o.reservedId);
            local.stripePaymentMethod.push({customerId: o.reservedId, oldPM, newPM});
          }));
        }
      },
    },
    onListUpdate: {
      //TODO : handle changing subscriptions items list
      [subscriptionsTable]: async ({objects, added, removed}, { query, local }) => {
        if(added[subscriptionItems] || removed[subscriptionItems]) {
          const {[subscriptionsTable]: newValues } = await query({[subscriptionsTable]: { reservedId: objects.map(o => o.reservedId), get:[subscriptionItems] }});
          const oldValues = newValues.map(o => {
            //Add the removed items to reconstruct the old value of the object
            const items = [...o[subscriptionItems], ...(removed[subscriptionItems] || [])];
            //Removes the newly added items
            (added[subscriptionItems] || []).forEach(item => items.splice(items.findIndex(o => o.reservedId===item.reservedId), 1));
            return { reservedId: o.reservedId, [subscriptionItems]: items };
          });
          //The id didn't change
          newValues.forEach(o => delete o.reservedId);
          updateStripe(oldValues, newValues, 'subscriptions', local);
        }
      }
    },
    //TODO : replace payments by paymentIntents or charges
    onCreation: {
      [plansTable]: (createdObject, { local }) => {
        return findOrCreateStripe('plans', createdObject, local);
      },
      [subscriptionsTable]: async (createdObject, { local }) => {
        if(!createdObject[subscriptionItems] || !createdObject[subscriptionItems].length) return Promise.reject(`The subscription ${stringify(createdObject)} must contain a list of plans.`);
        return findOrCreateStripe('subscriptions', createdObject, local);
      },
      [productsTable]: async (createdObject, { local }) => {
        return findOrCreateStripe('products', createdObject, local);
      },
      [customersTable]: async (createdObject, { local }) => {
        return findOrCreateStripe('customers', createdObject, local);
      },
      [paymentsTable]: async (createdObject, { local }) => {
        //We need to provide the secret to th client
        const paymentIntent = await findOrCreate('paymentIntents', createdObject, local);
        createdObject[clientSecret] = paymentIntent.client_secret;
        if(!local.stripePaymentIntent) local.stripePaymentIntent = [];
        local.stripePaymentIntent.push(paymentIntent.id);
        return paymentIntent;
      },
    },
    onDeletion: {
      //TODO handle deletion of customers when linked with a subscription, of products linked to plans, and of plans linked to subscriptions
      [plansTable]: async (deletedObjects, { local }) => {
        return deleteStripe(deletedObjects, 'plans', local);
      },
      [subscriptionsTable]: async (deletedObjects, { local }) => {
        return deleteStripe(deletedObjects, 'subscriptions', local);
      },
      [productsTable]: async (deletedObjects, { local }) => {
        return deleteStripe(deletedObjects, 'products', local);
      },
      [customersTable]: async (deletedObjects, { local }) => {
        return deleteStripe(deletedObjects, 'customers', local);
      },
    },

    onError: async (results, { local }) => {
      if(local.stripeDeleted) await Promise.all(local.stripeDeleted.map(({ object, data }) => findOrCreate(stripe, object, data)));
      if(local.stripeCreated) await Promise.all(local.stripeCreated.map(({ object, id }) => deleteObject(stripe, object, id)));
      if(local.stripeUpdated) await Promise.all(local.stripeUpdated.map(({ object, id, data }) => updateObject(stripe, object, id, data)));
      if(local.stripePaymentMethod) await Promise.all(local.stripePaymentMethod.map(({ customerId, oldPM, newPM}) => {
        if(newPM) detachPM(newPM);
        if(oldPM) attachPM(oldPM.reservedId, customerId);
      }));
      if(local.stripePaymentIntent) await Promise.all(local.stripePaymentIntent.map(pi => cancelPI(pi)));
    }
  };

  async function findOrCreateStripe(object = 'object type', data = { reservedId: 'object id'}, local) {
    let stripeObject = await findObject(stripe, object, data.reservedId);
    if(!stripeObject) {
      stripeObject = await createObject(stripe, object, convertToStripe(object, data));
      if(!local.stripeCreated) local.stripeCreated = [];
      local.stripeCreated.push({object, id: data.reservedId});
    }
    return stripeObject;
  }

  function deleteStripe(deletedObjects = [], object = 'object type', local) {
    if(deletedObjects.length && !local.stripeDeleted) local.stripeDeleted = [];
    return sequence(deletedObjects.map(o => () => deleteObject(stripe, object, o.reservedId).then(() => local.stripeDeleted.push({object, data: o}))));
  }

  function updateStripe(updatedObjects = [], newValues, object = 'object type', local) {
    if(updatedObjects.length && !local.stripeUpdated) local.stripeUpdated = [];
    return sequence(updatedObjects.map(o => () =>
      updateObject(stripe, object, o.reservedId, convertToStripe(object, newValues))
        .then(() => local.stripeUpdated.push([{object, id: o.reservedId, data: o}]))
    ));
  }

  function attachPM(paymentMethodId, customerId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject('stripe attach timeout'), 60000);
      stripe.paymentMethods.attach(paymentMethodId, { customer: customerId }, (err, pm) => {
        clearTimeout(timeout);
        if(err) reject(err);
        resolve(pm);
      });
    });
  }
  function detachPM(paymentMethodId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject('stripe detach timeout'), 60000);
      stripe.paymentMethods.detach(paymentMethodId, (err, pm) => {
        clearTimeout(timeout);
        if(err) reject(err);
        resolve(pm);
      });
    });
  }
  function cancelPI(piId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject('stripe cancel payment timeout'), 60000);
      stripe.paymentIntents.cancel(piId, (err, pm) => {
        clearTimeout(timeout);
        if(err) reject(err);
        resolve(pm);
      });
    });
  }
};


function webhookListener(stripe, webhookSecret, callbacks) {
  return (request, response) => {
    if(!validIPs.includes(request.ip)) response.status(403).end();
    const sig = request.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(request.body, sig, webhookSecret);
    } catch (err) {
      response.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'customer.created':
      case 'customer.deleted':
      case 'customer.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted':
      case 'customer.source.expiring':
      case 'customer.subscription.trial_will_end':
      case 'customer.subscription.updated':
      case 'invoice.created':
      case 'invoice.deleted':
      case 'invoice.payment_action_required':
      case 'invoice.payment_failed':
      case 'invoice.payment_succeeded':
      case 'payment_intent.canceled':
      case 'payment_intent.created':
      case 'payment_intent.payment_failed':
      case 'payment_intent.succeeded':
      case 'payment_method.attached':
      case 'payment_method.card_automatically_updated':
      case 'payment_method.detached':
      case 'payment_method.updated':
      case 'plan.created':
      case 'plan.deleted':
      case 'plan.updated':
      case 'product.created':
      case 'product.deleted':
      case 'product.updated':
        {
          console.log(`We received ${event.type} webhook.`);
          const callback = callbacks[event.type];
          if(callback) callback(event);
        }
        break;
      default:
        // Unexpected event type
        return response.status(400).end();
    }

    // Return a 200 response to acknowledge receipt of the event
    response.json({received: true});
  };
}

// function createVAT(stripe, { country = 'country code', percentage = 0 } = {}) {
//   return findOrCreate(stripe, 'taxRates', { id: 'vat-'+country, jurisdiction: country, display_name: 'VAT', percentage, description: 'VAT '+country, inclusive: true });
// }

function createWebhooks(stripe, url) {
  return findOrCreate(stripe, 'webhookEndpoints', { url, id: 'simpleql', enabled_events: [ 'charge.failed', 'charge.succeeded' ]});
}

function deleteObject(stripe, object = 'products', id = 'id') {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject('stripe deletion timeout'), 60000);
    stripe[object].del(id, (err, confirm) => {
      clearTimeout(timeout);
      if(err) reject(err);
      resolve(confirm);
    });
  });
}

function updateObject(stripe, object = 'products', id = 'id', data = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject('stripe update timeout'), 60000);
    stripe[object].update(id, data, (err, updatedObject) => {
      clearTimeout(timeout);
      if(err) reject(err);
      resolve(updatedObject);
    });
  });
}

function findObject(stripe, object = 'products', id = 'id') {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject('stripe retrive timeout'), 60000);
    //Try to find the object in the existing values
    stripe[object].retrieve(id, (err, value) => {
      clearTimeout(timeout);
      if(err) reject(err);
      resolve(value);
    });
  });
}

function createObject(stripe, object = 'objects', data = { id: 'id'}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject('stripe creation timeout'), 60000);
    stripe[object].create(data, (err, result) => {
      clearTimeout(timeout);
      if(err) reject(err);
      resolve(result);
    });
  });
}

function findOrCreate(stripe, object = 'products', data = { id: '' }) {
  if(!data.id) return Promise.reject(`id was not provided when creating stripe object ${object} from data ${JSON.stringify(data)}.`);
  return findObject(stripe, object, data.id).then(result => result || createObject(stripe, object, data));
}

function updateStripeIpList() {
  const url = 'https://stripe.com/files/ips/ips_webhooks.json';
  https.get(url,(res) => {
    let body = '';

    res.on('data', (chunk) => {
      body += chunk;
    });

    res.on('end', () => {
      try {
        let json = JSON.parse(body);
        if(!json.WEBHOOKS) console.error('Wrong file format for Stripe Ips', body);
        validIPs = json.WEBHOOKS;
        console.log('Stripe IPs list updated');
        // do something with JSON
      } catch (error) {
        console.error('Error when retrieving Stripe IPs', error.message);
      }
    });

  }).on('error', (error) => {
    console.error('Error when retrieving Stripe IPs', error.message);
  });
}

module.exports = createStripePlugin;