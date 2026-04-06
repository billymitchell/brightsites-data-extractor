function pickFirstValue(obj, ...keys) {
  for (const key of keys) {
    if (!obj) continue;
    const value = obj[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

module.exports = {
  pickFirstValue,
};
