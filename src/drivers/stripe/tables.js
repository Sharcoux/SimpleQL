// @ts-check
const { prepareTables } = require('../../prepare')
const { modelFactory } = require('../../utils')

/** @type {import('../../utils').TablesDeclaration} */
const tablesDeclaration = {}
const {
  Customer, Plan, Subscription, SubscriptionItem, Product, Price, ExternalAccount, // LineItem, Item, SetupAttempt
  PaymentMethod, Invoice, SetupIntent, Account, SubscriptionSchedule, PaymentIntent,
  Source, TaxRate, TaxId, Charge, Coupon, Session, InvoiceItem,
  PromotionCode, Mandate, Review, Refund, Discount,
  BalanceTransaction, Transfer, TransferReversal
} = modelFactory(tablesDeclaration)

Object.assign(Customer, {
  id: 'string',
  address: 'json',
  description: 'string',
  email: 'string',
  metadata: 'json',
  name: 'string',
  phone: 'string',
  shipping: 'json',
  object: 'string',
  balance: 'integer',
  createdAt: 'dateTime',
  currency: 'string',
  default_source: Source,
  delinquent: 'boolean',
  discount: Discount,
  invoice_prefix: 'string',
  invoice_settings: 'json',
  livemode: 'boolean',
  next_invoice_sequence: 'integer',
  preferred_locales: 'json',
  tax_exempt: 'string',
  sources: [Source],
  subscriptions: [Subscription],
  tax_ids: [TaxId]
})

Object.assign(Product, {
  id: 'string',
  active: 'boolean',
  description: 'string',
  metadata: 'json',
  name: 'string',
  object: 'string',
  attributes: 'json',
  caption: 'string',
  createdAt: 'dateTime',
  deactivate_on: 'json',
  images: 'json',
  livemode: 'boolean',
  package_dimensions: 'json',
  shippable: 'boolean',
  statement_descriptor: 'string',
  unit_label: 'string',
  updated: 'dataTime',
  url: 'string'
})

Object.assign(Price, {
  id: 'string',
  active: 'boolean',
  currency: 'string',
  metadata: 'json',
  nickname: 'string',
  product: Product,
  recurring: 'json',
  type: 'string',
  unit_amount: 'integer',
  object: 'string',
  billing_scheme: 'string',
  createdAt: 'dateTime',
  livemode: 'boolean',
  lookup_key: 'string',
  tiers: 'json', // expandable
  tiers_mode: 'string',
  transform_quantity: 'json',
  unit_amount_decimal: 'string'
})

Object.assign(Plan, {
  id: 'string',
  active: 'boolean',
  amount: 'integer',
  currency: 'string',
  interval: 'string',
  metadata: 'json',
  nickname: 'string',
  product: Product,
  object: 'string',
  aggregate_usage: 'string',
  amount_decimal: 'string',
  billing_scheme: 'string',
  createdAt: 'dateTime',
  interval_count: 'integer',
  livemode: 'boolean',
  tiers: 'json', // expandable
  tiers_mode: 'string',
  transform_usage: 'json',
  trial_period_days: 'integer',
  usage_type: 'string'
})

Object.assign(Subscription, {
  id: 'string',
  cancel_at_period_end: 'boolean',
  current_period_end: 'dateTime',
  current_period_start: 'dateTime',
  customer: Customer,
  default_payment_method: PaymentMethod,
  items: [SubscriptionItem],
  latest_invoice: Invoice,
  metadata: 'json',
  pending_setup_intent: SetupIntent,
  pending_update: 'json',
  status: 'string',
  object: 'string',
  application_fee_percent: 'string',
  billing_cycle_anchor: 'dateTime',
  billing_thresholds: 'json',
  cancel_at: 'dateTime',
  canceled_at: 'dateTime',
  collection_method: 'string',
  createdAt: 'dateTime',
  days_until_due: 'integer',
  default_source: Source,
  default_tax_rates: [TaxRate],
  discount: Discount,
  ended_at: 'dateTime',
  livemode: 'boolean',
  next_pending_invoice_item_invoice: 'dateTime',
  pause_collection: 'json',
  pending_invoice_item_interval: 'json',
  schedule: SubscriptionSchedule,
  start_date: 'dateTime',
  transfer_data: Account,
  trial_end: 'dateTime',
  trial_start: 'dateTime'
})

