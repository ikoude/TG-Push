/**
 * TG·Push - 工具函数统一导出
 */

const errorHandler = require('./error-handler');
const helpers = require('./helpers');
const logger = require('./logger');

module.exports = {
  ...errorHandler,
  ...helpers,
  ...logger,
  // 命名空间导出
  errorHandler,
  helpers,
  logger
};
