// @ts-check

/** @type {import('../../plugins').Plugin} */
const plugin = {
  onRequest: {
    Session: async (request) => {
      if (request.get && !request.get.includes('customer')) {
        if (request.get === '*') request.customer = {}
        else request.get.push('customer')
      }
    },
    Subscription: async (request) => {
      if (request.get && !request.get.includes('customer')) {
        if (request.get === '*') request.customer = {}
        else request.get.push('customer')
      }
    },
    SubscriptionItem: async (request) => {
      if (request.get && !request.get.includes('subscription')) {
        if (request.get === '*') request.subscription = {}
        else request.get.push('subscription')
      }
    }
  }
}

module.exports = plugin
