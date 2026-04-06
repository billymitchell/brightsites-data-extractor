const { logError } = require('./logger');

async function promisePool(items, worker, concurrency = 5) {
  const results = [];
  let i = 0;
  const runners = new Array(concurrency).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        logError('utils/async.promisePool', err, {
          index: idx,
        });
        results[idx] = { error: String(err) };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

module.exports = {
  promisePool,
};
