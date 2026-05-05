/**
 * src/routes/listeners.js — 监听源 API 路由
 */

const express = require('express');
const router = express.Router();
const configManager = require('../config');

router.get('/', (req, res) => {
  try {
    const accountId = req.query.account;

    if (accountId) {
      const listeners = configManager.getAccountListeners(accountId);
      res.json({ success: true, data: listeners || [] });
    } else {
      const all = configManager.getAllListeners();
      res.json({ success: true, data: all });
    }
  } catch (err) {
    console.error('[API] GET /api/listeners 错误:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const listener = req.body;
    const targetAccountId = listener.accountId || req.query.account || 'acc_default';

    listener.id = listener.id || `listener_${Date.now()}`;
    listener.enabled = listener.enabled !== false;
    if (!listener.forwardTargetId) {
      const servers = configManager.getForwardServers();
      listener.forwardTargetId = servers.find(s => s.enabled !== false)?.id || null;
    }

    const config = configManager.get();
    const accIndex = config.accounts.findIndex(a => a.id === targetAccountId);
    if (accIndex === -1) {
      return res.status(404).json({ success: false, error: '目标账户不存在' });
    }

    const account = config.accounts[accIndex];
    if (!account.listeners) account.listeners = [];

    const exists = account.listeners.find(l => l.chatId === listener.chatId);
    if (exists) {
      return res.status(409).json({ success: false, error: '该聊天已在监听列表中' });
    }

    account.listeners.push(listener);
    configManager.save(config);
    res.json({ success: true, data: listener });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const config = configManager.get();
  const id = decodeURIComponent(req.params.id);

  for (const acc of (config.accounts || [])) {
    if (!acc.listeners) continue;
    const index = acc.listeners.findIndex(l => l.id === id);
    if (index !== -1) {
      Object.assign(acc.listeners[index], req.body);
      configManager.save(config);
      return res.json({ success: true, data: acc.listeners[index] });
    }
  }

  res.status(404).json({ success: false, error: '未找到该监听源' });
});

router.delete('/:id', (req, res) => {
  const config = configManager.get();
  const id = decodeURIComponent(req.params.id);

  for (const acc of (config.accounts || [])) {
    if (acc.listeners) {
      const beforeLen = acc.listeners.length;
      acc.listeners = acc.listeners.filter(l => l.id !== id);
      if (acc.listeners.length < beforeLen) {
        configManager.save(config);
        return res.json({ success: true });
      }
    }
  }

  res.status(404).json({ success: false, error: '未找到该监听源' });
});

module.exports = router;