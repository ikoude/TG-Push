/**
 * src/routes/webhooks.js — 入站 Webhook API 路由
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware');
const configManager = require('../config');
const state = require('../state');

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

function updateWebhookStats(webhookId, success) {
  const webhook = configManager.getInboundWebhook(webhookId);
  if (!webhook) return;

  if (!webhook.stats) {
    webhook.stats = { messageCount: 0, errorCount: 0, lastReceivedAt: null };
  }

  webhook.stats.messageCount++;
  if (!success) {
    webhook.stats.errorCount++;
  }
  webhook.stats.lastReceivedAt = new Date().toISOString();

  configManager.updateInboundWebhook(webhookId, { stats: webhook.stats });
}

router.get('/', (req, res) => {
  try {
    const webhooks = configManager.getInboundWebhooks();
    res.json({ success: true, data: webhooks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const webhook = configManager.addInboundWebhook(req.body);
    res.json({ success: true, data: webhook });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const webhook = configManager.updateInboundWebhook(id, req.body);
    res.json({ success: true, data: webhook });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    configManager.deleteInboundWebhook(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/health', (req, res) => {
  try {
    const webhooks = configManager.getInboundWebhooks();
    const healthStatus = webhooks.map(webhook => {
      const forwardServer = configManager.getForwardServer(webhook.forwardTargetId);
      const forwarder = state.forwarders.get(webhook.forwardTargetId);

      return {
        id: webhook.id,
        name: webhook.name,
        enabled: webhook.enabled,
        status: webhook.enabled === false ? 'disabled' :
          !forwardServer ? 'server_missing' :
          forwardServer.enabled === false ? 'server_disabled' :
          !forwarder ? 'forwarder_not_initialized' : 'healthy',
        forwardServer: forwardServer ? {
          id: forwardServer.id,
          name: forwardServer.name,
          enabled: forwardServer.enabled
        } : null,
        stats: webhook.stats || {
          messageCount: 0,
          errorCount: 0,
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

router.post('/inbound/:token', asyncHandler(async (req, res) => {
  const token = decodeURIComponent(req.params.token);
  const webhooks = configManager.getInboundWebhooks();
  const webhook = webhooks.find(w => w.authKey === token);

  if (!webhook) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }

  if (webhook.enabled === false) {
    return res.status(403).json({ error: 'Webhook is disabled' });
  }

  const forwardServer = configManager.getForwardServer(webhook.forwardTargetId);
  if (!forwardServer || forwardServer.enabled === false) {
    return res.status(400).json({ error: 'Forward server not found or disabled' });
  }

  const forwarder = state.forwarders.get(webhook.forwardTargetId);
  if (!forwarder) {
    return res.status(400).json({ error: 'Forwarder not initialized' });
  }

  let message = '';
  if (webhook.msgFormat === 'json') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    message = body.text || body.message || body.content || JSON.stringify(body);
  } else if (webhook.msgFormat === 'markdown') {
    message = typeof req.body === 'string' ? req.body : req.body.text || req.body.message || JSON.stringify(req.body);
  } else {
    message = typeof req.body === 'string' ? req.body : req.body.text || req.body.message || JSON.stringify(req.body);
  }

  const forwardResult = await forwarder.send(`[Webhook:${webhook.name}]`, message);

  updateWebhookStats(webhook.id, forwardResult.success);
  updateForwardServerStats(webhook.forwardTargetId, forwardResult);

  if (forwardResult.success) {
    state.addOperationLog('webhook_message', `Webhook消息转发成功: ${webhook.name} → ${forwardServer.name}`, 'info');
    res.json({ success: true, message: 'Message forwarded' });
  } else {
    state.addOperationLog('webhook_message', `Webhook消息转发失败: ${webhook.name} → ${forwardServer.name} - ${forwardResult.error}`, 'error');
    res.status(500).json({ success: false, error: forwardResult.error });
  }
}));

module.exports = router;