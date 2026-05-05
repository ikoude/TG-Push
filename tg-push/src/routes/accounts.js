/**
 * src/routes/accounts.js — 账户管理 API 路由
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware');
const configManager = require('../config');
const state = require('../state');

function getTGClient(accountId) {
  return state.tgClients.get(accountId);
}

function getEnrichedAccounts() {
  return configManager.getAccounts().map(acc => {
    const tgClient = state.tgClients.get(acc.id);
    const listeners = configManager.getAccountListeners(acc.id) || [];
    return {
      ...acc,
      apiHash: acc.apiHash ? '******' : '',
      phone: acc.phone ? '******' : '',
      proxy: acc.proxy ? { ...acc.proxy, password: acc.proxy.password ? '******' : '' } : {},
      runtimeStatus: tgClient ? tgClient.getStatus() : { state: 'idle' },
      hasSession: configManager.hasSession(acc.id),
      listeners: listeners
    };
  });
}

router.get('/', (req, res) => {
  try {
    res.json({ success: true, accounts: getEnrichedAccounts() });
  } catch (err) {
    console.error('[API] GET /api/accounts 错误:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const data = req.body;
    const account = configManager.addAccount(data);
    state.addOperationLog('account_create', `创建账户: ${account.name || account.id}`, 'info');
    res.json({ success: true, data: account });
  } catch (err) {
    state.addOperationLog('account_create', `创建账户失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    delete req.body.apiHash;
    const account = configManager.updateAccount(id, req.body);
    if (!account) {
      return res.status(404).json({ success: false, error: '未找到该账户' });
    }
    state.addOperationLog('account_update', `更新账户: ${account.name || account.id}`, 'info');
    res.json({ success: true, data: account });
  } catch (err) {
    state.addOperationLog('account_update', `更新账户失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const account = configManager.getAccount(id);
  const accountName = account?.name || id;

  const tgClient = state.tgClients.get(id);
  if (tgClient) {
    await tgClient.disconnect(false);
    state.tgClients.delete(id);
  }

  configManager.removeAccount(id);
  state.addOperationLog('account_delete', `删除账户: ${accountName}`, 'info');
  res.json({ success: true });
}));

module.exports = router;