Object.assign(SubscriptionItem, {
  id: 'string',
  metadata: 'json',
  price: Price,
  quantity: 'integer',
  subscription: Subscription,
  object: 'string',
  billing_thresholds: 'json',
  createdAt: 'dateTime',
  tax_rates: [TaxRate]
})

Object.assign(SubscriptionSchedule, {
  id: 'string',
  current_phase: 'json',
  customer: Customer,
  metadata: 'json',
  phases: 'json',
  status: 'string',
  subscription: Subscription,
  object: 'string',
  canceled_at: 'dateTime',
  completed_at: 'dateTime',
  createdAt: 'dateTime',
  default_settings: 'json',
  end_behavior: 'string',
  livemode: 'boolean',
  released_at: 'dateTime',
  released_subscription: Subscription
})

Object.assign(Account, {
  id: 'string',
  business_type: 'string',
  capabilities: 'json',
  company: 'json',
  country: 'string',
  email: 'string',
  individual: 'json',
  metadata: 'json',
  requirements: 'json',
  tos_acceptance: 'json',
  type: 'string',
  object: 'string',
  business_profile: 'json',
  charges_enabled: 'boolean',
  createdAt: 'dateTime',
  default_currency: 'string',
  details_submitted: 'boolean',
  external_accounts: [ExternalAccount],
  payouts_enabled: 'boolean',
  settings: 'json'
})

Object.assign(Invoice, {
  id: 'string',
  auto_advance: 'boolean',
  charge: Charge,
  collection_method: 'string',
  currency: 'string',
  customer: Customer,
  description: 'string',
  hosted_invoice_url: 'string',
  lines: 'json', // Can be mapped to [LineItem], but this is impossible to retrieve with stripe helper
  metadata: 'json',
  payment_intent: PaymentIntent,
  period_end: 'dateTime',
  period_start: 'dateTime',
  status: 'string',
  subscription: Subscription,
  total: 'integer',
  object: 'string',
  account_country: 'string',
  account_name: 'string',
  account_tax_ids: [TaxId],
  amount_due: 'integer',
  amount_paid: 'integer',
  amount_remaining: 'integer',
  application_fee_amount: 'integer',
  attempt_count: 'integer',
  attempted: 'boolean',
  billing_reason: 'string',
  createdAt: 'dateTime',
  custom_fields: 'json',
  customer_address: 'json',
  customer_email: 'string',
  customer_name: 'string',
  customer_phone: 'string',
  customer_shipping: 'json',
  customer_tax_exempt: 'string',
  customer_tax_ids: [TaxId],
  default_payment_method: PaymentMethod,
  default_source: Source,
  default_tax_rates: [TaxRate],
  discount: Discount,
  discounts: [Discount],
  due_date: 'dateTime',
  ending_balance: 'integer',
  footer: 'string',
  invoice_pdf: 'string',
  livemode: 'boolean',
  next_payment_attempt: 'dateTime',
  number: 'string',
  paid: 'boolean',
  post_payment_credit_notes_amount: 'integer',
  pre_payment_credit_notes_amount: 'integer',
  receipt_number: 'string',
  starting_balance: 'integer',
  statement_descriptor: 'string',
  status_transitions: 'json',
  subscription_proration_date: 'integer',
  subtotal: 'integer',
  tax: 'integer',
  threshold_reason: 'json',
  total_discount_amounts: 'json',
  total_tax_amounts: 'json',
  transfer_data: Account,
  webhooks_delivered_at: 'dateTime'
})

