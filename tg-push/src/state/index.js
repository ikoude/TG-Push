/**
 * src/state/index.js — 全局状态管理
 *
 * 集中管理应用运行时状态，避免状态分散在 server.js 中
 */

const { EventEmitter } = require('events');

class AppState extends EventEmitter {
  constructor() {
    super();
    this._init();
  }

  _init() {
    this.tgClients = new Map();
    this.forwarders = new Map();
    this.sseClients = new Set();
    this.messageHistory = [];
    this.operationLogs = [];
    this.serverLogs = [];
  }

  reset() {
    this._init();
    this.emit('reset');
  }
}

const state = new AppState();

const MAX_LOGS = {
  server: 1000,
  history: 500,
  operation: 1000
};

state.MAX_LOGS = MAX_LOGS;

state.addServerLog = (level, message, timestamp = Date.now()) => {
  const logEntry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp,
    level: level.toLowerCase(),
    message: String(message),
    type: 'server'
  };

  state.serverLogs.unshift(logEntry);
  if (state.serverLogs.length > MAX_LOGS.server) {
    state.serverLogs.pop();
  }

  return logEntry;
};

state.addMessageToHistory = (msg) => {
  state.messageHistory.push(msg);
  if (state.messageHistory.length > MAX_LOGS.history) {
    state.messageHistory.shift();
  }
  return msg;
};

state.addOperationLog = (action, detail = '', level = 'info') => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action,
    detail,
    level
  };
  state.operationLogs.push(logEntry);
  if (state.operationLogs.length > MAX_LOGS.operation) {
    state.operationLogs.shift();
  }
  return logEntry;
};

state.broadcastSSE = (event, data) => {
  const payload = JSON.stringify(data);
  for (const client of state.sseClients) {
    try {
      client.write(`event: ${event}\ndata: ${payload}\n\n`);
    } catch (e) {
      // 客户端可能已断开
    }
  }
};

module.exports = state;