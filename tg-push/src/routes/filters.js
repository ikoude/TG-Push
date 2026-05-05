/**
 * src/routes/filters.js — 过滤规则 API 路由
 */

const express = require('express');
const router = express.Router();
const configManager = require('../config');

router.get('/', (req, res) => {
  try {
    const config = configManager.get();
    const listenerId = req.query.listener;

    if (listenerId) {
      for (const acc of (config.accounts || [])) {
        const listener = (acc.listeners || []).find(l => l.id === listenerId);
        if (listener && listener.rules && Object.keys(listener.rules).length > 0) {
          return res.json({ success: true, data: listener.rules });
        }
      }
      return res.json({ success: true, data: {}, inheritsGlobal: true });
    }

    res.json({ success: true, data: config.filters || {} });
  } catch (err) {
    console.error('[API] GET /api/filters 错误:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/', (req, res) => {
  try {
    const config = configManager.get();
    const listenerId = req.query.listener;

    let body = req.body;
    if (body.includeKeywords || body.excludeKeywords || body.regexPatterns !== undefined) {
      body = {
        keywords: body.keywords || body.includeKeywords || [],
        excludeKeywords: body.excludeKeywords || [],
        regex: body.regex !== undefined ? body.regex : (body.regexPatterns || []),
        caseSensitive: body.caseSensitive ?? false,
        mediaTypes: body.mediaTypes || body.allowedMediaTypes || ['text', 'photo', 'document'],
        ignoreService: body.ignoreService !== undefined ? body.ignoreService : (body.ignoreServiceMsgs ?? true),
        ignoreForwarded: !!body.ignoreForwarded,
        ignoreReplies: !!body.ignoreReplies,
        minLength: parseInt(body.minLength, 10) || 0,
        maxLength: parseInt(body.maxLength, 10) || 4096,
      };
    }

    if (listenerId) {
      for (const acc of (config.accounts || [])) {
        if (!acc.listeners) continue;
        const index = acc.listeners.findIndex(l => l.id === listenerId);
        if (index !== -1) {
          if (!acc.listeners[index].rules) acc.listeners[index].rules = {};
          acc.listeners[index].rules = { ...body };
          configManager.save(config);
          return res.json({ success: true, data: acc.listeners[index].rules });
        }
      }
      return res.status(404).json({ success: false, error: '未找到该监听源' });
    }

    config.filters = { ...(config.filters || {}), ...body };
    configManager.save(config);
    res.json({ success: true, data: config.filters });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;