Object.assign(TaxRate, {
  id: 'string',
  active: 'boolean',
  description: 'string',
  display_name: 'string',
  inclusive: 'boolean',
  jurisdiction: 'string',
  metadata: 'json',
  percentage: 'decimal',
  object: 'string',
  createdAt: 'dateTime',
  livemode: 'boolean'
})

Object.assign(TaxId, {
  id: 'string',
  country: 'string',
  customer: Customer,
  type: 'string',
  value: 'string',
  object: 'string',
  createdAt: 'dateTime',
  livemode: 'boolean',
  verification: 'json'
})

Object.assign(Discount, {
  id: 'string',
  coupon: Coupon,
  customer: Customer,
  end: 'dateTime',
  start: 'dateTime',
  subscription: Subscription,
  object: 'string',
  checkout_session: Session,
  invoice: Invoice,
  invoice_item: InvoiceItem,
  promotion_code: PromotionCode
})

Object.assign(PaymentMethod, {
  id: 'string',
  billing_details: 'json',
  customer: Customer,
  metadata: 'json',
  type: 'string',
  object: 'string',
  alipay: 'json',
  au_becs_debit: 'json',
  bacs_debit: 'json',
  bancontact: 'json',
  card: 'json',
  card_present: 'json',
  createdAt: 'dateTime',
  eps: 'json',
  fpx: 'json',
  giropay: 'json',
  ideal: 'json',
  interac_present: 'json',
  livemode: 'boolean',
  oxxo: 'json',
  p24: 'json',
  sepa_debit: 'json',
  sofort: 'json'
})

Object.assign(SetupIntent, {
  id: 'string',
  client_secret: 'string',
  customer: Customer,
  description: 'string',
  metadata: 'json',
  next_action: 'json',
  payment_method: PaymentMethod,
  payment_method_types: 'json',
  status: 'string',
  usage: 'string',
  object: 'string',
  application: 'json', // Can be mapped to Application
  cancellation_reason: 'string',
  createdAt: 'dateTime',
  latest_attempt: 'json', // Can be mapped to SetupAttempt, but impossible to retrieve the data with Stripe helper
  livemode: 'boolean',
  mandate: Mandate,
  payment_method_options: 'json',
  single_use_mandate: Mandate
})

Object.assign(PaymentIntent, {
  id: 'string',
  amount: 'integer',
  charges: [Charge],
  client_secret: 'string',
  currency: 'string',
  customer: Customer,
  description: 'string',
  last_payment_error: 'json',
  metadata: 'json',
  next_action: 'json',
  payment_method: PaymentMethod,
  payment_method_types: 'string',
  receipt_email: 'string',
  setup_future_usage: 'string',
  shipping: 'json',
  statement_descriptor: 'string',
  statement_descriptor_suffix: 'string',
  status: 'string',
  object: 'string',
  amount_capturable: 'integer',
  amount_received: 'integer',
  application: 'json', // Can be mapped to Application
  application_fee_amount: 'integer',
  canceled_at: 'dateTime',
  cancellation_reason: 'string',
  capture_method: 'string',
  confirmation_method: 'string',
  createdAt: 'dateTime',
  invoice: Invoice,
  livemode: 'boolean',
  on_behalf_of: Account,
  payment_method_options: 'json',
  review: Review,
  transfer_data: 'json',
  transfer_group: 'string'
})

Object.assign(Source, {
  id: 'string',
  amount: 'integer',
  currency: 'string',
  customer: Customer,
  metadata: 'json',
  owner: 'json',
  redirect: 'json',
  statement_descriptor: 'string',
  status: 'string',
  type: 'string',
  object: 'string',
  client_secret: 'string',
  code_verification: 'json',
  createdAt: 'dateTime',
  flow: 'string',
  livemode: 'boolean',
  receiver: 'json',
  source_order: 'json',
  usage: 'string'
})

