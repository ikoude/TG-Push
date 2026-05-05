/**
 * src/routes/status.js — 状态与配置 API 路由
 */

const express = require('express');
const router = express.Router();
const configManager = require('../config');
const state = require('../state');

router.get('/status', (req, res) => {
  try {
    const accountId = req.query.account;
    const config = configManager.get();

    if (accountId) {
      const account = configManager.getAccount(accountId);
      const tgClient = state.tgClients.get(accountId);

      res.json({
        success: true,
        data: {
          ...(tgClient ? tgClient.getStatus() : { state: account?.status?.state || 'idle' }),
          account: account ? { id: account.id, name: account.name } : null,
          hasSession: configManager.hasSession(accountId)
        }
      });
    } else {
      const activeCount = Array.from(state.tgClients.values())
        .filter(c => c.getStatus().state === 'connected').length;

      res.json({
        success: true,
        data: {
          state: 'multi',
          accountsTotal: (config.accounts || []).length,
          accountsActive: activeCount,
          serversTotal: (config.forwardServers || []).length,
          accounts: (config.accounts || []).map(acc => ({
            id: acc.id,
            name: acc.name,
            state: state.tgClients.get(acc.id)?.getStatus()?.state || acc.status?.state || 'idle',
            hasSession: configManager.hasSession(acc.id),
            user: state.tgClients.get(acc.id)?.getStatus()?.user || null
          }))
        }
      });
    }
  } catch (err) {
    console.error('[API] GET /api/status 错误:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/config', (req, res) => {
  try {
    const config = configManager.get();

    const safeConfig = {
      ...config,
      telegram: config.telegram ? {
        ...config.telegram,
        apiHash: config.telegram.apiHash ? '******' : '',
      } : {},
      accounts: (config.accounts || []).map(acc => ({
        ...acc,
        apiHash: acc.apiHash ? '******' : '',
        phone: acc.phone ? '******' : '',
        proxy: acc.proxy ? { ...acc.proxy, password: acc.proxy.password ? '******' : '', host: acc.proxy.host ? '******' : '' } : {}
      })),
      forwardServers: (config.forwardServers || []).map(s => ({
        ...s,
        token: s.token ? '******' : ''
      }))
    };

    res.json({ success: true, data: safeConfig });
  } catch (err) {
    console.error('[API] GET /api/config 错误:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/config', (req, res) => {
  try {
    const updates = req.body;

    if (updates.accounts) {
      for (const acc of updates.accounts) {
        delete acc.apiHash;
        if (acc.proxy) delete acc.proxy.password;
      }
    }
    if (updates.forwardServers) {
      for (const srv of updates.forwardServers) {
        delete srv.token;
      }
    }

    if (updates.settings) {
      const config = configManager.get();
      if (!config.settings) config.settings = {};
      config.settings = { ...config.settings, ...updates.settings };
      updates.settings = config.settings;
    }

    const result = configManager.update(updates);

    if (updates.forwardServers) {
      initAllForwarders();
    }

    res.json(result);
  } catch (err) {
    console.error('[API] PUT /api/config 错误:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

function initAllForwarders() {
  const servers = configManager.getForwardServers();
  const { ensureForwarder } = require('./forward-servers');
  for (const srv of servers) {
    if (srv.enabled !== false) {
      ensureForwarder(srv.id);
    }
  }
}

router.get('/stats', (req, res) => {
  res.json({
    success: true,
    stats: {
      received: state.messageHistory.length,
      forwarded: state.messageHistory.filter(m => m.forward?.status === 'success').length,
      skipped: state.messageHistory.filter(m => m.forward?.status === 'skipped').length,
      failed: state.messageHistory.filter(m => m.forward?.status === 'failed').length,
    }
  });
});

module.exports = router;