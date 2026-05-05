/**
 * src/routes/init.js — 初始化管理 API 路由
 */

const express = require('express');
const router = express.Router();
const initManager = require('../services/init-manager');
const configManager = require('../config');
const state = require('../state');

router.get('/status', (req, res) => {
  try {
    const status = initManager.getDataStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/clear-accounts', (req, res) => {
  try {
    for (const [accountId, client] of state.tgClients) {
      try { client.disconnect(); } catch (e) {}
    }
    state.tgClients.clear();

    const result = initManager.clearAccountData();
    if (result.success) {
      state.addOperationLog('init_clear_accounts', '清除所有账户数据', 'info');
    } else {
      state.addOperationLog('init_clear_accounts', '清除账户数据失败: ' + (result.errors?.[0] || '未知错误'), 'error');
    }
    res.json(result);
  } catch (error) {
    state.addOperationLog('init_clear_accounts', '清除账户数据异常: ' + error.message, 'error');
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/clear-logs', (req, res) => {
  try {
    const result = initManager.clearLogs();
    state.messageHistory.length = 0;
    state.operationLogs.length = 0;
    if (result.success) {
      state.addOperationLog('init_clear_logs', '清除所有日志数据', 'info');
    } else {
      state.addOperationLog('init_clear_logs', '清除日志失败: ' + (result.errors?.[0] || '未知错误'), 'error');
    }
    res.json(result);
  } catch (error) {
    state.addOperationLog('init_clear_logs', '清除日志异常: ' + error.message, 'error');
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/restore-config', (req, res) => {
  try {
    const result = initManager.restoreConfig();
    if (result.success) {
      configManager.load();
      state.addOperationLog('init_restore_config', '还原系统配置至默认状态', 'info');
    } else {
      state.addOperationLog('init_restore_config', '还原配置失败: ' + (result.errors?.[0] || '未知错误'), 'error');
    }
    res.json(result);
  } catch (error) {
    state.addOperationLog('init_restore_config', '还原配置异常: ' + error.message, 'error');
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/full', (req, res) => {
  try {
    for (const [accountId, client] of state.tgClients) {
      try { client.disconnect(); } catch (e) {}
    }
    state.tgClients.clear();
    state.forwarders.clear();

    const result = initManager.performFullInit();

    if (result.overallSuccess) {
      state.messageHistory.length = 0;
      state.operationLogs.length = 0;
      configManager.load();
      state.addOperationLog('init_full', '执行完整初始化，系统已恢复至初始状态', 'info');
    } else {
      const errors = [
        ...(result.accountData.errors || []),
        ...(result.logs.errors || []),
        ...(result.config.errors || [])
      ];
      state.addOperationLog('init_full', '完整初始化部分失败: ' + errors.join('; '), 'warn');
    }

    res.json(result);
  } catch (error) {
    state.addOperationLog('init_full', '完整初始化异常: ' + error.message, 'error');
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;