Object.assign(ExternalAccount, {
  id: 'string',
  account: Account,
  bank_name: 'string',
  country: 'string',
  currency: 'string',
  default_for_currency: 'boolean',
  last4: 'string',
  metadata: 'json',
  routing_number: 'string',
  status: 'string',
  object: 'string',
  account_holder_name: 'string',
  account_holder_type: 'string',
  available_payout_methods: 'json',
  customer: Customer,
  fingerprint: 'string'
})

Object.assign(Coupon, {
  id: 'string',
  amount_off: 'integer',
  currency: 'string',
  duration: 'string',
  metadata: 'json',
  name: 'string',
  percent_off: 'decimal',
  object: 'string',
  applies_to: 'json', // applies_to.products is mapped to [Product]. We could map those with a trick.
  createdAt: 'dateTime',
  livemode: 'boolean',
  max_redemptions: 'integer',
  redeem_by: 'dateTime',
  times_redeemed: 'integer',
  valid: 'boolean'
})

Object.assign(Session, {
  id: 'string',
  cancel_url: 'string',
  client_reference_id: 'string',
  customer: Customer,
  customer_email: 'string',
  line_items: 'json', // Could be mapped to [Item], but this is impossible to retrieve from stripe helper
  metadata: 'json',
  mode: 'string',
  payment_intent: PaymentIntent,
  payment_method_types: 'json',
  payment_status: 'string',
  success_url: 'string',
  object: 'string',
  allow_promotion_codes: 'boolean',
  amount_subtotal: 'integer',
  amount_total: 'integer',
  billing_address_collection: 'string',
  currency: 'string',
  livemode: 'boolean',
  locale: 'string',
  setup_intent: SetupIntent,
  shipping: 'json',
  shipping_address_collection: 'json',
  submit_type: 'string',
  subscription: Subscription,
  total_details: 'json'
})

// Object.assign(Item, {
//   id: 'string',
//   object: 'string',
//   amount_subtotal: 'integer',
//   amount_total: 'integer',
//   currency: 'string',
//   description: 'string',
//   discounts: 'json', // Could be mapped to [Discount], but that cannot be retrieved by the API.
//   price: Price,
//   quantity: 'integer',
//   taxes: 'json' // { amount: 'integer', rate: TaxRate }. The issue is that there is no id to create a real mapping. We could map taxes.rate, though
// })

Object.assign(InvoiceItem, {
  id: 'string',
  amount: 'integer',
  currency: 'string',
  customer: Customer,
  description: 'string',
  metadata: 'json',
  period: 'json',
  price: Price,
  proration: 'boolean',
  object: 'string',
  date: 'dateTime',
  discountable: 'boolean',
  discounts: [Discount],
  invoice: Invoice,
  livemode: 'boolean',
  quantity: 'integer',
  subscription: Subscription,
  subscription_item: SubscriptionItem,
  tax_rates: [TaxRate],
  unit_amount: 'integer',
  unit_amount_decimal: 'string'
})

Object.assign(PromotionCode, {
  id: 'string',
  code: 'string',
  coupon: Coupon,
  metadata: 'json',
  object: 'string',
  active: 'boolean',
  createdAt: 'dateTime',
  customer: Customer,
  expires_at: 'dateTime',
  livemode: 'boolean',
  max_redemptions: 'integer',
  restrictions: 'json',
  times_redeemed: 'integer'
})

// Object.assign(LineItem, {
//   id: 'string',
//   amount: 'integer',
//   currency: 'string',
//   description: 'string',
//   metadata: 'json',
//   period: 'json',
//   price: Price,
//   proration: 'boolean',
//   quantity: 'integer',
//   type: 'string',
//   object: 'string',
//   discount_amounts: 'json', // { amount: 'integer, discounts: [Disount] } We could map discount_amounts.discounts to [Discount]
//   discountable: 'boolean',
//   discounts: 'json', // Could be mapped to Discount, but that cannot be retrieved by the API.
//   invoice_item: InvoiceItem,
//   livemode: 'boolean',
//   subscription: Subscription,
//   subscription_item: SubscriptionItem,
//   tax_amounts: 'json',
//   tax_rates: [TaxRate]
// })

