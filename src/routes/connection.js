/**
 * src/routes/connection.js — 连接操作 API 路由
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware');
const configManager = require('../config');
const { TGClient } = require('../services/telegram-client');
const state = require('../state');

function getOrCreateTGClient(accountId) {
  let tgClient = state.tgClients.get(accountId);
  if (!tgClient) {
    tgClient = new TGClient(accountId);
    state.tgClients.set(accountId, tgClient);
    setupTGClientCallbacks(accountId, tgClient);
    console.log(`[TG] 创建客户端实例: ${accountId}`);
  }
  return tgClient;
}

function setupTGClientCallbacks(accountId, tgClient) {
  tgClient.onStatusChange((data) => {
    const payload = { ...data, accountId };
    state.broadcastSSE('status', payload);

    const acc = configManager.getAccount(accountId);
    if (acc) {
      const currentPhone = acc.phoneNumber || acc.phone || data.user?.phone || '';
      acc.status = { state: data.state, user: data.user, phoneNumber: currentPhone };
      configManager.updateAccount(accountId, { status: acc.status });
    }

    const accountName = acc?.name || accountId;
    switch (data.state) {
      case 'connecting':
        state.addOperationLog('system', `账户 ${accountName} 正在连接...`, 'info');
        break;
      case 'connected':
        const userDisplay = data.user ? `${data.user.firstName || ''} (@${data.user.username || 'unknown'})` : '';
        state.addOperationLog('system', `账户 ${accountName} 连接成功${userDisplay ? ' - ' + userDisplay : ''}`, 'info');
        break;
      case 'disconnected':
        state.addOperationLog('system', `账户 ${accountName} 已断开连接`, 'info');
        break;
      case 'error':
        state.addOperationLog('system', `账户 ${accountName} 连接错误: ${data.error || '未知错误'}`, 'error');
        break;
      case 'waiting_code':
        state.addOperationLog('system', `账户 ${accountName} 等待验证码输入`, 'info');
        break;
      case 'waiting_password':
        state.addOperationLog('system', `账户 ${accountName} 等待两步验证密码`, 'info');
        break;
    }

    if (data.state === 'connected' || data.state === 'connected') {
      try {
        const account = configManager.getAccount(accountId);
        if (account?.listeners) {
          let firstFwd = null;
          for (const listener of account.listeners) {
            if (listener.forwardTargetId && listener.enabled !== false) {
              const fwd = ensureForwarder(listener.forwardTargetId);
              if (fwd) {
                if (!firstFwd) firstFwd = fwd;
                if (!tgClient.forwarders) tgClient.forwarders = new Map();
                tgClient.forwarders.set(listener.forwardTargetId, fwd);
              }
            }
          }
          if (firstFwd) {
            tgClient.setForwarder(firstFwd);
            console.log(`[TG:${accountId}] 已注入 ${tgClient.forwarders?.size || 1} 个转发器`);
          }
        }
      } catch (e) {
        console.warn(`[TG:${accountId}] Forwarder 注入失败:`, e.message);
      }
    }
  });

  tgClient.onMessage((msg) => {
    if (msg.forward && msg.forward.status !== 'skipped') {
      const account = configManager.getAccount(msg.accountId);
      if (account?.listeners) {
        const listener = account.listeners.find(l =>
          l.name === msg.source.name || String(l.chatId) === String(msg.source.chatId)
        );
        if (listener?.forwardTargetId) {
          updateForwardServerStats(listener.forwardTargetId, { success: msg.forward.status === 'success' });
        }
      }
    }
    state.addMessageToHistory(msg);
    state.broadcastSSE('message', msg);

    const logEntry = {
      level: msg.forward?.status === 'success' ? 'info' : msg.forward?.status === 'skipped' ? 'warn' : 'error',
      message: `[${msg.source.name}] ${msg.content.text?.slice(0, 50)}... → ${msg.forward?.status}`,
      timestamp: new Date().toISOString(),
      accountId,
      accountName: configManager.getAccount(accountId)?.name || accountId
    };
    state.broadcastSSE('log', logEntry);
  });
}

function ensureForwarder(serverId) {
  const config = configManager.getForwardServer(serverId);
  if (!config) return null;

  let fwd = state.forwarders.get(serverId);
  if (fwd) {
    fwd.updateConfig(config);
  } else {
    const Forwarder = require('../services/forwarder');
    fwd = new Forwarder(config);
    state.forwarders.set(serverId, fwd);
    console.log(`[Forwarder] 初始化: ${config.name} (${config.type})`);
  }
  return fwd;
}

function updateForwardServerStats(serverId, result) {
  const server = configManager.getForwardServer(serverId);
  if (!server) return;

  const forwarder = state.forwarders.get(serverId);
  const currentStats = forwarder ? forwarder.getStats() : null;

  if (currentStats) {
    const updatedStats = {
      ...server.stats,
      ...currentStats,
      lastReceivedAt: new Date().toISOString()
    };
    configManager.updateForwardServer(serverId, { stats: updatedStats });
  }
}

router.post('/connect', asyncHandler(async (req, res) => {
  const { accountId, apiId, apiHash, proxy } = req.body;
  const targetAccountId = accountId || req.query.account || 'acc_default';

  if (apiId || apiHash || proxy) {
    const updates = {};
    if (apiId) updates.apiId = parseInt(apiId, 10);
    if (apiHash) updates.apiHash = apiHash;
    if (proxy) updates.proxy = proxy;
    configManager.updateAccount(targetAccountId, updates);
  }

  const account = configManager.getAccount(targetAccountId);
  if (!account) {
    return res.status(404).json({ success: false, error: '账户不存在' });
  }

  const tgClient = getOrCreateTGClient(targetAccountId);
  const result = await tgClient.connect({
    apiId: account.apiId,
    apiHash: account.apiHash,
    proxy: account.proxy
  });

  res.json({ success: true, data: { ...result, accountId: targetAccountId } });
}));

router.post('/send-code', asyncHandler(async (req, res) => {
  const { phoneNumber, accountId } = req.body;
  const targetAccountId = accountId || req.query.account || 'acc_default';

  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: '手机号不能为空' });
  }

  const tgClient = state.tgClients.get(targetAccountId);
  if (!tgClient) {
    return res.status(400).json({ success: false, error: '请先连接该账户' });
  }

  const result = await tgClient.sendCode(phoneNumber);
  res.json({ success: true, data: result });
}));

router.post('/sign-in', asyncHandler(async (req, res) => {
  const { code, phoneCodeHash, password, accountId } = req.body;
  const targetAccountId = accountId || req.query.account || 'acc_default';

  const tgClient = state.tgClients.get(targetAccountId);
  if (!tgClient) {
    return res.status(400).json({ success: false, error: '未找到该账户连接' });
  }

  if (password !== undefined) {
    const result = await tgClient.submitPassword(password);
    return res.json({ success: true, data: result });
  }

  if (code !== undefined) {
    const result = await tgClient.signIn(code, phoneCodeHash || '');
    return res.json({ success: true, data: result });
  }

  res.status(400).json({ success: false, error: '需要提供 code 或 password 参数' });
}));

router.post('/disconnect', asyncHandler(async (req, res) => {
  const { clearSession, accountId } = req.body;
  const targetAccountId = accountId || req.query.account || 'acc_default';
  const tgClient = state.tgClients.get(targetAccountId);

  if (!tgClient) {
    return res.json({ success: true, data: { message: '该账户未连接' } });
  }

  const result = await tgClient.disconnect(clearSession === true);
  state.tgClients.delete(targetAccountId);
  res.json({ success: true, data: result });
}));

router.get('/check-reachability', asyncHandler(async (req, res) => {
  const accountId = req.query.account;
  let proxyConfig = null;

  if (accountId) {
    const account = configManager.getAccount(accountId);
    proxyConfig = account?.proxy || null;
  }

  const tempClient = new TGClient('__reachability_check__');
  const result = await tempClient.checkReachability(proxyConfig);
  res.json({ success: true, data: result });
}));

router.post('/check-reachability', asyncHandler(async (req, res) => {
  const proxyConfig = req.body?.proxy || null;
  const tempClient = new TGClient('__reachability_check__');
  const result = await tempClient.checkReachability(proxyConfig);
  res.json({ success: true, data: result });
}));

router.get('/dialogs', asyncHandler(async (req, res) => {
  const accountId = req.query.account || 'acc_default';
  const limit = parseInt(req.query.limit, 10) || 100;
  const tgClient = state.tgClients.get(accountId);

  if (!tgClient) {
    return res.status(400).json({ success: false, error: '该账户未连接' });
  }

  const dialogs = await tgClient.getDialogs(limit);
  res.json({ success: true, data: dialogs });
}));

module.exports = router;
module.exports.setupTGClientCallbacks = setupTGClientCallbacks;
module.exports.getOrCreateTGClient = getOrCreateTGClient;
module.exports.ensureForwarder = ensureForwarder;
module.exports.updateForwardServerStats = updateForwardServerStats;