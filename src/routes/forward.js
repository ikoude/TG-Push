/**
 * src/routes/forward.js — 转发测试与统计 API 路由
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware');
const Forwarder = require('../services/forwarder');
const state = require('../state');
const { ensureForwarder } = require('./forward-servers');

router.post('/test', asyncHandler(async (req, res) => {
  const { serverId, url, token } = req.body;
  let fwd;

  if (serverId) {
    fwd = state.forwarders.get(serverId);
    if (!fwd) {
      fwd = ensureForwarder(serverId);
    }
  } else if (url && token) {
    fwd = new Forwarder({ type: 'magicpush', url, token, name: '临时测试' });
  } else {
    return res.status(400).json({ success: false, error: '需要提供 serverId 或 url+token' });
  }

  const result = await fwd.test();
  res.json({ success: true, data: result });
}));

router.get('/stats', (req, res) => {
  try {
    const stats = {
      totalReceived: 0,
      totalForwarded: 0,
      totalSkipped: 0,
      totalFailed: 0,
      byServer: {}
    };

    for (const [serverId, fwd] of state.forwarders) {
      const s = fwd.getStats();
      stats.totalReceived += s.totalReceived;
      stats.totalForwarded += s.totalForwarded;
      stats.totalSkipped += s.totalSkipped;
      stats.totalFailed += s.totalFailed;
      stats.byServer[serverId] = s;
    }

    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('[API] GET /api/forward/stats 错误:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;