Object.assign(Mandate, {
  id: 'string',
  customer_acceptance: 'json',
  payment_method: PaymentMethod,
  payment_method_details: 'json',
  status: 'string',
  type: 'string',
  object: 'string',
  livemode: 'boolean',
  multi_use: 'json',
  single_use: 'json'
})

// Object.assign(SetupAttempt, {
//   id: 'string',
//   object: 'string',
//   application: 'json', // Can be mapped to Application
//   createdAt: 'dateTime',
//   customer: Customer,
//   livemode: 'boolean',
//   on_behalf_of: Account,
//   payment_method: PaymentMethod,
//   payment_method_details: 'json',
//   setup_error: 'json',
//   setup_intent: SetupIntent,
//   status: 'string',
//   usage: 'string'
// })

Object.assign(Review, {
  id: 'string',
  charge: Charge,
  open: 'boolean',
  payment_intent: PaymentIntent,
  reason: 'string',
  object: 'string',
  billing_zip: 'string',
  closed_reason: 'string',
  createdAt: 'dateTime',
  ip_address: 'string',
  ip_address_location: 'json',
  livemode: 'boolean',
  opened_reason: 'string',
  session: Session
})

Object.assign(Charge, {
  id: 'string',
  amount: 'integer',
  balance_transaction: BalanceTransaction,
  billing_details: 'json',
  currency: 'string',
  customer: Customer,
  description: 'string',
  disputed: 'boolean',
  invoice: Invoice,
  metadata: 'json',
  payment_intent: PaymentIntent,
  payment_method_details: 'json',
  receipt_email: 'string',
  refunded: 'boolean',
  shipping: 'json',
  statement_descriptor: 'string',
  statement_descriptor_suffix: 'string',
  status: 'string',
  object: 'string',
  amount_captured: 'integer',
  amount_refunded: 'integer',
  application: 'json', // Can be map to Application
  application_fee: 'string', // Can be map to ApplicationFee
  application_fee_amount: 'integer',
  calculated_statement_descriptor: 'string',
  captured: 'boolean',
  createdAt: 'dateTime',
  failure_code: 'string',
  failure_message: 'string',
  fraud_details: 'json',
  livemode: 'boolean',
  on_behalf_of: Account,
  orderRef: 'string',
  outcome: 'json',
  paid: 'boolean',
  payment_method: PaymentMethod,
  receipt_number: 'string',
  receipt_url: 'string',
  refunds: [Refund], // list
  review: Review,
  source_transfer: Transfer,
  transfer: Transfer,
  transfer_data: 'json',
  transfer_group: 'string'
})

Object.assign(BalanceTransaction, {
  id: 'string',
  amount: 'integer',
  currency: 'string',
  description: 'string',
  fee: 'integer',
  fee_details: 'json',
  net: 'integer',
  source: Source,
  status: 'string',
  type: 'string',
  object: 'string',
  available_on: 'dateTime',
  createdAt: 'dateTime',
  exchange_rate: 'decimal',
  reporting_category: 'string'
})

Object.assign(Refund, {
  id: 'string',
  amount: 'integer',
  charge: Charge,
  currency: 'string',
  description: 'string',
  metadata: 'json',
  payment_intent: PaymentIntent,
  reason: 'string',
  status: 'string',
  object: 'string',
  balance_transaction: BalanceTransaction,
  createdAt: 'dateTime',
  failure_balance_transaction: BalanceTransaction,
  failure_reason: 'string',
  receipt_number: 'string',
  source_transfer_reversal: TransferReversal,
  transfer_reversal: TransferReversal
})

Object.assign(Transfer, {
  id: 'string',
  amount: 'integer',
  currency: 'string',
  description: 'string',
  destination: Account,
  metadata: 'json',
  object: 'string',
  amount_reversed: 'integer',
  balance_transaction: BalanceTransaction,
  createdAt: 'dateTime',
  destination_payment: 'string', // Can be mapped to Payment
  livemode: 'boolean',
  reversals: [TransferReversal], // list
  reversed: 'boolean',
  source_transaction: Charge, // Or Payment
  source_type: 'string',
  transfer_group: 'string'
})

