/**
 * config.js — 配置管理模块 v2
 * 
 * 支持多账户（accounts[]）+ 多转发服务器（forwardServers[]）
 * 向后兼容旧版 config.json（telegram / listeners / magicPush 平铺结构）
 * 自动迁移：首次加载时将旧结构转换为新结构
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

// 默认配置（新结构）
const DEFAULT_CONFIG = {
  // 全局 Telegram API 凭证（所有账户的默认值）
  telegram: {
    apiId: 0,
    apiHash: '',
  },

  // 全局过滤规则（作为账户级规则的默认继承）
  filters: {
    keywords: [],
    excludeKeywords: [],
    regex: [],
    caseSensitive: false,
    mediaTypes: ['text', 'photo', 'document'],
    ignoreService: true,
    ignoreForwarded: false,
    ignoreReplies: false,
    minLength: 0,
    maxLength: 4096
  },

  // 账户列表
  accounts: [],

  // 转发服务器列表
  forwardServers: [],

  // 入站 Webhook 列表
  inboundWebhooks: [],

  // UI 配置
  ui: {
    autoScroll: true,
    showFiltered: true,
    maxLogEntries: 500
  }
};

/**
 * 默认代理配置模板
 */
const DEFAULT_PROXY = {
  enabled: true,
  type: 'socks5',
  host: '192.168.31.165',
  port: 7890,
  username: '',
  password: ''
};

