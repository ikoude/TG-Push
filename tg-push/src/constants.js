/**
 * src/constants.js — 全局常量定义
 */

const PATH = {
  DATA_DIR: '../data',
  SESSIONS_DIR: '../data/sessions',
  CONFIG_FILE: '../data/config.json',
  HISTORY_FILE: '../data/message-history.json',
  OP_LOG_FILE: '../data/operation-log.json',
  SERVER_LOG_FILE: '../data/server-log.json'
};

const DEFAULT_CONFIG = {
  telegram: { apiId: 0, apiHash: '' },
  filters: {
    keywords: [],
    excludeKeywords: [],
    regex: [],
    caseSensitive: false,
    mediaTypes: ['text', 'photo', 'document'],
    ignoreService: true,
    ignoreForwarded: false,
    ignoreReplies: false,
    minLength: 0,
    maxLength: 4096
  },
  accounts: [],
  forwardServers: [],
  inboundWebhooks: [],
  ui: {
    autoScroll: true,
    showFiltered: true,
    maxLogEntries: 500
  }
};

const DEFAULT_PROXY = {
  enabled: true,
  type: 'socks5',
  host: '192.168.31.165',
  port: 7890,
  username: '',
  password: ''
};

const CONNECTION_STATE = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  WAITING_CODE: 'waiting_code',
  WAITING_2FA: 'waiting_password',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

const ERROR_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

const LOG_LEVEL = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
};

module.exports = {
  PATH,
  DEFAULT_CONFIG,
  DEFAULT_PROXY,
  CONNECTION_STATE,
  ERROR_SEVERITY,
  LOG_LEVEL
};