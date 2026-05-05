/**
 * TG·Push - Express 错误处理中间件
 *
 * 为 Express 路由提供统一的错误处理
 */

const { logError, AppError, ErrorSeverity } = require('./error-handler');

/**
 * Express 错误处理中间件
 */
function errorHandler(err, req, res, _next) {
  // 记录错误
  const loggedError = logError(err, {
    context: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    }
  });

  // 确定 HTTP 状态码
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

  // 用户友好的错误消息
  const userMessage =
    err instanceof AppError ? err.message : '服务器内部错误';

  // 发送响应
  res.status(statusCode).json({
    success: false,
    error: userMessage,
    code: err instanceof AppError ? err.code : 'INTERNAL_ERROR'
  });
}

/**
 * 异步路由包装器 - 自动捕获异步错误
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 创建一个验证错误
 */
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
