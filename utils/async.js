const { logError } = require('./logger');
const { isCanceledError } = require('./cancel');

async function promisePool(items, worker, concurrency = 5, options = {}) {
  const results = [];
  let fatalError = null;
  let i = 0;
  const runners = new Array(concurrency).fill(null).map(async () => {
    while (i < items.length) {
      if (fatalError) return;
      const idx = i++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        if (isCanceledError(err) || options.stopOnError) {
          fatalError = err;
          return;
        }
        logError('utils/async.promisePool', err, {
          index: idx,
        });
        results[idx] = { error: String(err) };
      }
    }
  });
  await Promise.all(runners);
  if (fatalError) throw fatalError;
  return results;
}

module.exports = {
  promisePool,
};
