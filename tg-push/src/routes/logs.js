/**
 * src/routes/logs.js — 日志 API 路由
 */

const express = require('express');
const router = express.Router();
const configManager = require('../config');
const state = require('../state');

router.get('/history', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(10, parseInt(req.query.pageSize, 10) || 20));
  const filter = req.query.filter;
  const accountFilter = req.query.account;

  let messages = [...state.messageHistory];

  if (accountFilter) {
    messages = messages.filter(m => m.accountId === accountFilter);
  }

  if (filter && filter !== 'all') {
    messages = messages.filter(m => m.forward?.status === filter);
  }

  const total = messages.length;
  const start = (page - 1) * pageSize;
  const pagedMessages = messages.slice(start, start + pageSize);

  res.json({
    success: true,
    data: {
      items: pagedMessages,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    }
  });
});

router.delete('/history', (req, res) => {
  state.messageHistory.length = 0;
  saveHistoryToFile();
  res.json({ success: true, message: '历史已清空' });
});

function saveHistoryToFile() {
  const fs = require('fs');
  const path = require('path');
  const HISTORY_FILE = path.join(__dirname, '../../data/message-history.json');
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFile(HISTORY_FILE, JSON.stringify(state.messageHistory, null, 2), (err) => {
    if (err) console.error('[History] 保存失败:', err.message);
  });
}

