Product : the products you sell (name, active, type) https://stripe.com/docs/api/products/object

Plans : the price, currency and interval a customer can subscribe to (amount_decimal, currency, interval, product) https://stripe.com/docs/api/plans

Subscriptions: links a customer to a plan. (customer, items, trial_period_days) https://stripe.com/docs/api/subscriptions

items: (plan, quantity)

customers: (id, name, email, currency) https://stripe.com/docs/api/customers


  const {app, secretKey, webhookURL, VAT, defaultCurrency
    plansTable = 'Plans', subscriptionsTable = 'Subscriptions', customersTable = 'Customers', productsTable = 'Products', paymentsTable = 'Payments',
    paymentMethodsTable = '', productName = 'name', amount = '', amountDecimal = '', currency = 'currency', interval = 'interval', intervalCount = 'intervalCount'
    trialPeriod = '', product = 'product', customer = 'customer', subscriptionItems = 'items', paymentMethod='paymentMethod',
    expMonth = 'expMonth', expYear = 'expYear', cardNumber = 'number', cardCVC = 'cvc', iban = '', idealBank = '', paymentType = '',
    clientSecret = 'clientSecret'
  } = config;

## General configuration

To use the plugin, you will need to provide the following informations:

 * **app**: The Express application
 * **secretKey**: You Stripe secret API key
 * **webhookURL**: The full url Stripe should use for webhooks. The app will be set to listen to this path. You don't have to do it.
 * **defaultCurrency** (*optionnal*): You can provide an [ISO 4217 currency code](https://www.iso.org/iso-4217-currency-codes.html) that will be used by default for all transactions
 * **decimal** (*optionnal*): If set to `true`, store the amount in decimal instead of integer as cents. Defaults to **false**.
 * **storePaymentMethods** (*optionnal*): If set to `true`, it means that you wish to save the payment methods information directly on your own database. This will require you to validate [PCI compliance](https://stripe.com/docs/security#validating-pci-compliance) Defaults to **false**.

## Tables

To use this plugin, you need the following tables:

 * **Products** : Details about the [products](https://stripe.com/docs/api/products) you are selling
 * **Plans** : A table that will contains the [plans](https://stripe.com/docs/api/plans) for subscriptions
 * **Subscriptions** : A table containing details about [subscriptions](https://stripe.com/docs/api/subscriptions) of a customer, and the plans they subscribed to.
 * **Customers** : Details about your [customers](https://stripe.com/docs/api/customers).
 * **Payments** : Details about the [payments](https://stripe.com/docs/api/payments_intent) in progress.
 * **PaymentMethods** (*optional*) : If `storePaymentMethods` is set to `true`, this table will store the [payments methods](https://stripe.com/docs/api/payment_methods) of your customers, but this will requires you to validate [PCI compliance](https://stripe.com/docs/security#validating-pci-compliance).

To change the name of the tables, use the following config properties:

```javascript
  stripePlugin({
    app, secretKey, webhookURL,//Required properties

    productsTable: '<Your table name>',
    plansTable: '<Your table name>',
    subscriptionsTable: '<Your table name>',
    customersTable: '<Your table name>',
    paymentsTable: '<Your table name>',
    paymentMethodsTable: '<Your table name>',
  });
```

### Products

For Stripe to work, the products just need to be identified by a name. Your table must contain a column `name` of type string. To change the name of that column, you can edit the property `productName` of the plugin:

```javascript
  stripePlugin({
    app, secretKey, webhookURL,//Required properties

    productName: '<Your column name>',
  });
```

### Plans

The plans describe the prices and modality for subscribing to your products. The table needs the following columns that you can edit:

 * **product**: The product this plans is selling. You should link here your Plans table.
 * **amount**: The cost of your product in cents (*or in decimal if decimal is set to `true`*).
 * **interval**: The period type for billing (`day`, `week`, `month` or `year`),
 * **intervalCount** (*optional*): The number of interval between each billing (6 with interval='month' will make a billing every semester).
 * **currency** (*optional*): The [ISO 4217 currency codes](https://www.iso.org/iso-4217-currency-codes.html). You can omit this column if you provide a default currency through the `defaultCurrency` property.
 * **trialPeriod** (*optional*): The number of days your product will be free of charge. This must be an integer

You can edit the column names with the following properties:

```javascript
  stripePlugin({
    app, secretKey, webhookURL,//Required properties

    product: '<Your column name>',
    amount: '<Your column name>',
    interval: '<Your column name>',
    intervalCount: '<Your column name>',
    currency: '<Your column name>',
    trialPeriod: '<Your column name>',
  });
```

### Subscriptions

A subscriptions links a set of plans to a customer. The customer will be billed on the payment method it is linked to. The Subscription table needs the following columns:

 * **customer**: The customer that the subscription is linked to. It should be the Customers table.
 * **items**: The list of plans this subscriptions subscribes to. It should be set as a list of Plans.

You can edit the column names with the following properties:

```javascript
  stripePlugin({
    app, secretKey, webhookURL,//Required properties

    customer: '<Your column name>',
    subscriptionItems: '<Your column name>',
  });
```

### Payments

A payment consist of an immediate checkout from a customer. You can provide the following columns:

 * **customer**: The customer to be charged. It should be linked to the Customer table.
 * **amount**: The amount to charge the customer in cents. If `decimal` is set to true, the `amount` column type must be `decimal`
 * **paymentMethod** (*optional*): The payment method selected by the customer. It is required only if `storePaymentMethods`is set to `true`.
 * **currency** (*optional*): The currency to be used for the payment. If you provided a `defaultCurrency`, this is not required.

You can edit the column names with the following properties:

```javascript
  stripePlugin({
    app, secretKey, webhookURL,//Required properties

    customer: '<Your column name>',
    amount: '<Your column name>',
    paymentMethod: '<Your column name>',
    currency: '<Your column name>',
  });
```

### PaymentMethods

In the payment method table, you can store the payment data of your customers. You can provide the following columns:

 * **paymentType** (*optionnal*): The paiment type. Should be one of 'card', 'ideal' or 'sepa_debit'. Will default to 'card'
 * **ideal** (*optionnal*): The ideal bank identifier. Required only if you want to support ideal payments.
 * **iban** (*optionnal*): the IBAN to charge for SEPA debits.
 * **expMonth**: (*optionnal*): The expiration month of the card, as an integer. Required only if you want to support card payments.
 * **expYear**: (*optionnal*): The expiration year of the card, as an integer. Required only if you want to support card payments.
 * **number**: (*optionnal*): The card number, as a string. Required only if you want to support card payments.
 * **cvc**: (*optionnal*): The card CVC, as an integer. Required only if you want to support card payments.

You can edit the column names with the following properties:

```javascript
  stripePlugin({
    app, secretKey, webhookURL,//Required properties

    paymentType: '<Your column name>',
    idealBank: '<Your column name>',
    iban: '<Your column name>',
    expMonth: '<Your column name>',
    expYear: '<Your column name>',
    cardNumber: '<Your column name>',
    cardCVC: '<Your column name>',
  });
```
