/**
 * server.js — Express HTTP 服务主入口 v3.1
 *
 * 多账户架构：
 *   - tgClients: Map<accountId, TGClient> 管理多个并行连接
 *   - forwarders: Map<serverId, Forwarder> 管理多个转发目标
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { TGClient } = require('./services/telegram-client');
const Forwarder = require('./services/forwarder');
const configManager = require('./config');
const initManager = require('./services/init-manager');
const state = require('./state');
const { registerRoutes } = require('./routes');
const { createCorsMiddleware } = require('./middleware');
const { overrideConsole, addListener, LogLevel, isProduction } = require('./utils/logger');

const ENV = process.env.NODE_ENV || (isProduction() ? 'production' : 'development');

const SERVER_LOG_FILE = path.join(__dirname, '../data/server-log.json');

function loadServerLogsFromFile() {
  try {
    if (fs.existsSync(SERVER_LOG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SERVER_LOG_FILE, 'utf-8'));
      if (Array.isArray(saved)) {
        state.serverLogs.push(...saved.slice(0, state.MAX_LOGS.server));
        console.info(`[ServerLog] 已加载 ${saved.length} 条服务端日志`);
      }
    }
  } catch (err) {
    console.error('[ServerLog] 加载失败:', err.message);
  }
}

function saveServerLogsToFile() {
  try {
    fs.writeFileSync(SERVER_LOG_FILE, JSON.stringify(state.serverLogs.slice(0, state.MAX_LOGS.server)), 'utf-8');
  } catch (err) {
    console.error('[ServerLog] 保存失败:', err.message);
  }
}

let serverLogSaveTimer = null;

function addServerLog(level, message, timestamp = Date.now()) {
  const logEntry = state.addServerLog(level, message, timestamp);
  state.broadcastSSE('server_log', logEntry);
  clearTimeout(serverLogSaveTimer);
  serverLogSaveTimer = setTimeout(saveServerLogsToFile, 2000);
}

const HISTORY_FILE = path.join(__dirname, '../data/message-history.json');
const OP_LOG_FILE = path.join(__dirname, '../data/operation-log.json');

function saveHistoryToFile() {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFile(HISTORY_FILE, JSON.stringify(state.messageHistory, null, 2), (err) => {
    if (err) console.error('[History] 保存失败:', err.message);
  });
}

function loadHistoryFromFile() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const saved = JSON.parse(data);
      if (Array.isArray(saved)) {
        state.messageHistory.push(...saved);
        console.info(`[History] 已加载 ${saved.length} 条消息记录`);
      }
    }
  } catch (err) {
    console.error('[History] 加载失败:', err.message);
  }
}

function saveOpLogToFile() {
  fs.mkdirSync(path.dirname(OP_LOG_FILE), { recursive: true });
  fs.writeFile(OP_LOG_FILE, JSON.stringify(state.operationLogs, null, 2), (err) => {
    if (err) console.error('[OpLog] 保存失败:', err.message);
  });
}

function loadOpLogFromFile() {
  try {
    if (fs.existsSync(OP_LOG_FILE)) {
      const data = fs.readFileSync(OP_LOG_FILE, 'utf8');
      const saved = JSON.parse(data);
      if (Array.isArray(saved)) {
        state.operationLogs.push(...saved);
        console.info(`[OpLog] 已加载 ${saved.length} 条操作记录`);
      }
    }
  } catch (err) {
    console.error('[OpLog] 加载失败:', err.message);
  }
}

function ensureForwarder(serverId) {
  const config = configManager.getForwardServer(serverId);
  if (!config) return null;

  let fwd = state.forwarders.get(serverId);
  if (fwd) {
    fwd.updateConfig(config);
  } else {
    fwd = new Forwarder(config);
    state.forwarders.set(serverId, fwd);
    console.info(`[Forwarder] 初始化: ${config.name} (${config.type})`);
  }
  return fwd;
}

function initAllForwarders() {
  const servers = configManager.getForwardServers();
  for (const srv of servers) {
    if (srv.enabled !== false) {
      ensureForwarder(srv.id);
    }
  }
}

function getOrCreateTGClient(accountId) {
  let tgClient = state.tgClients.get(accountId);
  if (!tgClient) {
    tgClient = new TGClient(accountId);
    state.tgClients.set(accountId, tgClient);
    setupTGClientCallbacks(accountId, tgClient);
    console.info(`[TG] 创建客户端实例: ${accountId}`);
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

    if (data.state === 'connected') {
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
            console.info(`[TG:${accountId}] 已注入 ${tgClient.forwarders?.size || 1} 个转发器`);
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
  });
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

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

const app = express();
const PORT = process.env.PORT || 3210;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(createCorsMiddleware(ENV, ALLOWED_ORIGINS));

overrideConsole();

addListener((entry) => {
  addServerLog(entry.levelName.toLowerCase(), entry.message);
});

registerRoutes(app);

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.info('');
  console.info('╔══════════════════════════════════════════╗');
  console.info('║       TG·Push v3.1 已启动            ║');
  console.info(`║  环境: ${ENV.padEnd(32)}║`);
  console.info('╠══════════════════════════════════════════╣');
  console.info(`║  地址: http://localhost:${PORT}              ║`);
  console.info('║                                          ║');
  console.info('║  按 Ctrl+C 停止服务                       ║');
  console.info('╚══════════════════════════════════════════╝');
  console.info('');

  loadHistoryFromFile();
  loadOpLogFromFile();
  loadServerLogsFromFile();
  initAllForwarders();

  setTimeout(async () => {
    const cfg = configManager.get();
    const settings = cfg.settings || { autoConnect: true, autoListen: true };

    if (!settings.autoConnect) {
      console.info('[Auto] 自动连接已禁用，请在设置中开启');
      return;
    }

    const accounts = configManager.getAccounts();
    for (const acc of accounts) {
      if (configManager.hasSession(acc.id) && acc.apiId && acc.apiHash) {
        console.info(`[Auto] 发现账户「${acc.name}」(${acc.id}) 的 Session，尝试自动重连...`);
        try {
          const tgClient = getOrCreateTGClient(acc.id);
          await tgClient.connect({
            apiId: acc.apiId,
            apiHash: acc.apiHash,
            proxy: acc.proxy
          });
        } catch (err) {
          console.warn(`[Auto] 账户「${acc.name}」自动重连失败（可手动在 UI 上重新连接）:`, err.message);
        }
      }
    }
  }, 1500);
});

module.exports = { app, getOrCreateTGClient, ensureForwarder };