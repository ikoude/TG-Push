/**
 * src/routes/sse.js — SSE 流式 API 路由
 */

const express = require('express');
const router = express.Router();
const configManager = require('../config');
const state = require('../state');

router.get('/messages/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);

  for (const [accountId, tgClient] of state.tgClients) {
    const status = tgClient.getStatus();
    res.write(`event: status\ndata: ${JSON.stringify({ ...status, accountId })}\n\n`);
  }

  state.sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      state.sseClients.delete(res);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    state.sseClients.delete(res);
  });
});

router.get('/events', (req, res) => {
  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });

    if (res.flushHeaders) {
      res.flushHeaders();
    } else if (res.flush) {
      res.flush();
    }

    const sendEvent = (eventName, data) => {
      try {
        const dataStr = JSON.stringify(data);
        res.write(`event: ${eventName}\ndata: ${dataStr}\n\n`);
        if (res.flush) res.flush();
        return true;
      } catch (e) {
        console.error('[SSE] 发送事件失败:', e.message);
        return false;
      }
    };

    sendEvent('connected', { time: new Date().toISOString() });

    if (state.tgClients.size === 0) {
      sendEvent('status', { type: 'connection_status', accountId: null, data: { state: 'disconnected' }, accountName: null });
    } else {
      for (const [accountId, tgClient] of state.tgClients) {
        const status = tgClient.getStatus();
        sendEvent('status', { type: 'connection_status', accountId, data: status, accountName: configManager.getAccount(accountId)?.name });
      }
    }

    state.sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
        if (res.flush) res.flush();
      } catch (e) {
        console.log('[SSE] 心跳发送失败，清理连接');
        clearInterval(heartbeat);
        state.sseClients.delete(res);
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      state.sseClients.delete(res);
    };

    req.on('close', cleanup);
    req.on('error', (err) => {
      console.log('[SSE] 连接错误:', err.message);
      cleanup();
    });
    res.on('error', (err) => {
      console.log('[SSE] 响应错误:', err.message);
      cleanup();
    });
  } catch (err) {
    console.error('[SSE] 初始化失败:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'SSE 连接失败' });
    }
  }
});

module.exports = router;