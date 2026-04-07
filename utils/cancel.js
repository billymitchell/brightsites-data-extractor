const CANCELED_ERROR_CODE = 'ERR_REPORT_JOB_CANCELED';

function createCanceledError(message = 'Report job canceled.') {
  const err = new Error(message);
  err.code = CANCELED_ERROR_CODE;
  err.statusCode = 499;
  return err;
}

function isCanceledError(err) {
  return Boolean(err && err.code === CANCELED_ERROR_CODE);
}

function throwIfCanceled(isCanceled, message) {
  if (typeof isCanceled === 'function' && isCanceled()) {
    throw createCanceledError(message);
  }
}

module.exports = {
  CANCELED_ERROR_CODE,
  createCanceledError,
  isCanceledError,
  throwIfCanceled,
};
