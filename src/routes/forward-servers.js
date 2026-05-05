/**
 * src/routes/forward-servers.js — 转发服务器 API 路由
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware');
const configManager = require('../config');
const state = require('../state');

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

router.get('/', (req, res) => {
  const servers = configManager.getForwardServers();
  const safe = servers.map(s => ({
    ...s,
    token: s.token ? '******' : '',
    headers: s.headers ? Object.fromEntries(
      Object.entries(s.headers).map(([k]) => [k, '******'])
    ) : {}
  }));
  res.json({ success: true, data: safe });
});

router.post('/', (req, res) => {
  try {
    const server = configManager.addForwardServer(req.body);
    ensureForwarder(server.id);
    state.addOperationLog('forward_server_create', `创建转发服务器: ${server.name} (${server.type})`, 'info');
    res.json({ success: true, data: server });
  } catch (err) {
    state.addOperationLog('forward_server_create', `创建转发服务器失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const server = configManager.updateForwardServer(id, req.body);
    if (!server) {
      state.addOperationLog('forward_server_update', `更新转发服务器失败: 未找到服务器 ${id}`, 'error');
      return res.status(404).json({ success: false, error: '未找到该服务器' });
    }
    ensureForwarder(id);
    state.addOperationLog('forward_server_update', `更新转发服务器: ${server.name}`, 'info');
    res.json({ success: true, data: server });
  } catch (err) {
    state.addOperationLog('forward_server_update', `更新转发服务器失败: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const server = configManager.getForwardServer(id);
  const serverName = server?.name || id;
  state.forwarders.delete(id);
  configManager.removeForwardServer(id);
  state.addOperationLog('forward_server_delete', `删除转发服务器: ${serverName}`, 'info');
  res.json({ success: true });
});

router.get('/health', (req, res) => {
  try {
    const servers = configManager.getForwardServers();
    const healthStatus = servers.map(server => {
      const forwarder = state.forwarders.get(server.id);
      return {
        id: server.id,
        name: server.name,
        type: server.type,
        enabled: server.enabled,
        status: server.enabled === false ? 'disabled' :
          !forwarder ? 'forwarder_not_initialized' : 'healthy',
        stats: server.stats || {
          totalReceived: 0,
          totalForwarded: 0,
          totalSkipped: 0,
          totalFailed: 0,
          lastReceivedAt: null
        },
        lastCheckedAt: new Date().toISOString()
      };
    });
    res.json({ success: true, data: healthStatus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.ensureForwarder = ensureForwarder;