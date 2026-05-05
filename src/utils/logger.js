/**
 * src/utils/logger.js — 环境感知日志管理器 v2
 *
 * 生产环境行为:
 *   - ERROR: 仅输出错误到终端
 *   - WARN:  仅输出警告到终端
 *   - INFO:  不输出（仅记录到内部日志）
 *   - DEBUG: 不输出
 *
 * 开发环境行为:
 *   - 所有级别都输出到终端
 */

const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

const LogLevelNames = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

const PROD_LOG_LEVEL = LogLevel.WARN;
const DEV_LOG_LEVEL = LogLevel.DEBUG;

let currentLevel = DEV_LOG_LEVEL;
let isProduction = false;
let _listeners = [];

function detectEnvironment() {
  const env = process.env.NODE_ENV || 'development';
  isProduction = env === 'production';
  currentLevel = isProduction ? PROD_LOG_LEVEL : DEV_LOG_LEVEL;
}

function setLogLevel(level) {
  if (typeof level === 'string') {
    const upper = level.toUpperCase();
    if (LogLevel[upper] !== undefined) {
      currentLevel = LogLevel[upper];
    }
  } else if (typeof level === 'number') {
    currentLevel = level;
  }
}

function getLogLevel() {
  return currentLevel;
}

function shouldLog(level) {
  return level >= currentLevel;
}

function formatMessage(level, namespace, message, ...args) {
  const timestamp = new Date().toISOString();
  const levelName = LogLevelNames[level] || 'LOG';
  const ns = namespace ? `[${namespace}] ` : '';
  const extra = args.length > 0 ? ' ' + args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ') : '';
  return { timestamp, level, levelName, message: ns + message + extra };
}

function log(level, namespace, message, ...args) {
  if (!shouldLog(level)) return null;

  const entry = formatMessage(level, namespace, message, ...args);

  const handler = consoleMethods[entry.levelName.toLowerCase()];
  if (handler) {
    handler(entry.message);
  }

  for (const listener of _listeners) {
    try {
      listener(entry);
    } catch (e) {
      // ignore
    }
  }

  return entry;
}

function addListener(fn) {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter(l => l !== fn);
  };
}

const consoleMethods = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

function overrideConsole() {
  const self = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console)
  };

  console.log = (...args) => {
    if (shouldLog(LogLevel.INFO)) {
      self.log(...args);
    }
    emitLog(LogLevel.INFO, null, args);
  };

  console.error = (...args) => {
    if (shouldLog(LogLevel.ERROR)) {
      self.error(...args);
    }
    emitLog(LogLevel.ERROR, null, args);
  };

  console.warn = (...args) => {
    if (shouldLog(LogLevel.WARN)) {
      self.warn(...args);
    }
    emitLog(LogLevel.WARN, null, args);
  };

  console.info = (...args) => {
    if (shouldLog(LogLevel.INFO)) {
      self.info(...args);
    }
    emitLog(LogLevel.INFO, null, args);
  };

  console.debug = (...args) => {
    if (shouldLog(LogLevel.DEBUG)) {
      self.debug(...args);
    }
    emitLog(LogLevel.DEBUG, null, args);
  };

  return self;
}

function emitLog(level, namespace, args) {
  const entry = formatMessage(level, namespace, args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' '));

  for (const listener of _listeners) {
    try {
      listener(entry);
    } catch (e) {
      // ignore
    }
  }
}

function createLogger(namespace) {
  return {
    debug: (msg, ...args) => log(LogLevel.DEBUG, namespace, msg, ...args),
    info: (msg, ...args) => log(LogLevel.INFO, namespace, msg, ...args),
    warn: (msg, ...args) => log(LogLevel.WARN, namespace, msg, ...args),
    error: (msg, ...args) => log(LogLevel.ERROR, namespace, msg, ...args),
    namespace
  };
}

detectEnvironment();

module.exports = {
  LogLevel,
  createLogger,
  setLogLevel,
  getLogLevel,
  shouldLog,
  addListener,
  overrideConsole,
  detectEnvironment,
  isProduction: () => isProduction
};