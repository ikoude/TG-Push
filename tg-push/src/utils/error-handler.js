/**
 * TG·Push - 统一错误处理工具
 * 
 * 提供标准化的错误处理、日志记录和用户友好的错误消息
 */

/**
 * 错误严重级别
 */
const ErrorSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * 自定义错误类 - 应用错误基类
 */
class AppError extends Error {
  constructor(message, { 
    code = 'UNKNOWN_ERROR', 
    severity = ErrorSeverity.ERROR, 
    cause = null,
    context = {}
  } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.severity = severity;
    this.cause = cause;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }

  /**
   * 转换为JSON格式
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp
    };
  }
}

/**
 * 错误处理器类
 */
class ErrorHandler {
  constructor() {
    this.listeners = [];
  }

  /**
   * 添加错误监听器
   */
  addListener(listener) {
    this.listeners.push(listener);
  }

  /**
   * 移除错误监听器
   */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 记录错误
   */
  log(error, options = {}) {
    const {
      silent = false,
      context = {}
    } = options;

    const appError = this.normalize(error, context);

    // 控制台输出
    this._outputToConsole(appError);

    // 通知所有监听器
    if (!silent) {
      for (const listener of this.listeners) {
        try {
          listener(appError);
        } catch (e) {
          console.error('[ErrorHandler] 监听器调用失败:', e);
        }
      }
    }

    return appError;
  }

  /**
   * 规范化错误为AppError
   */
  normalize(error, context = {}) {
    if (error instanceof AppError) {
      return error;
    }

    const message = error?.message || String(error) || '未知错误';
    return new AppError(message, {
      code: error?.code || 'UNKNOWN_ERROR',
      cause: error,
      context
    });
  }

  /**
   * 输出到控制台
   */
  _outputToConsole(error) {
    const prefix = `[${error.severity.toUpperCase()}]`;
    const msg = `${prefix} [${error.code}] ${error.message}`;
    
    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.ERROR:
        console.error(msg, error.context, error.cause || '');
        break;
      case ErrorSeverity.WARNING:
        console.warn(msg, error.context);
        break;
      default:
        console.info(msg, error.context);
    }
  }
}

// 全局错误处理器实例
const globalErrorHandler = new ErrorHandler();

/**
 * 便捷函数 - 记录错误
 */
function logError(error, options = {}) {
  return globalErrorHandler.log(error, options);
}

/**
 * 便捷函数 - 创建并记录错误
 */
function createAndLog(message, options = {}) {
  const error = new AppError(message, options);
  return globalErrorHandler.log(error);
}

/**
 * 安全执行异步函数，捕获并处理错误
 */
async function safeExecute(fn, options = {}) {
  const {
    fallback = null,
    onError = null,
    silent = false
  } = options;

  try {
    return await fn();
  } catch (error) {
    const loggedError = globalErrorHandler.log(error, { silent, ...options });
    if (onError) {
      onError(loggedError);
    }
    return fallback;
  }
}

/**
 * 安全执行同步函数，捕获并处理错误
 */
function safeExecuteSync(fn, options = {}) {
  const {
    fallback = null,
    onError = null,
    silent = false
  } = options;

  try {
    return fn();
  } catch (error) {
    const loggedError = globalErrorHandler.log(error, { silent, ...options });
    if (onError) {
      onError(loggedError);
    }
    return fallback;
  }
}

module.exports = {
  ErrorSeverity,
  AppError,
  ErrorHandler,
  globalErrorHandler,
  logError,
  createAndLog,
  safeExecute,
  safeExecuteSync
};
