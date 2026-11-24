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

// A store's program groups it in the UI and decides which report formats can use it.
// "program" is an ID like "ftg"; "programLabel" optionally overrides its display name.
function storeProgram(store = {}) {
  const id = String(store.program || '').trim().toLowerCase();
  if (!id) return { id: '', label: 'Other stores' };
  const custom = String(store.programLabel || '').trim();
  const label = custom || (id.length <= 3 ? id.toUpperCase() : id.charAt(0).toUpperCase() + id.slice(1));
  return { id, label };
}

// Stores for the browser: never includes the API token.
function listStoresForClient(stores = getConfiguredStores()) {
  return Object.entries(stores).map(([key, value]) => {
    const program = storeProgram(value);
    return {
      key,
      label: value.label || key,
      subdomain: value.subdomain,
      program: program.id,
      programLabel: program.label,
    };
  });
}

module.exports = {
  getConfiguredStores,
  storeProgram,
  listStoresForClient,
};
