/**
 * src/middleware/index.js — 中间件统一导出
 */

const { errorHandler, asyncHandler, validationError } = require('./error-handler');
const { createCorsMiddleware } = require('./cors');

module.exports = {
  errorHandler,
  asyncHandler,
  validationError,
  createCorsMiddleware
};