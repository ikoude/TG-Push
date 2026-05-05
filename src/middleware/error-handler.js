/**
 * src/middleware/error-handler.js — Express 错误处理中间件
 */

const { AppError, ErrorSeverity, logError } = require('../utils');

function errorHandler(err, req, res, _next) {
  const loggedError = logError(err, {
    context: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    }
  });

  let statusCode = 500;
  if (err instanceof AppError) {
    switch (err.code) {
      case 'BAD_REQUEST':
      case 'VALIDATION_ERROR':
        statusCode = 400;
        break;
      case 'UNAUTHORIZED':
      case 'SESSION_EXPIRED':
        statusCode = 401;
        break;
      case 'FORBIDDEN':
        statusCode = 403;
        break;
      case 'NOT_FOUND':
        statusCode = 404;
        break;
      case 'CONFLICT':
        statusCode = 409;
        break;
      default:
        statusCode = err.severity === ErrorSeverity.CRITICAL ? 500 : 400;
    }
  } else if (err.statusCode || err.status) {
    statusCode = err.statusCode || err.status;
  }

  const userMessage = err instanceof AppError ? err.message : '服务器内部错误';

  res.status(statusCode).json({
    success: false,
    error: userMessage,
    code: err instanceof AppError ? err.code : 'INTERNAL_ERROR'
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function validationError(message, field = null) {
  return new AppError(message, {
    code: 'VALIDATION_ERROR',
    severity: ErrorSeverity.WARNING,
    context: { field }
  });
}

module.exports = {
  errorHandler,
  asyncHandler,
  validationError
};