Object.assign(TransferReversal, {
  id: 'string',
  amount: 'integer',
  currency: 'string',
  metadata: 'json',
  transfer: Transfer,
  object: 'string',
  balance_transaction: BalanceTransaction,
  createdAt: 'dateTime',
  destination_payment_refund: Refund,
  source_refund: Refund
})

/** @type {import('./index').StripeTables<string[]>} */
const expandable = {
  Customer: ['subscriptions', 'default_source', 'sources', 'tax_ids'],
  Product: [],
  Price: ['product'],
  Plan: ['product'],
  Subscription: ['customer', /* 'default_payment_method', */ 'latest_invoice', 'pending_setup_intent', /* 'default_source', */ 'schedule'],
  SubscriptionItem: [],
  SubscriptionSchedule: ['customer', 'subscription'],
  Account: [],
  Invoice: ['charge', 'customer', 'payment_intent', 'subscription', 'account_tax_ids', 'default_payment_method', 'default_source', 'discounts'],
  TaxRate: [],
  TaxId: ['customer'],
  Discount: ['customer', 'promotion_code'],
  PaymentMethod: ['customer'],
  SetupIntent: ['customer', 'payment_method', 'application', 'latest_attempt', 'mandate', 'on_behalf_of', 'single_use_mandate'],
  PaymentIntent: ['customer', 'payment_method', 'application', 'invoice', 'on_behalf_of', 'review'],
  Source: [],
  ExternalAccount: ['account', 'customer'],
  Coupon: ['applies_to'],
  Session: ['customer', 'line_items', 'payment_intent', 'setup_intent', 'subscription'],
  InvoiceItem: ['customer', 'discounts', 'invoice', 'subscription'],
  PromotionCode: ['customer'],
  Mandate: ['payment_method'],
  Review: ['charge', 'payment_intent'],
  BalanceTransaction: ['source'],
  Charge: ['balance_transaction', 'customer', 'invoice', 'payment_intent', 'application', 'application_fee', 'on_behalf_of', 'order', 'review', 'source_transfer', 'transfer'],
  Refund: ['charge', 'payment_intent', 'balance_transaction', 'failure_balance_transaction', 'source_transfer_reversal', 'transfer_reversal'],
  Transfer: ['destination', 'balance_transaction', 'destination_payment', 'source_transaction'],
  TransferReversal: ['transfer', 'balance_transaction', 'destination_payment_refund', 'source_refund']
}

/** @type {import('./index').StripeTables<string[]>} List the fields that will return an ApiList instead of just a list. */
const asList = {
  Customer: ['subscriptions', 'tax_ids', 'sources'],
  Product: [],
  Plan: [],
  Price: [],
  Subscription: ['items'],
  SubscriptionItem: [],
  SubscriptionSchedule: [],
  Account: ['external_accounts'],
  Invoice: ['lines'],
  TaxRate: [],
  TaxId: [],
  Discount: [],
  PaymentMethod: [],
  SetupIntent: [],
  PaymentIntent: ['charges'],
  Source: [],
  ExternalAccount: [],
  Coupon: [],
  Session: ['line_items'],
  InvoiceItem: [],
  PromotionCode: [],
  Mandate: [],
  Review: [],
  BalanceTransaction: [],
  Charge: ['refunds'],
  Refund: [],
  Transfer: ['reversals'],
  TransferReversal: []
}

const { tablesModel, tables } = prepareTables(tablesDeclaration)
// We keep track of the association tables to handle them differently on stripe.
// The association tables are the tables in the model that were created from the table declaration.
const associationTables = Object.keys(tablesModel).filter(key => !Object.keys(tables).includes(key))
module.exports = {
  tablesModel,
  tables,
  associationTables,
  expandable,
  asList
}
