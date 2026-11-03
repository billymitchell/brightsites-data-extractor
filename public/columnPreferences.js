(function (root) {
  function orderedColumns(columns, order = []) {
    const available = new Set(columns);
    return [...new Set(order.filter(column => available.has(column)).concat(columns))];
  }

  function createPreferenceSync({ fetch, onStatus }) {
    const pending = new Map();
    let saving = false;
    let failed = false;
    async function flush() {
      if (saving || failed) return;
      saving = true;
      onStatus('saving');
      try {
        while (pending.size) {
          const [level, layout] = pending.entries().next().value;
          const response = await fetch(`/api/preferences/columns/${level}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(layout),
          });
          if (!response.ok) throw new Error('Your column changes were not saved to your account. Please retry.');
          if (pending.get(level) === layout) pending.delete(level);
        }
        onStatus('saved');
      } catch (error) {
        failed = true;
        onStatus('error', error.message);
      } finally {
        saving = false;
      }
    }
    return {
      save(level, layout) {
        pending.set(level, JSON.parse(JSON.stringify(layout)));
        return flush();
      },
      retry() { failed = false; return flush(); },
      hasPending() { return pending.size > 0; },
    };
  }
  const api = { orderedColumns, createPreferenceSync };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BrightSitesColumnPreferences = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
