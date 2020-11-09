// @ts-check

/**
 * @param {import('stripe').Stripe} stripe The Stripe helper
 */
function taxIdHelper (stripe) {
  return {

    /**
     * @param {import('stripe').Stripe.TaxIdCreateParams & {customer: string}} data
     * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.TaxId>>}
     */
    create: async (data) => {
      const customerId = data.customer
      delete data.customer
      return this.stripe.customers.createTaxId(customerId, data)
    },
    /**
     * @param {string} customerId
     * @param {string} taxId
     * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.DeletedTaxId>>}
     */
    del: async (customerId, taxId) => this.stripe.customers.deleteTaxId(customerId, taxId),

    /**
     * @param {string} customerId
     * @param {import('stripe').Stripe.TaxIdListParams=} params
     * @param {import('stripe').Stripe.RequestOptions=} options
     * @returns {import('stripe').Stripe.ApiListPromise<import('stripe').Stripe.TaxId>}
     */
    list: (customerId, params, options) => this.stripe.customers.listTaxIds(customerId, params, options),
    update: async () => { console.error('Impossible to update TaxIDs in Stripe') },
    /**
     * @param {string} customerId
     * @param {string} taxId
     * @param {import('stripe').Stripe.TaxIdRetrieveParams=} params
     * @param {import('stripe').Stripe.RequestOptions=} options
     * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.TaxId>>}
     */
    retrieve: async (customerId, taxId, params, options) => this.stripe.customers.retrieveTaxId(customerId, taxId, params, options)
  }
}

/**
 * @param {import('stripe').Stripe} stripe The Stripe helper
 */
function mandateHelper (stripe) {
  return {
    create: () => Promise.reject('Impossible to create Mandates in Stripe with the current helper version.'),
    del: () => Promise.reject('Impossible to delete Mandates in Stripe with the current helper version.'),
    list: () => Promise.reject('Impossible to list Mandates in Stripe with the current helper version.'),
    update: () => Promise.reject('Impossible to update Mandates in Stripe with the current helper version.'),
    /**
         * @param {string} id The Mandate id,
         * @param {import('stripe').Stripe.MandateRetrieveParams=} params The retrieve parameters
         * @param {import('stripe').Stripe.RequestOptions=} options The request options
         * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.Mandate>>}
         */
    retrieve: (id, params, options) => this.stripe.mandates.retrieve(id, params, options)
  }
}

/**
 * @param {import('stripe').Stripe} stripe The Stripe helper
 */
function reviewHelper (stripe) {
  return {
    create: () => Promise.reject('Impossible to create Reviews in Stripe with the current helper version.'),
    /**
           * @param {string} id The Review Id
           * @param {import('stripe').Stripe.ReviewApproveParams=} params
           * @param {import('stripe').Stripe.RequestOptions=} options
           * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.Review>>}
           */
    del: (id, params, options) => this.stripe.reviews.approve(id, params, options),
    /**
           * @param {import('stripe').Stripe.ReviewListParams=} params
           * @param {import('stripe').Stripe.RequestOptions=} options
           * @returns {import('stripe').Stripe.ApiListPromise<import('stripe').Stripe.Review>}
           */
    list: (params, options) => this.stripe.reviews.list(params, options),
    update: () => Promise.reject('Impossible to update Reviews in Stripe with the current helper version.'),
    /**
           * @param {string} id The Mandate id,
           * @param {import('stripe').Stripe.ReviewRetrieveParams=} params The retrieve parameters
           * @param {import('stripe').Stripe.RequestOptions=} options The request options
           * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.Review>>}
           */
    retrieve: (id, params, options) => this.stripe.reviews.retrieve(id, params, options)
  }
}

/**
 * @param {import('stripe').Stripe} stripe The Stripe helper
 */
function externalAccountHelper (stripe) {
  return {
    /**
           * @param {string} accountId The Account Id
           * @param {import('stripe').Stripe.ExternalAccountCreateParams=} params
           * @param {import('stripe').Stripe.RequestOptions=} options
           * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.BankAccount | import('stripe').Stripe.Card>>}
           */
    create: (accountId, params, options) => this.stripe.accounts.createExternalAccount(accountId, params, options),
    /**
           * @param {string} accountId The Account Id
           * @param {string} id The ExternalAccount Id
           * @param {import('stripe').Stripe.ExternalAccountDeleteParams=} params
           * @param {import('stripe').Stripe.RequestOptions=} options
           * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.DeletedBankAccount | import('stripe').Stripe.DeletedCard>>}
           */
    del: (accountId, id, params, options) => this.stripe.accounts.deleteExternalAccount(accountId, id, params, options),
    /**
           * @param {string} accountId The Account Id
           * @param {import('stripe').Stripe.ExternalAccountListParams=} params
           * @param {import('stripe').Stripe.RequestOptions=} options
           * @returns {import('stripe').Stripe.ApiListPromise<import('stripe').Stripe.BankAccount | import('stripe').Stripe.Card>}
           */
    list: (accountId, params, options) => this.stripe.accounts.listExternalAccounts(accountId, params, options),
    /**
           * @param {string} accountId The Account Id
           * @param {string} id The ExternalAccount Id
           * @param {import('stripe').Stripe.ExternalAccountUpdateParams=} params
           * @param {import('stripe').Stripe.RequestOptions=} options
           * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.BankAccount | import('stripe').Stripe.Card>>}
           */
    update: (accountId, id, params, options) => this.stripe.accounts.updateExternalAccount(accountId, id, params, options),
    /**
           * @param {string} accountId The Account Id
           * @param {string} id The ExternalAccount Id
           * @param {import('stripe').Stripe.ExternalAccountRetrieveParams=} params
           * @param {import('stripe').Stripe.RequestOptions=} options
           * @returns {Promise<import('stripe').Stripe.Response<import('stripe').Stripe.BankAccount | import('stripe').Stripe.Card>>}
           */
    retrieve: (accountId, id, params, options) => this.stripe.accounts.retrieveExternalAccount(accountId, id, params, options)
  }
}

module.exports = {
  mandateHelper,
  reviewHelper,
  taxIdHelper,
  externalAccountHelper
}
