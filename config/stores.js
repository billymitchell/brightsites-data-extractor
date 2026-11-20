const { logWarn } = require('../utils/logger');

function getConfiguredStores() {
  const env = process.env.BRIGHTSITES_STORES;
  if (env) {
    try {
      const parsed = JSON.parse(env);
      const out = {};
      Object.entries(parsed).forEach(([key, value]) => {
        const store = Object.assign({}, value || {});
        if (!store.token) store.token = key;
        out[key] = store;
      });
      return out;
    } catch (e) {
      logWarn('config/stores.getConfiguredStores', 'BRIGHTSITES_STORES invalid JSON', {
        error: e.message,
      });
    }
  }
  if (process.env.BRIGHTSITES_SUBDOMAIN && process.env.BRIGHTSITES_API_TOKEN) {
    return {
      default: {
        subdomain: process.env.BRIGHTSITES_SUBDOMAIN,
        token: process.env.BRIGHTSITES_API_TOKEN,
        label: process.env.BRIGHTSITES_SUBDOMAIN,
      },
    };
  }
  return {};
}

module.exports = {
  getConfiguredStores,
};