router.get('/', (req, res) => {
  try {
    const {
      type = '',
      level = '',
      status = '',
      search = '',
      page = 1,
      pageSize = 50
    } = req.query;

    const pageNum = parseInt(page, 10);
    const pageSizeNum = Math.min(200, Math.max(10, parseInt(pageSize, 10)));
    let allLogs = [];

    if (type === 'all' || type === 'message') {
      state.messageHistory.forEach(msg => {
        const logLevel = msg.forward?.status === 'success' ? 'info' :
          msg.forward?.status === 'skipped' ? 'warn' : 'error';
        allLogs.push({
          id: msg.id || Date.now() + Math.random(),
          type: 'message',
          timestamp: msg.timestamp || Date.now(),
          level: logLevel,
          status: msg.forward?.status === 'success' ? 'forwarded' :
            msg.forward?.status === 'skipped' ? 'skipped' : 'failed',
          content: msg.content?.text || msg.text || '',
          listenerName: msg.source?.name || msg.listenerName || '',
          accountId: msg.accountId,
          accountName: msg.accountName,
          error: msg.forward?.error || msg.error || ''
        });
      });
    }

    if (type === 'all' || type === 'operation' || type === 'system') {
      state.operationLogs.forEach(op => {
        const isSystem = op.action === 'system';
        if (type === 'system' && !isSystem) return;
        if (type === 'operation' && isSystem) return;

        allLogs.push({
          id: Date.now() + Math.random(),
          type: isSystem ? 'system' : 'operation',
          timestamp: op.timestamp,
          level: op.level || 'info',
          action: op.action,
          detail: op.detail
        });
      });

      if (type === 'all' || type === 'system') {
        state.serverLogs.forEach(log => {
          allLogs.push({
            id: log.id,
            type: 'system',
            timestamp: log.timestamp,
            level: log.level,
            action: 'system',
            detail: log.message
          });
        });
      }
    }

    allLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (level && level !== 'all') {
      allLogs = allLogs.filter(log => log.level === level);
    }

    if (status && status !== 'all') {
      allLogs = allLogs.filter(log => log.type !== 'message' || log.status === status);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      allLogs = allLogs.filter(log => {
        const content = log.content || log.detail || log.action || log.message || '';
        return content.toLowerCase().includes(searchLower);
      });
    }

    const total = allLogs.length;
    const start = (pageNum - 1) * pageSizeNum;
    const end = start + pageSizeNum;
    const pagedLogs = allLogs.slice(start, end);

    res.json({
      success: true,
      data: {
        items: pagedLogs,
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total,
          totalPages: Math.ceil(total / pageSizeNum)
        }
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/export', (req, res) => {
  try {
    const {
      format = 'json',
      type = 'all',
      level = 'all',
      status = 'all',
      search = ''
    } = req.query;

    let allLogs = [];

    if (type === 'all' || type === 'message') {
      state.messageHistory.forEach(msg => {
        const logLevel = msg.forward?.status === 'success' ? 'info' :
          msg.forward?.status === 'skipped' ? 'warn' : 'error';
        allLogs.push({
          type: 'message',
          timestamp: msg.timestamp || Date.now(),
          level: logLevel,
          status: msg.forward?.status === 'success' ? 'forwarded' :
            msg.forward?.status === 'skipped' ? 'skipped' : 'failed',
          content: msg.content?.text || msg.text || '',
          listenerName: msg.source?.name || msg.listenerName || '',
          accountId: msg.accountId,
          accountName: msg.accountName,
          error: msg.forward?.error || msg.error || ''
        });
      });
    }

    if (type === 'all' || type === 'operation' || type === 'system') {
      state.operationLogs.forEach(op => {
        const isSystem = op.action === 'system';
        if (type === 'system' && !isSystem) return;
        if (type === 'operation' && isSystem) return;

        allLogs.push({
          type: isSystem ? 'system' : 'operation',
          timestamp: op.timestamp,
          level: op.level || 'info',
          action: op.action,
          detail: op.detail
        });
      });

      if (type === 'all' || type === 'system') {
        state.serverLogs.forEach(log => {
          allLogs.push({
            type: 'system',
            timestamp: log.timestamp,
            level: log.level,
            action: 'system',
            detail: log.message
          });
        });
      }
    }

    allLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (level && level !== 'all') {
      allLogs = allLogs.filter(log => log.level === level);
    }
    if (status && status !== 'all') {
      allLogs = allLogs.filter(log => log.type !== 'message' || log.status === status);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      allLogs = allLogs.filter(log => {
        const content = log.content || log.detail || log.action || '';
        return content.toLowerCase().includes(searchLower);
      });
    }

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tg-push-logs-${new Date().toISOString().slice(0, 10)}.csv"`);

      const headers = ['时间', '类型', '级别', '内容/详情'];
      const csvLines = [headers.join(',')];

      allLogs.forEach(log => {
        const time = new Date(log.timestamp).toLocaleString('zh-CN');
        const typeText = log.type === 'message' ? '消息' : log.type === 'system' ? '系统' : '操作';
        const levelText = log.level === 'info' ? '信息' : log.level === 'warn' ? '警告' : '错误';
        const content = log.type === 'message' ? log.content : log.detail || log.action;
        csvLines.push([
          `"${time}"`,
          typeText,
          levelText,
          `"${(content || '').replace(/"/g, '""')}"`
        ].join(','));
      });

      res.send('\uFEFF' + csvLines.join('\n'));
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tg-push-logs-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json({
        exportDate: new Date().toISOString(),
        totalLogs: allLogs.length,
        logs: allLogs
      });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/operation-logs', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 50;

  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedLogs = [...state.operationLogs].reverse().slice(start, end);

  res.json({
    success: true,
    data: {
      items: pagedLogs,
      pagination: {
        page,
        pageSize,
        total: state.operationLogs.length,
        totalPages: Math.ceil(state.operationLogs.length / pageSize)
      }
    }
  });
});

router.delete('/operation-logs', (req, res) => {
  state.operationLogs.length = 0;
  saveOpLogToFile();
  res.json({ success: true, message: '操作日志已清空' });
});

function saveOpLogToFile() {
  const fs = require('fs');
  const path = require('path');
  const OP_LOG_FILE = path.join(__dirname, '../../data/operation-log.json');
  fs.mkdirSync(path.dirname(OP_LOG_FILE), { recursive: true });
  fs.writeFile(OP_LOG_FILE, JSON.stringify(state.operationLogs, null, 2), (err) => {
    if (err) console.error('[OpLog] 保存失败:', err.message);
  });
}

module.exports = router;