class ConfigManager {
  constructor() {
    this._config = null;
    this._ensureDataDir();
    this._ensureSessionsDir();
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  _ensureSessionsDir() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  // ========== 读写 ==========

  load() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(raw);

        // 检测是否为旧版配置，需要迁移
        if (this._isLegacyConfig(parsed)) {
          console.log('[Config] 检测到旧版配置，正在迁移...');
          this._config = this._migrateLegacy(parsed);
          this.save(); // 立即保存迁移后的结构
          console.log('[Config] 迁移完成 ✓');
        } else {
          this._config = this._mergeDefaults(parsed, DEFAULT_CONFIG);
        }
      } else {
        this._config = { ...DEFAULT_CONFIG };
        this.save();
      }
    } catch (err) {
      console.error('[Config] 读取失败，使用默认配置:', err.message);
      this._config = { ...DEFAULT_CONFIG };
    }
    return this._config;
  }

  save(config) {
    if (config) {
      this._config = config;
    }
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this._config, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      console.error('[Config] 保存失败:', err.message);
      return { success: false, error: err.message };
    }
  }

  get() {
    if (!this._config) {
      this.load();
    }
    return JSON.parse(JSON.stringify(this._config));
  }

  update(partial) {
    this._config = this._deepMerge(this._config || {}, partial);
    return this.save();
  }

  // ========== 账户操作 ==========

  /**
   * 获取所有账户
   */
  getAccounts() {
    const config = this.get();
    return config.accounts || [];
  }

  /**
   * 按 ID 获取单个账户
   */
  getAccount(accountId) {
    const accounts = this.getAccounts();
    return accounts.find(a => a.id === accountId) || null;
  }

  /**
   * 添加账户
   */
  addAccount(accountData) {
    const config = this.get();
    if (!config.accounts) config.accounts = [];

    const account = {
      id: accountData.id || `acc_${Date.now()}`,
      name: accountData.name || '新账户',
      apiId: accountData.apiId || 0,
      apiHash: accountData.apiHash || '',
      proxy: accountData.proxy || { ...DEFAULT_PROXY },
      listeners: [],
      status: { state: 'idle' },
      createdAt: new Date().toISOString(),
      ...accountData
    };

    config.accounts.push(account);
    this.save(config);
    return account;
  }

  /**
   * 更新账户
   */
  updateAccount(accountId, updates) {
    const config = this.get();
    const index = config.accounts.findIndex(a => a.id === accountId);
    if (index === -1) return null;

    config.accounts[index] = { ...config.accounts[index], ...updates };
    this.save(config);
    return config.accounts[index];
  }

  /**
   * 删除账户（同时清理 session 文件和监听源）
   */
  removeAccount(accountId) {
    const config = this.get();
    config.accounts = (config.accounts || []).filter(a => a.id !== accountId);

    // 清理 session 文件
    const sessionPath = this.getSessionPath(accountId);
    if (fs.existsSync(sessionPath)) {
      try { fs.unlinkSync(sessionPath); } catch (e) { /* ignore */ }
    }

    this.save(config);
    return true;
  }

  // ========== Session 管理（多账户）==========

  /**
   * 获取指定账户的 session 文件路径
   */
  getSessionPath(accountId) {
    return path.join(SESSIONS_DIR, `${accountId}.session`);
  }

  /**
   * 读取 session 字符串
   */
  getSession(accountId) {
    const sessionPath = this.getSessionPath(accountId || 'default');
    try {
      if (fs.existsSync(sessionPath)) {
        return fs.readFileSync(sessionPath, 'utf-8').trim();
      }
    } catch (err) {
      console.error('[Config] 读取 Session 失败:', err.message);
    }
    return null;
  }

  /**
   * 保存 session 字符串
   */
  saveSession(accountId, sessionString) {
    try {
      const sessionPath = this.getSessionPath(accountId || 'default');
      fs.writeFileSync(sessionPath, sessionString.trim(), 'utf-8');
      return true;
    } catch (err) {
      console.error('[Config] 保存 Session 失败:', err.message);
      return false;
    }
  }

  /**
   * 删除 session（登出时用）
   */
  deleteSession(accountId) {
    const sessionPath = this.getSessionPath(accountId || 'default');
    try {
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath);
      }
      return true;
    } catch (err) {
      console.error('[Config] 删除 Session 失败:', err.message);
      return false;
    }
  }

  /**
   * 检查是否有有效 session
   */
  hasSession(accountId) {
    const session = this.getSession(accountId);
    return !!session && session.length > 10;
  }

  // ========== 转发服务器操作 ==========

  /**
   * 获取所有转发服务器
   */
  getForwardServers() {
    const config = this.get();
    return config.forwardServers || [];
  }

  /**
   * 按 ID 获取转发服务器
   */
  getForwardServer(serverId) {
    const servers = this.getForwardServers();
    return servers.find(s => s.id === serverId) || null;
  }

  /**
   * 添加转发服务器
   */
  addForwardServer(serverData) {
    // 防止 ****** 占位符被当成真实 token/secret 保存
    if (serverData.token === '******') delete serverData.token;
    if (serverData.secret === '******') delete serverData.secret;

    const config = this.get();
    if (!config.forwardServers) config.forwardServers = [];

    const server = {
      id: serverData.id || `srv_${Date.now()}`,
      name: serverData.name || '新服务器',
      type: serverData.type || 'magicpush', // magicpush | webhook | custom
      url: serverData.url || '',
      token: serverData.token || '',       // magicpush token 或 webhook secret
      // Webhook/Custom API 额外字段
      method: serverData.method || 'POST',  // HTTP 方法
      headers: serverData.headers || {},     // 自定义请求头
      bodyTemplate: serverData.bodyTemplate || '', // 自定义 body 模板
      // 通用配置
      rateLimit: serverData.rateLimit || 2,
      retryMax: serverData.retryMax || 3,
      retryDelays: serverData.retryDelays || [5000, 15000, 60000],
      enabled: serverData.enabled !== false,
      // 统计信息
      stats: serverData.stats || {
        totalReceived: 0,
        totalForwarded: 0,
        totalSkipped: 0,
        totalFailed: 0,
        lastReceivedAt: null
      },
      ...serverData
    };

    config.forwardServers.push(server);
    this.save(config);
    return server;
  }

  /**
   * 更新转发服务器
   */
  updateForwardServer(serverId, updates) {
    const config = this.get();
    const index = config.forwardServers.findIndex(s => s.id === serverId);
    if (index === -1) return null;

    // 防止 ****** 占位符被当成真实 token 保存
    if (updates.token === '******') {
      delete updates.token;
    }

    config.forwardServers[index] = { ...config.forwardServers[index], ...updates };
    this.save(config);
    return config.forwardServers[index];
  }

  /**
   * 删除转发服务器
   */
  removeForwardServer(serverId) {
    const config = this.get();
    config.forwardServers = (config.forwardServers || []).filter(s => s.id !== serverId);
    this.save(config);
    return true;
  }

  // ========== 入站 Webhook 操作 ==========

  /**
   * 获取所有入站 Webhook
   */
  getInboundWebhooks() {
    const config = this.get();
    return config.inboundWebhooks || [];
  }

  /**
   * 按 ID 获取入站 Webhook
   */
  getInboundWebhook(webhookId) {
    const webhooks = this.getInboundWebhooks();
    return webhooks.find(w => w.id === webhookId) || null;
  }

  /**
   * 添加入站 Webhook
   */
  addInboundWebhook(webhookData) {
    const config = this.get();
    if (!config.inboundWebhooks) config.inboundWebhooks = [];

    const webhook = {
      id: webhookData.id || `wh_${Date.now()}`,
      name: webhookData.name || '新 Webhook',
      forwardTargetId: webhookData.forwardTargetId || '', // 关联的转发服务器ID
      authType: webhookData.authType || 'none', // none | api_key | bearer
      authKey: webhookData.authKey || '',
      msgFormat: webhookData.msgFormat || 'text', // text | json | markdown
      enabled: webhookData.enabled !== false,
      createdAt: new Date().toISOString(),
      ...webhookData
    };

    config.inboundWebhooks.push(webhook);
    this.save(config);
    return webhook;
  }

  /**
   * 更新入站 Webhook
   */
  updateInboundWebhook(webhookId, updates) {
    const config = this.get();
    const index = (config.inboundWebhooks || []).findIndex(w => w.id === webhookId);
    if (index === -1) return null;

    // 防止 ****** 占位符被当成真实密钥保存
    if (updates.authKey === '******') {
      delete updates.authKey;
    }

    config.inboundWebhooks[index] = { ...config.inboundWebhooks[index], ...updates };
    this.save(config);
    return config.inboundWebhooks[index];
  }

  /**
   * 删除入站 Webhook
   */
  deleteInboundWebhook(webhookId) {
    const config = this.get();
    config.inboundWebhooks = (config.inboundWebhooks || []).filter(w => w.id !== webhookId);
    this.save(config);
    return true;
  }

  // ========== 监听源操作（账户级别） ==========

  /**
   * 获取某个账户的监听源列表
   */
  getAccountListeners(accountId) {
    const account = this.getAccount(accountId);
    return account ? (account.listeners || []) : [];
  }

  /**
   * 获取所有账户的所有监听源（扁平化，带 accountId 标记）
   */
  getAllListeners() {
    const accounts = this.getAccounts();
    const result = [];
    for (const acc of accounts) {
      for (const listener of (acc.listeners || [])) {
        result.push({ ...listener, _accountId: acc.id, _accountName: acc.name });
      }
    }
    return result;
  }

  // ========== 迁移逻辑 ==========

  /**
   * 检测是否为旧版配置（有 telegram / magicPush / listeners 等顶层字段）
   */
  _isLegacyConfig(config) {
    // 旧版配置没有 accounts 数组，且有 telegram/magicPush/listeners 字段
    return !Array.isArray(config.accounts) && (config.telegram || config.magicPush || config.listeners);
  }

  /**
   * 将旧版 config.json 结构迁移到新版
   * 
   * 旧结构:
   *   { telegram: { apiId, apiHash, proxy }, listeners: [...], magicPush: {...}, filters: {...} }
   * 新结构:
   *   { accounts: [{ id, name, apiId, apiHash, proxy, listeners: [] }], forwardServers: [...], filters: {...} }
   */
  _migrateLegacy(legacy) {
    const newConfig = { ...DEFAULT_CONFIG };

    // 1. 迁移 Telegram 凭证 → 全局配置 + 默认账户
    if (legacy.telegram) {
      const tg = legacy.telegram;
      // 设置全局 Telegram 凭证
      newConfig.telegram = {
        apiId: tg.apiId || 0,
        apiHash: tg.apiHash || '',
      };
      // 同时创建默认账户
      newConfig.accounts.push({
        id: 'acc_default',
        name: '主账户',
        apiId: tg.apiId || 0,
        apiHash: tg.apiHash || '',
        proxy: tg.proxy || { ...DEFAULT_PROXY },
        listeners: legacy.listeners || [],
        status: { state: 'idle' },
        createdAt: new Date().toISOString()
      });

      // 迁移旧的 session.txt → sessions/acc_default.session
      try {
        const oldSessionPath = path.join(DATA_DIR, 'session.txt');
        if (fs.existsSync(oldSessionPath)) {
          const sessionContent = fs.readFileSync(oldSessionPath, 'utf-8').trim();
          if (sessionContent.length > 10) {
            const newPath = this.getSessionPath('acc_default');
            fs.writeFileSync(newPath, sessionContent, 'utf-8');
            console.log(`[Migrate] Session 已迁移: ${oldSessionPath} → ${newPath}`);
          }
        }
      } catch (e) {
        console.warn('[Migrate] Session 迁移失败:', e.message);
      }
    }

    // 2. 迁移 Magic Push → 转发服务器
    if (legacy.magicPush) {
      const mp = legacy.magicPush;
      if (mp.url || mp.token) {
        newConfig.forwardServers.push({
          id: 'srv_magicpush_default',
          name: 'Magic Push',
          type: 'magicpush',
          url: mp.url || '',
          token: mp.token || '',
          rateLimit: mp.rateLimit || 2,
          retryMax: mp.retryMax || 3,
          retryDelays: mp.retryDelays || [5000, 15000, 60000],
          enabled: true
        });
      }
    }

    // 3. 保留全局过滤规则
    if (legacy.filters) {
      newConfig.filters = { ...DEFAULT_CONFIG.filters, ...legacy.filters };
    }

    // 4. 保留 UI 配置
    if (legacy.ui) {
      newConfig.ui = { ...DEFAULT_CONFIG.ui, ...legacy.ui };
    }

    // 5. 给所有监听源补上 forwardTargetId（指向默认 Magic Push）
    if (newConfig.accounts[0]) {
      const defaultServerId = newConfig.forwardServers[0]?.id || null;
      for (const listener of (newConfig.accounts[0].listeners || [])) {
        if (!listener.forwardTargetId) {
          listener.forwardTargetId = defaultServerId;
        }
      }
    }

    return newConfig;
  }

  // ========== 工具方法 ==========

  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        result[key] = this._deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  _mergeDefaults(config, defaults) {
    const result = { ...defaults };
    for (const key of Object.keys(config)) {
      if (
        config[key] !== null &&
        typeof config[key] === 'object' &&
        !Array.isArray(config[key]) &&
        defaults[key] &&
        typeof defaults[key] === 'object' &&
        !Array.isArray(defaults[key])
      ) {
        result[key] = this._mergeDefaults(config[key], defaults[key]);
      } else {
        result[key] = config[key];
      }
    }
    return result;
  }
}

// 单例导出
const configManager = new ConfigManager();
module.exports = configManager;
