/**
 * src/services/init-manager.js — 初始化管理模块
 */

const fs = require('fs');
const path = require('path');
const configManager = require('../config');

const DATA_DIR = path.join(__dirname, '../../data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const MESSAGE_HISTORY_FILE = path.join(DATA_DIR, 'message-history.json');
const OP_LOG_FILE = path.join(DATA_DIR, 'operation-log.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.txt');

function deleteDir(dirPath) {
  if (!fs.existsSync(dirPath)) return true;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      deleteDir(filePath);
    } else {
      fs.unlinkSync(filePath);
    }
  }
  fs.rmdirSync(dirPath);
  return true;
}

function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function clearAccountData() {
  const result = {
    success: true,
    deletedFiles: [],
    errors: []
  };

  try {
    if (fs.existsSync(SESSIONS_DIR)) {
      const sessionFiles = fs.readdirSync(SESSIONS_DIR);
      deleteDir(SESSIONS_DIR);
      result.deletedFiles.push(`sessions/ (${sessionFiles.length} files)`);
    }

    if (deleteFile(SESSION_FILE)) {
      result.deletedFiles.push('session.txt');
    }

    const config = configManager.get();
    if (config.accounts && config.accounts.length > 0) {
      config.accounts = [];
      configManager.save(config);
      result.deletedFiles.push('accounts in config.json');
    }

  } catch (error) {
    result.success = false;
    result.errors.push(`清除账户数据失败: ${error.message}`);
  }

  return result;
}

function clearLogs() {
  const result = {
    success: true,
    deletedFiles: [],
    errors: []
  };

  try {
    if (deleteFile(MESSAGE_HISTORY_FILE)) {
      result.deletedFiles.push('message-history.json');
    }

    if (deleteFile(OP_LOG_FILE)) {
      result.deletedFiles.push('operation-log.json');
    }

  } catch (error) {
    result.success = false;
    result.errors.push(`清除日志失败: ${error.message}`);
  }

  return result;
}

function restoreConfig() {
  const result = {
    success: true,
    restored: false,
    errors: []
  };

  const defaultConfig = {
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
      maxLogEntries: 500,
      theme: 'light',
      themeColor: 'indigo',
      sidebarExpanded: true,
      autoScrollLogs: true,
      showFilteredMessages: false
    }
  };

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    configManager.load();
    result.restored = true;
  } catch (error) {
    result.success = false;
    result.errors.push(`还原配置失败: ${error.message}`);
  }

  return result;
}

function performFullInit() {
  const results = {
    accountData: clearAccountData(),
    logs: clearLogs(),
    config: restoreConfig(),
    overallSuccess: false
  };

  results.overallSuccess =
    results.accountData.success &&
    results.logs.success &&
    results.config.success;

  return results;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function getDataStatus() {
  return {
    hasAccounts: fs.existsSync(SESSIONS_DIR) && fs.readdirSync(SESSIONS_DIR).length > 0,
    hasLogs: fs.existsSync(MESSAGE_HISTORY_FILE),
    hasConfig: fs.existsSync(CONFIG_FILE),
    hasOpLogs: fs.existsSync(OP_LOG_FILE)
  };
}

module.exports = {
  clearAccountData,
  clearLogs,
  restoreConfig,
  performFullInit,
  ensureDataDir,
  getDataStatus
};