// @ts-check

/** @type {import('../../plugins').Plugin} */
const plugin = {
  onRequest: {
    Customer: async (request, { isAdmin, local }) => {
      if (!isAdmin && !request.reservedId) {
        request.reservedId = local.authId
      }
    },
    Session: async (request) => {
      if (request.get && !request.get.includes('customer')) {
        if (!request.customer) request.customer = {}
      }
    },
    Subscription: async (request) => {
      if (request.get && !request.get.includes('customer')) {
        if (!request.customer) request.customer = {}
      }
    },
    SubscriptionItem: async (request) => {
      if (request.get && !request.get.includes('subscription')) {
        if (!request.customer) request.customer = {}
      }
    }
  }
}

module.exports = plugin
