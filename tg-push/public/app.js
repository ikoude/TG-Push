// ============================================================
// TG·Push - 前端应用逻辑（多账户 + 多转发服务器 版本）
// ============================================================

// ==================== 常量定义 ====================
const MAX_LOGS = 500;
const MAX_MESSAGE_LENGTH = 4096;
const DIALOGS_PAGE_SIZE = 50;

// ==================== 全局状态 ====================
const AppState = {
  // 账户列表
  accounts: [],
  // 当前选中的账户 ID（用于添加监听源等操作）
  activeAccountId: null,
  // 转发服务器列表
  forwardServers: [],
  // 入站 Webhook 列表
  inboundWebhooks: [],
  // 用户权限配置
  permissions: {
    webhook: true, // 是否启用Webhook功能
  },
  // 监听源（已合并所有账户的，带 accountId 字段）
  allListeners: [],
  // 当前过滤后的监听源
  listeners: [],
  // 过滤规则
  filters: getDefaultFilters(),
  // 规则作用范围
  ruleScope: 'global',
  // 当前按监听源编辑规则的 ID
  editingListenerId: null,

  // 对话列表（当前账户的）
  dialogs: [],

  // 消息日志
  logs: [],
  maxLogs: MAX_LOGS,

  // 统计
  stats: { received: 0, forwarded: 0, skipped: 0, failed: 0 },

  // 连接状态
  connectionStatus: { state: 'disconnected', user: null },

  // SSE
  eventSource: null,

  // 全局设置
  settings: {
    autoConnect: true,
    autoListen: true
  },
};

// 检查是否有权限访问Webhook功能
function hasWebhookPermission() {
  return AppState.permissions?.webhook !== false;
}

function getDefaultFilters() {
  return {
    includeKeywords: [],
    excludeKeywords: [],
    regexPatterns: [],
    allowedMediaTypes: ['text', 'photo', 'document'],
    ignoreForwarded: false,
    ignoreReplies: false,
    ignoreServiceMsgs: true,
    minLength: 0,
    maxLength: MAX_MESSAGE_LENGTH,
  };
}

// ==================== localStorage 工具函数 ====================
const STORAGE_KEYS = {
  LOGS: 'tg_push_message_logs',
  STATS: 'tg_push_stats',
  ACTIVE_TAB: 'tg_push_active_tab',
};

function saveLogsToStorage() {
  try {
    const toStore = AppState.logs.slice(0, MAX_LOGS);
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(toStore));
  } catch (e) {
    console.warn('[Storage] 保存日志失败:', e);
  }
}

function loadLogsFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.LOGS);
    if (!data) return [];
    return JSON.parse(data);
  } catch (e) {
    console.warn('[Storage] 加载日志失败:', e);
    return [];
  }
}

function clearLogsFromStorage() {
  try {
    localStorage.removeItem(STORAGE_KEYS.LOGS);
  } catch (e) {
    console.warn('[Storage] 清空日志失败:', e);
  }
}

function saveStatsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(AppState.stats));
  } catch (e) {
    console.warn('[Storage] 保存统计失败:', e);
  }
}

function loadStatsFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.STATS);
    if (!data) return null;
    return JSON.parse(data);
  } catch (e) {
    console.warn('[Storage] 加载统计失败:', e);
    return null;
  }
}

function clearStatsFromStorage() {
  try {
    localStorage.removeItem(STORAGE_KEYS.STATS);
  } catch (e) {
    console.warn('[Storage] 清空统计失败:', e);
  }
}

function saveActiveTab(tabId) {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tabId);
  } catch (e) {
    console.warn('[Storage] 保存Tab状态失败:', e);
  }
}

function loadActiveTab() {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB);
  } catch (e) {
    console.warn('[Storage] 加载Tab状态失败:', e);
    return null;
  }
}

/** 去重函数 - 基于消息ID和时间戳判断重复 */
function deduplicateLogs(logs) {
  const seen = new Set();
  const result = [];
  for (const log of logs) {
    // 使用 id + timestamp 作为唯一键，如果都没有则使用索引
    const key = log.id ? `${log.id}` : (log.timestamp ? `${log.timestamp}` : `idx_${result.length}`);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(log);
    }
  }
  return result;
}

// ==================== 工具函数 ====================
/**
 * 生成唯一 ID
 * @returns {string} 36进制时间戳 + 随机字符串
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 封装 fetch API 调用
 * @param {string} path - API 路径
 * @param {object} [options={}] - fetch 选项
 * @returns {Promise<object>} 响应数据
 * @throws {Error} HTTP 错误时抛出
 */
async function api(path, options = {}) {
  // 设置默认超时时间（30 秒）
  const timeout = options.timeout || 30000;
  
  try {
    // 使用 AbortController 实现超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      // JSON 解析失败，返回空对象
    }
    
    if (!res.ok) {
      // 处理不同类型的错误
      let errorMsg = data.error || `HTTP ${res.status}`;
      
      if (res.status === 401) {
        errorMsg = '会话已过期，请重新登录';
      } else if (res.status === 408) {
        errorMsg = '请求超时，请稍后重试';
      } else if (res.status >= 500) {
        errorMsg = '服务器错误，请稍后重试';
      }
      
      throw new Error(errorMsg);
    }
    
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接');
    } else if (e.message.includes('Failed to fetch') || e.name === 'TypeError') {
      throw new Error('网络连接失败，请检查网络设置');
    }
    throw e;
  }
}

/**
 * 显示 Toast 提示
 * @param {string} message - 提示文本
 * @param {'info'|'success'|'warning'|'error'} [type='info'] - 类型
 * @param {number} [duration=3000] - 显示时长(ms)
 */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${message}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
}


// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  loadThemeFromStorage();
  
  try {
    await loadAllData();
    renderAccounts();
    renderForwardServers();
    renderDashboard();
    populateAccountFilters();
    initRulesUI();
    renderListeners();
    LogRenderer.init();
    updateLogStats();
    updateConnectionUI();
    connectSSE();
    startWebhookHealthCheck(30000);
    
    const savedTab = loadActiveTab();
    if (savedTab && savedTab !== 'dashboard') {
      switchTab(savedTab);
    }
  } catch (e) {
    console.error('[Init] 初始化失败:', e);
  }
});

async function loadAllData() {
  const [accountsData, serversData, webhooksData] = await Promise.all([
    api('/api/accounts'),
    api('/api/forward-servers'),
    api('/api/webhook').catch(() => ({ data: [] })),
  ]);
  AppState.accounts = accountsData.data || accountsData.accounts || [];
  AppState.forwardServers = serversData.data || [];
  AppState.inboundWebhooks = webhooksData.data || webhooksData.webhooks || [];

  // 合并所有账户的监听源
  rebuildAllListeners();

  // 如果有已连接的账户，设置默认活跃账户
  const connectedAcc = AppState.accounts.find(a =>
    a.status && a.status.state === 'connected'
  );
  if (connectedAcc) {
    AppState.activeAccountId = connectedAcc.id;
  } else if (AppState.accounts.length > 0) {
    AppState.activeAccountId = AppState.accounts[0].id;
  }

  // 加载规则、统计和消息历史
  try {
    const [rulesRes, statsRes, historyRes] = await Promise.all([
      api('/api/filters').catch(() => ({ filters: getDefaultFilters() })),
      api('/api/stats').catch(() => ({ stats: AppState.stats })),
      api('/api/messages/history?pageSize=100').catch(() => ({ data: [] })),
    ]);
    AppState.filters = rulesRes.filters || getDefaultFilters();
    
    // 优先使用后端统计数据
    if (statsRes.stats) {
      Object.assign(AppState.stats, statsRes.stats);
    } else {
      // 如果后端没有数据，尝试从 localStorage 加载
      const savedStats = loadStatsFromStorage();
      if (savedStats) {
        Object.assign(AppState.stats, savedStats);
      }
    }
    
    // 加载消息历史 - 优先使用后端数据，辅以localStorage
    const backendLogsData = Array.isArray(historyRes.data) ? historyRes.data : [];
    const backendLogs = backendLogsData.map(msg => ({
      timestamp: msg.timestamp || Date.now(),
      status: msg.forward?.status === 'success' ? 'forwarded' :
               msg.forward?.status === 'skipped' ? 'skipped' : 'failed',
      listenerName: msg.source?.name || msg.listenerName || '',
      content: msg.content?.text || msg.text || '',
      error: msg.forward?.error || msg.error || '',
      accountId: msg.accountId,
      accountName: msg.accountName,
      id: msg.id,
    }));
    
    const localLogs = loadLogsFromStorage();
    
    // 合并并去重 - 后端数据优先
    const allLogs = [...backendLogs, ...localLogs];
    const uniqueLogs = deduplicateLogs(allLogs);
    uniqueLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    AppState.logs = uniqueLogs.slice(0, MAX_LOGS);
    
    // 保存合并后的数据到localStorage
    saveLogsToStorage();
    
  } catch (e) { 
    // 加载失败时只使用localStorage数据
    console.warn('[Init] 加载数据失败，使用本地缓存:', e);
    AppState.logs = loadLogsFromStorage();
  }
}

/** 从所有账户重建扁平化的监听源列表 */
function rebuildAllListeners() {
  AppState.allListeners = [];
  for (const acc of AppState.accounts) {
    if (acc.listeners && Array.isArray(acc.listeners)) {
      for (const l of acc.listeners) {
        AppState.allListeners.push({ ...l, _accountId: acc.id, _accountName: acc.name || acc.id });
      }
    }
  }
  // 应用当前过滤器
  applyListenerFilter();
}


// ==================== Tab 切换 ====================
/**
 * 切换 Tab
 * @param {string} tabId - Tab ID
 */
function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${tabId}`);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });
  saveActiveTab(tabId);
}


// ==================== 账户管理 ====================

/** 渲染账户列表 */
function renderAccounts() {
  const container = document.getElementById('accounts-list');
  if (!container) return;
  const emptyEl = document.getElementById('accounts-empty');
  const countBadge = document.getElementById('account-count');

  if (!AppState.accounts.length) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    if (countBadge) countBadge.style.display = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (countBadge) {
    countBadge.textContent = AppState.accounts.length;
    countBadge.style.display = '';
  }

  let html = '<div class="account-grid">';
  for (const acc of AppState.accounts) {
    const status = acc.status || {};
    const state = status.state || 'disconnected';
    const listenerCount = (acc.listeners && acc.listeners.length) || 0;

    // 获取用户显示名
    let userDisplay = '';
    if (status.user) {
      if (typeof status.user === 'string') {
        userDisplay = status.user;
      } else if (typeof status.user === 'object' && status.user !== null) {
        // 优先显示 username（带@），其次 firstName+lastName，最后 id
        userDisplay = status.user.username || status.user.firstName || status.user.id || '';
      }
    }

    // 使用新的 AccountRenderer 渲染操作按钮
    const actionsHtml = AccountRenderer.renderCard(acc);

    // 构建设置面板 HTML
    const proxyEnabled = acc.proxy?.enabled ? 'checked' : '';
    const proxyType = acc.proxy?.type || 'socks5';
    const proxyHost = acc.proxy?.host || '';
    const proxyPort = acc.proxy?.port || '';

    let settingsPanelHtml = '<div class="account-card-settings" id="account-settings-' + escAttr(acc.id) + '" style="display:none;">';
    settingsPanelHtml += '<div class="account-settings-section">';
    settingsPanelHtml += '<div class="account-settings-section-title">基本信息</div>';
    settingsPanelHtml += '<div class="form-group form-group-sm">';
    settingsPanelHtml += '<label class="form-label">账户名称</label>';
    settingsPanelHtml += '<input type="text" class="form-input form-input-sm" id="acc-name-' + escAttr(acc.id) + '" value="' + escHtml(acc.name || '') + '">';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '<div class="form-group form-group-sm">';
    settingsPanelHtml += '<label class="form-label">API ID</label>';
    settingsPanelHtml += '<input type="text" class="form-input form-input-sm mono" id="acc-apiid-' + escAttr(acc.id) + '" value="' + escHtml(acc.apiId || '') + '">';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '<div class="form-group form-group-sm">';
    settingsPanelHtml += '<label class="form-label">API Hash</label>';
    settingsPanelHtml += '<input type="password" class="form-input form-input-sm mono" id="acc-apihash-' + escAttr(acc.id) + '" value="' + escHtml(acc.apiHash || '') + '">';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '</div>';

    settingsPanelHtml += '<div class="account-settings-section">';
    settingsPanelHtml += '<div class="account-settings-section-title">网络代理</div>';
    settingsPanelHtml += '<div class="flex items-center justify-between mb-3">';
    settingsPanelHtml += '<span class="text-sm text-secondary">启用代理</span>';
    settingsPanelHtml += '<label class="toggle toggle-sm">';
    settingsPanelHtml += '<input type="checkbox" id="acc-proxy-enabled-' + escAttr(acc.id) + '" ' + proxyEnabled + ' onchange="toggleAccountProxySettings(\'' + escAttr(acc.id) + '\')">';
    settingsPanelHtml += '<span class="toggle-track"></span>';
    settingsPanelHtml += '<span class="toggle-thumb"></span>';
    settingsPanelHtml += '</label>';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '<div id="acc-proxy-settings-' + escAttr(acc.id) + '"' + (acc.proxy?.enabled ? '' : ' style="display:none"') + '>';
    settingsPanelHtml += '<div class="grid grid-cols-3 gap-3">';
    settingsPanelHtml += '<div class="form-group form-group-sm">';
    settingsPanelHtml += '<label class="form-label text-xs">类型</label>';
    settingsPanelHtml += '<select class="form-select form-select-sm" id="acc-proxy-type-' + escAttr(acc.id) + '">';
    settingsPanelHtml += '<option value="socks5"' + (proxyType === 'socks5' ? ' selected' : '') + '>SOCKS5</option>';
    settingsPanelHtml += '<option value="http"' + (proxyType === 'http' ? ' selected' : '') + '>HTTP</option>';
    settingsPanelHtml += '</select>';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '<div class="form-group form-group-sm">';
    settingsPanelHtml += '<label class="form-label text-xs">地址</label>';
    settingsPanelHtml += '<input type="text" class="form-input form-input-sm" id="acc-proxy-host-' + escAttr(acc.id) + '" value="' + escHtml(proxyHost) + '">';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '<div class="form-group form-group-sm">';
    settingsPanelHtml += '<label class="form-label text-xs">端口</label>';
    settingsPanelHtml += '<input type="text" class="form-input form-input-sm" id="acc-proxy-port-' + escAttr(acc.id) + '" value="' + escHtml(proxyPort) + '">';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '</div>';

    settingsPanelHtml += '<div class="account-settings-actions">';
    settingsPanelHtml += '<button class="btn btn-secondary btn-sm" onclick="cancelAccountSettings(\'' + escAttr(acc.id) + '\')">取消</button>';
    settingsPanelHtml += '<button class="btn btn-primary btn-sm" onclick="saveAccountSettings(\'' + escAttr(acc.id) + '\')">保存设置</button>';
    settingsPanelHtml += '</div>';
    settingsPanelHtml += '</div>';

    html += '<div class="account-card" data-id="' + escAttr(acc.id) + '">';
    html += '<div class="account-card-header">';
    html += '<div class="account-card-info">';
    html += '<div class="account-card-name">' + escHtml(acc.name || '未命名账户') + '</div>';
    html += '<div class="account-card-meta">';
    html += (userDisplay ? '<span class="account-user">@' + escHtml(userDisplay) + '</span>' : '');
    html += '<span class="account-listener-count">' + listenerCount + ' 个监听源</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="flex items-center gap-2">';
    html += '<span class="tag ' + getAccountStatusTagClass(state) + '">' + getAccountStatusText(state) + '</span>';
    html += '<button class="btn btn-ghost btn-sm" onclick="toggleAccountSettings(\'' + escAttr(acc.id) + '\')" title="设置">'
      + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
    html += '</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="showEditAccountModal(\'' + escAttr(acc.id) + '\')" title="编辑">'
      + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    html += '</button>';
    html += '<button class="btn btn-ghost btn-sm text-error" onclick="deleteAccount(\'' + escAttr(acc.id) + '\')" title="删除">'
      + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    html += '</button>';
    html += '</div>';
    html += '</div>';
    html += '<!-- 快捷操作 -->';
    html += '<div class="account-card-actions">';
    html += actionsHtml;
    html += '</div>';
    html += settingsPanelHtml;
    html += '</div>';
  }
  html += '</div>';

  // 清空后重新填充（保留 empty-state 元素引用但隐藏它）
  container.innerHTML = html;
}

function getAccountStatusTagClass(state) {
  switch (state) {
    case 'connected': return 'tag-success';
    case 'connecting':
    case 'authenticating': return 'tag-warning';
    default: return 'tag-neutral';
  }
}

function getAccountStatusText(state) {
  switch (state) {
    case 'connected': return '已连接';
    case 'connecting': return '连接中';
    case 'authenticating': return '待登录';
    case 'error': return '错误';
    default: return '未连接';
  }
}

/** 显示添加账户 Modal */
function showAddAccountModal() {
  const editIdEl = document.getElementById('edit-account-id');
  const titleEl = document.getElementById('account-modal-title');
  const nameEl = document.getElementById('account-name');
  const apiIdEl = document.getElementById('account-api-id');
  const apiHashEl = document.getElementById('account-api-hash');
  const proxyEnabledEl = document.getElementById('account-proxy-enabled');
  const proxyTypeEl = document.getElementById('account-proxy-type');
  const proxyHostEl = document.getElementById('account-proxy-host');
  const proxyPortEl = document.getElementById('account-proxy-port');
  const proxyUsernameEl = document.getElementById('account-proxy-username');
  const proxyPasswordEl = document.getElementById('account-proxy-password');
  const saveBtnEl = document.getElementById('account-save-btn');
  
  if (!editIdEl || !titleEl || !nameEl || !saveBtnEl) return;

  editIdEl.value = '';
  titleEl.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:-2px;margin-right:6px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> 添加账户';
  nameEl.value = '';
  if (apiIdEl) apiIdEl.value = '';
  if (apiHashEl) apiHashEl.value = '';
  if (proxyEnabledEl) proxyEnabledEl.checked = true;
  if (proxyTypeEl) proxyTypeEl.value = 'socks5';
  if (proxyHostEl) proxyHostEl.value = '192.168.31.165';
  if (proxyPortEl) proxyPortEl.value = '7890';
  if (proxyUsernameEl) proxyUsernameEl.value = '';
  if (proxyPasswordEl) proxyPasswordEl.value = '';
  saveBtnEl.textContent = '保存并连接';
  
  // 重置 AccountModal 状态
  if (typeof AccountModal !== 'undefined') {
    AccountModal.reset();
  }
  
  showModal('account-modal');
}

/** 显示编辑账户 Modal */
function showEditAccountModal(id) {
  const acc = AppState.accounts.find(a => a.id === id);
  if (!acc) return;

  const editIdEl = document.getElementById('edit-account-id');
  const titleEl = document.getElementById('account-modal-title');
  const nameEl = document.getElementById('account-name');
  const apiIdEl = document.getElementById('account-api-id');
  const apiHashEl = document.getElementById('account-api-hash');
  const phoneEl = document.getElementById('account-phone');  // ✅ 新增
  const proxyEnabledEl = document.getElementById('account-proxy-enabled');
  const proxyTypeEl = document.getElementById('account-proxy-type');
  const proxyHostEl = document.getElementById('account-proxy-host');
  const proxyPortEl = document.getElementById('account-proxy-port');
  const proxyUsernameEl = document.getElementById('account-proxy-username');
  const proxyPasswordEl = document.getElementById('account-proxy-password');
  const saveBtnEl = document.getElementById('account-save-btn');
  
  if (!editIdEl || !titleEl || !nameEl || !saveBtnEl) return;

  editIdEl.value = id;
  titleEl.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:-2px;margin-right:6px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> 编辑账户';
  nameEl.value = acc.name || '';
  if (apiIdEl) apiIdEl.value = acc.apiId || '';
  if (apiHashEl) apiHashEl.value = acc.apiHash || '';
  if (phoneEl) phoneEl.value = acc.phoneNumber || acc.phone || '';  // ✅ 新增：设置已保存的手机号

  const proxy = acc.proxy || {};
  if (proxyEnabledEl) proxyEnabledEl.checked = !!proxy.enabled;
  if (proxyTypeEl) proxyTypeEl.value = proxy.type || 'socks5';
  if (proxyHostEl) proxyHostEl.value = proxy.host || '';
  if (proxyPortEl) proxyPortEl.value = proxy.port || '';
  if (proxyUsernameEl) proxyUsernameEl.value = proxy.username || '';
  if (proxyPasswordEl) proxyPasswordEl.value = proxy.password || '';
  
  saveBtnEl.textContent = '保存';
  showModal('account-modal');
}

/** 保存账户（新增或编辑） - 现在主要通过 AccountModal.save() 处理 */
async function saveAccount() {
  // 这个函数保留是为了向后兼容
  if (typeof AccountModal !== 'undefined') {
    await AccountModal.save();
  }
}

/** 切换账户设置面板的展开/收起 */
function toggleAccountSettings(accountId) {
  const settingsPanel = document.getElementById('account-settings-' + accountId);
  if (!settingsPanel) return;
  
  const isVisible = settingsPanel.style.display !== 'none';
  settingsPanel.style.display = isVisible ? 'none' : '';
  
  // 更新设置按钮状态
  const settingBtn = document.querySelector('.account-card[data-id="' + escAttr(accountId) + '"] .btn[title="设置"]');
  if (settingBtn) {
    settingBtn.classList.toggle('btn-active', !isVisible);
  }
}

/** 切换账户代理设置的显示/隐藏 */
function toggleAccountProxySettings(accountId) {
  const proxyEnabled = document.getElementById('acc-proxy-enabled-' + accountId);
  const proxySettings = document.getElementById('acc-proxy-settings-' + accountId);
  if (!proxyEnabled || !proxySettings) return;
  
  proxySettings.style.display = proxyEnabled.checked ? '' : 'none';
}

/** 取消账户设置 */
function cancelAccountSettings(accountId) {
  toggleAccountSettings(accountId);
}

/** 保存账户设置 */
async function saveAccountSettings(accountId) {
  try {
    const name = document.getElementById('acc-name-' + accountId)?.value || '';
    const apiId = document.getElementById('acc-apiid-' + accountId)?.value || '';
    const apiHash = document.getElementById('acc-apihash-' + accountId)?.value || '';
    const proxyEnabled = document.getElementById('acc-proxy-enabled-' + accountId)?.checked || false;
    const proxyType = document.getElementById('acc-proxy-type-' + accountId)?.value || 'socks5';
    const proxyHost = document.getElementById('acc-proxy-host-' + accountId)?.value || '';
    const proxyPort = document.getElementById('acc-proxy-port-' + accountId)?.value || '';

    const updateData = {
      name,
      apiId: apiId || undefined,
      apiHash: apiHash || undefined,
      proxy: proxyEnabled ? {
        enabled: true,
        type: proxyType,
        host: proxyHost,
        port: proxyPort ? parseInt(proxyPort) : undefined
      } : { enabled: false }
    };

    await api('/api/accounts/' + encodeURIComponent(accountId), {
      method: 'PUT',
      body: updateData
    });

    // 同步更新本地状态
    const acc = AppState.accounts.find(a => a.id === accountId);
    if (acc) {
      acc.name = name;
      if (apiId) acc.apiId = apiId;
      if (apiHash) acc.apiHash = apiHash;
      acc.proxy = updateData.proxy;
    }

    showToast('账户设置已保存', 'success');
    toggleAccountSettings(accountId);
    renderAccounts();
    renderDashAccounts();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

/** 删除账户 - 向后兼容包装 */
async function deleteAccount(id) {
  return AccountManager.delete(id);
}

/** 连接账户 - 向后兼容包装 */
async function connectAccount(id) {
  return AccountManager.connect(id);
}

/** 断开账户连接 - 向后兼容包装 */
async function disconnectAccount(id) {
  return AccountManager.disconnect(id);
}

/** 切换活跃账户（之前是跳转到监听源 tab，现在只在账户状态页面操作） */
function switchActiveAccount(id) {
  return AccountManager.setActiveAccount(id);
}

/** 关闭账户 Modal */
async function closeAccountModal() {
  if (typeof AccountModal !== 'undefined') {
    // 清理可能存在的临时账户
    await AccountModal.cleanupTempAccount();
    AccountModal.reset();
  }
  hideModal('account-modal');
}
async function onAccountModalOverlayClick(e) {
  if (e.target === e.currentTarget) await closeAccountModal();
}


// ==================== 监听源管理（多账户版）====================

/** 应用监听源筛选（按账户） */
function applyListenerFilter() {
  const filterVal = (document.getElementById('listener-account-filter') || {}).value;
  if (filterVal) {
    AppState.listeners = AppState.allListeners.filter(l => l._accountId === filterVal);
  } else {
    AppState.listeners = [...AppState.allListeners];
  }
}

/** 账户筛选变更 */
function onListenerAccountFilterChange(accountId) {
  AppState.activeAccountId = accountId || null;
  applyListenerFilter();
  renderListeners();
}

/** 渲染监听源列表（按账户分组显示） */
function renderListeners() {
  const container = document.getElementById('listeners-list');
  if (!container) return;
  const emptyEl = document.getElementById('listeners-empty');
  const summaryEl = document.getElementById('listeners-summary');
  const countBadge = document.getElementById('listener-count');

  // 更新计数
  const total = AppState.allListeners.length;
  if (summaryEl) summaryEl.textContent = `${total} 个`;
  if (countBadge) {
    if (total > 0) { countBadge.textContent = total; countBadge.style.display = ''; }
    else countBadge.style.display = 'none';
  }

  // 当前过滤后的列表
  const items = AppState.listeners;

  if (!items.length) {
    // 保留空状态元素，清空其他内容
    const children = container.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.id !== 'listeners-empty') child.remove();
    }
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  // 按 _accountId 分组
  const groups = {};
  for (const l of items) {
    const aid = l._accountId || 'unknown';
    if (!groups[aid]) groups[aid] = { name: l._accountName || aid, items: [] };
    groups[aid].items.push(l);
  }

  let html = '';
  for (const [aid, group] of Object.entries(groups)) {
    // 组标题
    html += '<div class="listener-group">';
    html += '  <div class="listener-group-header">';
    html += '    <span class="listener-group-name">' + escHtml(group.name) + '</span>';
    html += '    <span class="text-xs text-tertiary">' + group.items.length + ' 个</span>';
    html += '  </div>';
    html += '  <div class="listener-group-items">';

    for (const listener of group.items) {
      const fwdTarget = getForwardTargetName(listener.forwardTargetId);
      const enabled = !!listener.enabled;
      html += renderSingleListener(listener, fwdTarget, enabled);
    }

    html += '</div></div>';
  }

  container.innerHTML = html;
}

/** 渲染单条监听源 HTML */
function renderSingleListener(listener, fwdTargetName, enabled) {
  const iconHtml = getChatIconHtml(listener.entity, listener.name);
  const rules = listener.rules || {};
  const hasCustomRules = rules.includeKeywords?.length || rules.excludeKeywords?.length ||
                         rules.regexPatterns?.length || rules.ignoreForwarded ||
                         rules.ignoreReplies || (rules.minLength > 0) || (rules.maxLength < 4096);

  const lid = escAttr(listener.id);
  const laid = escAttr(listener._accountId);
  const lname = escHtml(listener.name);
  const lchatId = escHtml(formatChatId(listener.chatId, listener.entity));
  const entityLabel = getEntityLabel(listener.entity);
  const enabledClass = enabled ? 'tag-success' : 'tag-neutral';
  const enabledText = enabled ? '监听中' : '已暂停';
  let fwdHtml = '';
  if (fwdTargetName) {
    fwdHtml = '<span>·</span><span class="fwd-target-label">→ ' + escHtml(fwdTargetName) + '</span>';
  }
  let rulesTag = '';
  if (hasCustomRules) {
    rulesTag = '<span class="tag tag-primary" title="有自定义规则">规则</span>';
  }

  let html = '';
  html += '<div class="listener-item entryIn" data-id="' + lid + '" data-account="' + laid + '">';
  html += '  <div class="listener-item-main">';
  html += iconHtml;
  html += '    <label class="toggle">';
  html += '      <input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="toggleListenerEnabled(\'' + lid + '\', \'' + laid + '\')">';
  html += '      <span class="toggle-track"></span><span class="toggle-thumb"></span>';
  html += '    </label>';
  html += '    <div class="listener-item-info">';
  html += '      <div class="listener-item-top">';
  html += '        <span class="listener-item-name" id="name-' + lid + '">' + lname + '</span>';
  html += '        <span class="tag ' + enabledClass + '">' + enabledText + '</span>';
  html += rulesTag;
  html += '      </div>';
  html += '      <div class="listener-item-sub">';
  html += '        <span>ID: ' + lchatId + '</span><span>·</span><span>' + entityLabel + '</span>';
  html += fwdHtml;
  html += '      </div>';
  html += '    </div>';
  html += '  </div>';
  html += '  <div class="listener-item-actions">';
  html += '    <button class="btn btn-ghost btn-sm text-xs listener-item-btn" onclick="configListenerRules(\'' + lid + '\', \'' + laid + '\')" title="配置规则">规则</button>';
  html += '    <button class="btn btn-ghost btn-sm text-xs listener-item-btn" onclick="editListener(\'' + lid + '\', \'' + laid + '\')" title="编辑">编辑</button>';
  html += '    <button class="btn btn-ghost btn-sm text-error listener-item-btn icon-btn" onclick="removeListener(\'' + lid + '\', \'' + laid + '\')" title="移除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
  html += '  </div>';
  html += '</div>';

  return html;
}

function getForwardTargetName(targetId) {
  if (!targetId) return '';
  const server = AppState.forwardServers.find(s => s.id === targetId);
  return server ? server.name : targetId;
}

/** 增量更新单个监听源的 UI 状态 */
function updateListenerItemUI(id) {
  const itemEl = document.querySelector(`.listener-item[data-id="${id}"]`);
  if (!itemEl) return;

  const listener = AppState.allListeners.find(l => l.id === id);
  if (!listener) return;

  const checkbox = itemEl.querySelector('input[type="checkbox"]');
  if (checkbox) checkbox.checked = listener.enabled;

  const tags = itemEl.querySelector('.listener-item-top')?.querySelectorAll('.tag');
  if (tags && tags.length > 0) {
    tags[0].className = `tag ${listener.enabled ? 'tag-success' : 'tag-neutral'}`;
    tags[0].textContent = listener.enabled ? '监听中' : '已暂停';
  }
}

/** 切换监听源开关 */
async function toggleListenerEnabled(id, accountId) {
  const listener = AppState.allListeners.find(l => l.id === id);
  if (!listener) return;

  listener.enabled = !listener.enabled;
  try {
    await api(`/api/accounts/${encodeURIComponent(accountId)}/listeners/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { enabled: listener.enabled },
    });
  } catch (e) { /* ignore */ }

  // 同步更新账户中的 listeners 数组
  const acc = AppState.accounts.find(a => a.id === accountId);
  if (acc && acc.listeners) {
    const accListener = acc.listeners.find(l => l.id === id);
    if (accListener) {
      accListener.enabled = listener.enabled;
    }
  }

  // 只更新变化的元素，避免整个列表重建导致闪烁
  updateListenerItemUI(id);

  // 同时更新 dash 显示的统计数字
  const dashSummaryEl = document.getElementById('dash-route-summary');
  if (dashSummaryEl) dashSummaryEl.textContent = `${AppState.allListeners.length} 条路由`;
}

/** 显示添加监听源面板（先选账户再加载对话） */
function showAddListener() {
  // 如果没有活跃账户或账户没连上，提示用户
  if (!AppState.activeAccountId) {
    if (AppState.accounts.length === 0) {
      showToast('请先在「账户管理」中添加一个账户', 'warning');
      switchTab('accounts');
      return;
    }
    // 选第一个已连接的账户
    const connected = AppState.accounts.find(a => a.status && a.status.state === 'connected');
    if (connected) {
      AppState.activeAccountId = connected.id;
    } else {
      showToast('请先连接一个 Telegram 账户', 'warning');
      switchTab('accounts');
      return;
    }
  }

  const acc = AppState.accounts.find(a => a.id === AppState.activeAccountId);
  if (!acc || !acc.status || acc.status.state !== 'connected') {
    showToast(`账户「${acc?.name || ''}」未连接，请先连接`, 'warning');
    switchTab('accounts');
    return;
  }

  const dialogsCard = document.getElementById('dialogs-card');
  if (dialogsCard) dialogsCard.style.display = '';
  refreshDialogs();
}

function hideAddListener() {
  const dialogsCard = document.getElementById('dialogs-card');
  if (dialogsCard) dialogsCard.style.display = 'none';
}

/** 手动输入 Chat ID 添加监听源 */
async function addManualListener() {
  const input = document.getElementById('manual-chat-id');
  if (!input) return;

  const rawId = (input.value || '').trim();
  if (!rawId) {
    showToast('请输入 Chat ID', 'warning');
    input.focus();
    return;
  }

  let entityType = '';
  const typeSelect = document.getElementById('manual-entity-type');
  if (typeSelect && typeSelect.value) {
    entityType = typeSelect.value;
  }

  if (!entityType) {
    if (rawId.indexOf('-100') === 0) {
      entityType = 'supergroup';
    } else if (rawId.charAt(0) === '-') {
      entityType = 'group';
    } else {
      entityType = 'private';
    }
  }

  let displayName = 'Chat ' + rawId;
  if (entityType === 'supergroup') displayName = '超级群组 ' + rawId;
  else if (entityType === 'channel') displayName = '频道 ' + rawId;
  else if (entityType === 'group') displayName = '群组 ' + rawId;
  else if (entityType === 'private') displayName = '私聊 ' + rawId;
  else if (entityType === 'bot') displayName = '机器人 ' + rawId;

  input.value = '';

  await addListener(rawId, displayName, entityType);
}

/** 刷新对话列表（从指定账户加载） */
async function refreshDialogs() {
  if (!AppState.activeAccountId) return;

  const listEl = document.getElementById('dialogs-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="flex items-center justify-center p-5 text-secondary"><div class="spinner spinner-sm"></div><span class="ml-2">加载中...</span></div>';

  try {
    const res = await api(`/api/accounts/${encodeURIComponent(AppState.activeAccountId)}/dialogs`);
    const rawDialogs = res.data || res.dialogs || [];
    AppState.dialogs = (rawDialogs || []).map(function(d) {
      return {
        id: d.id,
        name: d.name || d.title || 'Unknown',
        entity: d.entity || d.type || 'unknown',
        accessHash: d.accessHash,
        unreadCount: d.unreadCount || 0
      };
    });
    _dialogPage = 0;
    renderDialogs();
  } catch (e) {
    listEl.innerHTML = '<div class="text-center p-5 text-error">加载失败: ' + escHtml(e.message) + '<br><button class="btn btn-sm btn-secondary mt-2" onclick="refreshDialogs()">重试</button></div>';
  }
}

// 分页状态
let _dialogPage = 0;

/** 渲染对话列表（支持分页） */
function renderDialogs() {
  const listEl = document.getElementById('dialogs-list');
  if (!listEl) return;
  const searchEl = document.getElementById('dialogs-search');
  const filterEl = document.getElementById('dialogs-filter');
  const search = searchEl ? (searchEl.value || '').toLowerCase() : '';
  let filterType = filterEl ? filterEl.value : 'all';
  if (!filterType) filterType = 'all';

  let filtered = AppState.dialogs;
  if (search) filtered = filtered.filter(function(d) { return (d.name || '').toLowerCase().includes(search); });
  if (filterType !== 'all') filtered = filtered.filter(function(d) { return d.entity === filterType; });

  if (!filtered.length) {
    listEl.innerHTML = '<div class="text-center p-5 text-tertiary text-sm">无匹配结果</div>';
    return;
  }

  const total = filtered.length;
  const maxPage = Math.ceil(total / DIALOGS_PAGE_SIZE);
  if (_dialogPage >= maxPage) _dialogPage = maxPage - 1;
  if (_dialogPage < 0) _dialogPage = 0;
  const start = _dialogPage * DIALOGS_PAGE_SIZE;
  const pageData = filtered.slice(start, start + DIALOGS_PAGE_SIZE);

  let html = '';
  for (let di = 0; di < pageData.length; di++) {
    const d = pageData[di];
    const exists = AppState.allListeners.some(function(l) { return String(l.chatId) === String(d.id); });
    const iconHtml = getChatIconHtml(d.entity, d.name);

    html += '<div class="dialog-item' + (exists ? ' disabled' : '') + '" data-chat-id="' + escAttr(d.id) + '" data-chat-name="' + escAttr(d.name) + '" data-entity="' + escAttr(d.entity) + '"' + (exists ? '' : ' onclick="handleDialogItemClick(this)"') + '>';
    html += '<div class="dialog-icon-wrap">' + iconHtml + '</div>';
    html += '<div class="dialog-info">';
    html += '<div class="dialog-name">' + escHtml(d.name) + '</div>';
    html += '<div class="dialog-meta">' + getEntityLabel(d.entity) + ' · ' + escHtml(formatChatId(d.id, d.entity)) + '</div>';
    html += '</div>';
    if (exists) {
      html += '<span class="tag tag-neutral" style="font-size:10px;">已添加</span>';
    } else {
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-success"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    }
    html += '</div>';
  }

  // 分页控制栏
  if (total > DIALOGS_PAGE_SIZE) {
    const showFrom = start + 1;
    const showTo = Math.min(start + DIALOGS_PAGE_SIZE, total);
    html += '<div class="dialogs-pagination" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--color-border-tertiary);">';
    html += '<span class="text-xs text-tertiary">显示 ' + showFrom + '-' + showTo + ' / 共 ' + total + ' 个</span>';
    html += '<div style="display:flex;gap:6px;">';
    if (_dialogPage > 0) {
      html += '<button class="btn btn-sm btn-secondary" onclick="_dialogPage--;renderDialogs()">上一页</button>';
    }
    if (_dialogPage < maxPage - 1) {
      html += '<button class="btn btn-sm btn-secondary" onclick="_dialogPage++;renderDialogs()">下一页</button>';
    }
    html += '</div></div>';
  }

  listEl.innerHTML = html;
}

/** 搜索/过滤对话 */
function filterDialogs() {
  renderDialogs();
}

/** 处理对话列表项点击（事件委托方式，避免 onclick 属性引号问题） */
function handleDialogItemClick(el) {
  const chatId = el.getAttribute('data-chat-id');
  const chatName = el.getAttribute('data-chat-name');
  const entity = el.getAttribute('data-entity');
  if (chatId && chatName && entity) {
    addListener(chatId, chatName, entity);
  }
}

/** 添加监听源（需要选择转发目标） */
async function addListener(chatId, name, entity) {
  if (!AppState.activeAccountId) {
    showToast('请先选择一个账户', 'warning');
    return;
  }

  // 如果没有转发服务器，允许先创建不绑定转发目标的路由
  let forwardTargetId = null;
  if (AppState.forwardServers.length > 1) {
    const names = AppState.forwardServers.map(s => `${s.name} (${s.type})`).join('\n');
    const choice = prompt(`选择转发目标服务器：\n${names}\n\n输入序号 (1-${AppState.forwardServers.length})，直接确定使用第 1 个：`);
    if (choice === null) return; // 用户取消
    const idx = parseInt(choice, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= AppState.forwardServers.length) {
      forwardTargetId = AppState.forwardServers[idx - 1].id;
    } else {
      forwardTargetId = AppState.forwardServers[0].id;
    }
  } else if (AppState.forwardServers.length === 1) {
    forwardTargetId = AppState.forwardServers[0].id;
  } else {
    const proceed = confirm('尚未配置任何渠道。是否继续创建不绑定转发目标的路由？\n\n创建后可随时在路由详情中编辑绑定目标。');
    if (!proceed) {
      switchTab('forward');
      return;
    }
  }

  try {
    const res = await api(`/api/accounts/${encodeURIComponent(AppState.activeAccountId)}/listeners`, {
      method: 'POST',
      body: { chatId, name, entity, forwardTargetId },
    });

    const newListener = res.data || res.listener;
    if (newListener) {
      // 同步更新账户中的 listeners 数组
      const acc = AppState.accounts.find(a => a.id === AppState.activeAccountId);
      if (acc) {
        if (!acc.listeners) acc.listeners = [];
        acc.listeners.push(newListener);
      }
      // 重新构建 allListeners 以确保一致性
      rebuildAllListeners();
      applyListenerFilter();
      renderListeners();
      renderDashRoutes();
      renderRoutes();
      updateRouteCount();
    }

    showToast(`已开始监听: ${name}`, 'success');
  } catch (e) {
    showToast(e.message || '添加失败', 'error');
  }
}

/** 移除监听源 */
async function removeListener(id, accountId) {
  const listener = AppState.allListeners.find(l => l.id === id);
  if (!listener) return;

  try {
    await api(`/api/accounts/${encodeURIComponent(accountId)}/listeners/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    
    // 同步更新账户中的 listeners 数组
    const acc = AppState.accounts.find(a => a.id === accountId);
    if (acc && acc.listeners) {
      acc.listeners = acc.listeners.filter(l => l.id !== id);
    }
    
    // 重新构建 allListeners 以确保一致性
    rebuildAllListeners();
    
    applyListenerFilter();
    renderListeners();
    renderDashRoutes();
    renderRoutes();
    updateRouteCount();
    
    showToast('已移除', 'success');
  } catch (e) {
    console.error('删除路由失败:', e);
    showToast(e.message || '移除失败', 'error');
  }
}

/** 编辑监听源名称（按钮触发 - 使用 prompt） */
function editListenerName(id, accountId) {
  const listener = AppState.allListeners.find(l => l.id === id);
  if (!listener) return;

  const newName = prompt('修改名称:', listener.name);
  if (!newName || !newName.trim()) return;

  saveListenerName(id, accountId, newName.trim());
}

/** 内联编辑名称（点击名称文字触发） */
function startInlineEditName(id, accountId) {
  const listener = AppState.allListeners.find(l => l.id === id);
  if (!listener) return;

  const nameEl = document.getElementById('name-' + id);
  if (!nameEl) return;

  // 如果已经在编辑状态，不重复触发
  if (nameEl.querySelector('input')) return;

  const currentName = listener.name;
  nameEl.innerHTML = '<input type="text" class="inline-name-input" value="' + escAttr(currentName) + '" id="inline-input-' + id + '">';
  const input = nameEl.querySelector('input');
  input.focus();
  input.select();

  // 回车保存
  input.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishInlineEdit(id, accountId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit(id, currentName);
    }
  });

  // 失焦保存
  input.addEventListener('blur', function() {
    // 延迟一点让 click 等事件先处理
    setTimeout(function() { finishInlineEdit(id, accountId); }, 100);
  });
}

/** 完成内联编辑并保存 */
function finishInlineEdit(id, accountId) {
  const input = document.getElementById('inline-input-' + id);
  if (!input) return;

  const newName = input.value.trim();
  const nameEl = document.getElementById('name-' + id);

  // 先移除输入框，恢复文字显示
  if (nameEl) {
    nameEl.innerHTML = escHtml(newName || '');
  }

  if (newName && newName !== '') {
    saveListenerName(id, accountId, newName);
  } else {
    // 名称清空时恢复原名
    const listener = AppState.allListeners.find(l => l.id === id);
    const nameEl2 = document.getElementById('name-' + id);
    if (nameEl2) nameEl2.innerHTML = escHtml((listener ? listener.name : '') || '');
  }
}

/** 取消内联编辑 */
function cancelInlineEdit(id, originalName) {
  const nameEl = document.getElementById('name-' + id);
  if (nameEl) {
    nameEl.innerHTML = escHtml(originalName || '');
  }
}

/** 保存监听源名称到后端 */
function saveListenerName(id, accountId, newName) {
  const listener = AppState.allListeners.find(l => l.id === id);
  if (!listener) return;

  const oldName = listener.name;
  listener.name = newName;

  // 同步更新账户中的 listeners 数组
  const acc = AppState.accounts.find(a => a.id === accountId);
  if (acc && acc.listeners) {
    const accListener = acc.listeners.find(l => l.id === id);
    if (accListener) {
      accListener.name = newName;
    }
  }

  // 立即更新 UI 显示（无论当前是文字还是输入框状态都更新）
  const nameEl = document.getElementById('name-' + id);
  if (nameEl) {
    // 如果里面还有 input 元素，替换为纯文本；否则直接改 textContent
    if (nameEl.querySelector('input')) {
      nameEl.innerHTML = escHtml(newName);
    } else {
      nameEl.textContent = newName;
    }
  }

  api('/api/accounts/' + encodeURIComponent(accountId) + '/listeners/' + encodeURIComponent(id), {
    method: 'PUT',
    body: { name: listener.name },
  }).catch(() => {
    listener.name = oldName;
    // 回滚账户中的数据
    if (acc && acc.listeners) {
      const accListener = acc.listeners.find(l => l.id === id);
      if (accListener) {
        accListener.name = oldName;
      }
    }
    const nameEl2 = document.getElementById('name-' + id);
    if (nameEl2) nameEl2.textContent = oldName;
    showToast('名称保存失败', 'error');
  });

  if (oldName !== newName) {
    showToast('名称已更新', 'success');
    renderDashRoutes();
    renderRoutes();
  }
}


// ==================== 过滤规则 ====================

/** 初始化规则 UI */
function initRulesUI() {
  // 检查页面是否有规则相关的 DOM 元素
  const hasRulesUI = document.getElementById('rule-ignore-forwarded');
  if (!hasRulesUI) return;

  renderTags('include', AppState.filters.includeKeywords);
  renderTags('exclude', AppState.filters.excludeKeywords);
  renderTags('regex', AppState.filters.regexPatterns);

  // 消息类型复选框
  document.querySelectorAll('[data-media]').forEach(cb => {
    cb.checked = AppState.filters.allowedMediaTypes.includes(cb.dataset.media);
  });

  // 高级选项
  const ruleIgnoreForwardedEl = document.getElementById('rule-ignore-forwarded');
  const ruleIgnoreRepliesEl = document.getElementById('rule-ignore-replies');
  const ruleIgnoreServiceEl = document.getElementById('rule-ignore-service');
  const ruleMinLengthEl = document.getElementById('rule-min-length');
  const ruleMaxLengthEl = document.getElementById('rule-max-length');

  if (ruleIgnoreForwardedEl) ruleIgnoreForwardedEl.checked = AppState.filters.ignoreForwarded;
  if (ruleIgnoreRepliesEl) ruleIgnoreRepliesEl.checked = AppState.filters.ignoreReplies;
  if (ruleIgnoreServiceEl) ruleIgnoreServiceEl.checked = AppState.filters.ignoreServiceMsgs;
  if (ruleMinLengthEl) ruleMinLengthEl.value = AppState.filters.minLength;
  if (ruleMaxLengthEl) ruleMaxLengthEl.value = AppState.filters.maxLength;

  setRuleScope('global');
}

function setRuleScope(scope) {
  AppState.ruleScope = scope;
  document.getElementById('scope-global-btn').className = scope === 'global'
    ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
  document.getElementById('scope-per-btn').className = scope === 'per'
    ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';

  const scopeHintEl = document.getElementById('scope-hint');
  const scopeSelEl = document.getElementById('scope-listener-select');
  if (scopeHintEl) scopeHintEl.style.display = scope === 'global' ? '' : 'none';
  if (scopeSelEl) scopeSelEl.style.display = scope === 'per' ? '' : 'none';

  if (scope === 'per') {
    const sel = document.getElementById('scope-listener-select');
    sel.innerHTML = '<option value="">选择监听源...</option>';
    for (const l of AppState.allListeners) {
      sel.innerHTML += `<option value="${l.id}">${escHtml(l.name)}</option>`;
    }
  }

  // 加载对应范围的规则
  if (scope === 'global') {
    loadRulesToUI(getDefaultFilters());
  } else {
    // 选择后再加载
  }
}

function onSelectListenerForRules(listenerId) {
  if (!listenerId) { loadRulesToUI(getDefaultFilters()); return; }

  const listener = AppState.allListeners.find(l => l.id === listenerId);
  if (listener && listener.rules) {
    loadRulesToUI(listener.rules);
  } else {
    loadRulesToUI(getDefaultFilters());
  }
  AppState.editingListenerId = listenerId || null;
}

function loadRulesToUI(rules) {
  renderTags('include', rules.includeKeywords || []);
  renderTags('exclude', rules.excludeKeywords || []);
  renderTags('regex', rules.regexPatterns || []);

  document.querySelectorAll('[data-media]').forEach(cb => {
    cb.checked = (rules.allowedMediaTypes || getDefaultFilters().allowedMediaTypes).includes(cb.dataset.media);
  });

  document.getElementById('rule-ignore-forwarded').checked = !!rules.ignoreForwarded;
  document.getElementById('rule-ignore-replies').checked = !!rules.ignoreReplies;
  document.getElementById('rule-ignore-service').checked = rules.ignoreServiceMsgs !== false;
  document.getElementById('rule-min-length').value = rules.minLength || 0;
  document.getElementById('rule-max-length').value = rules.maxLength || 4096;
}

function addTag(type) {
  const input = document.getElementById(`${type}-input`);
  const val = (input.value || '').trim();
  if (!val) return;

  const key = type === 'include' ? 'includeKeywords' : type === 'exclude' ? 'excludeKeywords' : 'regexPatterns';
  const arr = AppState.ruleScope === 'global' ? AppState.filters :
    (AppState.allListeners.find(l => l.id === AppState.editingListenerId)?.rules || {});

  if (!arr[key]) arr[key] = [];
  if (arr[key].includes(val)) { showToast('已存在', 'warning'); return; }
  arr[key].push(val);
  input.value = '';
  renderTags(type, arr[key]);
}

function removeTag(type, idx) {
  const key = type === 'include' ? 'includeKeywords' : type === 'exclude' ? 'excludeKeywords' : 'regexPatterns';
  const rulesObj = AppState.ruleScope === 'global' ? AppState.filters :
    (AppState.allListeners.find(l => l.id === AppState.editingListenerId)?.rules || {});

  if (rulesObj[key]) rulesObj[key].splice(idx, 1);
  renderTags(type, rulesObj[key] || []);
}

function renderTags(type, tags) {
  const el = document.getElementById(`${type}-tags`);
  el.innerHTML = '';
  (tags || []).forEach((t, i) => {
    el.innerHTML += `<span class="tag tag-primary">${escHtml(t)} <button class="tag-remove" onclick="removeTag('${type}', ${i})">&times;</button></span>`;
  });
}

async function saveRules() {
  const rules = collectRulesFromUI();

  try {
    if (AppState.ruleScope === 'global') {
      await api('/api/filters', { method: 'PUT', body: rules });
      AppState.filters = rules;
    } else if (AppState.editingListenerId) {
      const listener = AppState.allListeners.find(l => l.id === AppState.editingListenerId);
      if (!listener) return;
      await api(`/api/accounts/${encodeURIComponent(listener._accountId)}/listeners/${encodeURIComponent(AppState.editingListenerId)}`, {
        method: 'PUT',
        body: { rules },
      });
      listener.rules = rules;
    }

    showToast('规则已保存', 'success');
    document.getElementById('rules-save-hint').textContent = `已于 ${new Date().toLocaleTimeString()} 保存`;
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

function collectRulesFromUI() {
  const include = Array.from(document.querySelectorAll('#include-tags .tag')).map(t => t.childNodes[0].textContent.trim());
  const exclude = Array.from(document.querySelectorAll('#exclude-tags .tag')).map(t => t.childNodes[0].textContent.trim());
  const regex = Array.from(document.querySelectorAll('#regex-tags .tag')).map(t => t.childNodes[0].textContent.trim());
  const media = Array.from(document.querySelectorAll('[data-media]:checked')).map(c => c.dataset.media);

  return {
    includeKeywords: include,
    excludeKeywords: exclude,
    regexPatterns: regex,
    allowedMediaTypes: media,
    ignoreForwarded: document.getElementById('rule-ignore-forwarded').checked,
    ignoreReplies: document.getElementById('rule-ignore-replies').checked,
    ignoreServiceMsgs: document.getElementById('rule-ignore-service').checked,
    minLength: parseInt(document.getElementById('rule-min-length').value, 10) || 0,
    maxLength: parseInt(document.getElementById('rule-max-length').value, 10) || 4096,
  };
}

/** 为某个监听源配置规则（从监听源列表点"规则"按钮跳过来） */
function configListenerRules(listenerId, accountId) {
  switchTab('rules');
  setRuleScope('per');
  const sel = document.getElementById('scope-listener-select');
  sel.value = listenerId;
  onSelectListenerForRules(listenerId);
}

let editingListenerId = null;
let editingListenerAccountId = null;

function editListener(listenerId, accountId) {
  editingListenerId = listenerId;
  editingListenerAccountId = accountId;

  const listener = AppState.allListeners.find(l => l.id === listenerId);
  if (!listener) {
    showToast('未找到该路由', 'error');
    return;
  }

  document.getElementById('edit-listener-name').value = listener.name || '';
  document.getElementById('edit-listener-chat-id').value = listener.chatId || '';

  const serverSelect = document.getElementById('edit-listener-server');
  serverSelect.innerHTML = '<option value="">-- 不绑定渠道 --</option>';
  for (const srv of AppState.forwardServers) {
    const selected = srv.id === listener.forwardTargetId ? 'selected' : '';
    serverSelect.innerHTML += `<option value="${escAttr(srv.id)}" ${selected}>${escHtml(srv.name)}</option>`;
  }

  document.getElementById('listener-edit-modal').style.display = 'flex';
}

function closeListenerEditModal() {
  document.getElementById('listener-edit-modal').style.display = 'none';
  editingListenerId = null;
  editingListenerAccountId = null;
}

function onListenerEditOverlayClick(event) {
  if (event.target === event.currentTarget) {
    closeListenerEditModal();
  }
}

async function saveListenerEdit() {
  if (!editingListenerId || !editingListenerAccountId) {
    showToast('编辑状态异常', 'error');
    return;
  }

  const name = (document.getElementById('edit-listener-name').value || '').trim();
  const forwardTargetId = (document.getElementById('edit-listener-server').value) || null;

  if (!name) {
    showToast('请输入路由名称', 'warning');
    return;
  }

  try {
    const res = await api(`/api/accounts/${encodeURIComponent(editingListenerAccountId)}/listeners/${encodeURIComponent(editingListenerId)}`, {
      method: 'PUT',
      body: { name, forwardTargetId }
    });

    if (res.success) {
      const acc = AppState.accounts.find(a => a.id === editingListenerAccountId);
      if (acc && acc.listeners) {
        const listener = acc.listeners.find(l => l.id === editingListenerId);
        if (listener) {
          listener.name = name;
          listener.forwardTargetId = forwardTargetId;
        }
      }
      rebuildAllListeners();
      renderRoutes();
      renderDashRoutes();
      showToast('路由已更新', 'success');
      closeListenerEditModal();
    } else {
      showToast(res.error || '更新失败', 'error');
    }
  } catch (e) {
    showToast(e.message || '更新失败', 'error');
  }
}


// ==================== 转发服务器管理 ====================

/** 渲染转发服务器列表 */
function renderForwardServers() {
  const container = document.getElementById('forward-servers-list');
  const emptyEl = document.getElementById('servers-empty');

  if (!container) return;

  if (!AppState.forwardServers.length) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  let html = '';
  for (const srv of AppState.forwardServers) {
    const typeLabel = { magicpush: 'Magic Push', webhook: 'Webhook', custom: '自定义 API' }[srv.type] || srv.type;
    const typeClass = { magicpush: 'tag-primary', webhook: 'tag-success', custom: 'tag-warning' }[srv.type] || 'tag-neutral';
    const sid = escAttr(srv.id);
    const sname = escHtml(srv.name);
    const surl = truncateUrl(srv.url || srv.webhookUrl || '-');
    let rateHtml = '';
    if (srv.rateLimit) {
      rateHtml = '<div class="text-xs text-tertiary mt-2">限速: ' + srv.rateLimit + '条/s · 重试: ' + (srv.retryMax || 3) + '次</div>';
    }

    html += '<div class="server-card" data-id="' + sid + '">';
    html += '  <div class="server-card-header">';
    html += '    <div class="server-card-info">';
    html += '      <div class="server-card-name">' + sname + '</div>';
    html += '      <div class="server-card-meta">';
    html += '        <span class="tag ' + typeClass + '" style="font-size:10px;">' + typeLabel + '</span>';
    html += '        <span class="text-xs text-tertiary">' + surl + '</span>';
    html += '      </div>';
    html += '    </div>';
    html += '    <div class="flex gap-2">';
    html += '      <button class="btn btn-ghost btn-sm text-xs" id="test-btn-' + sid + '" onclick="testServer(\'' + sid + '\')" title="发送测试消息">测试</button>';
    html += '      <button class="btn btn-ghost btn-sm" onclick="showEditServerModal(\'' + sid + '\')" title="编辑"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
    html += '      <button class="btn btn-ghost btn-sm text-error" onclick="deleteServer(\'' + sid + '\')" title="删除"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
    html += '    </div>';
    html += '  </div>';
    html += rateHtml;

    const bindCount = (AppState.allListeners || []).filter(l => l.forwardTargetId === srv.id).length;
    if (bindCount > 0) {
      html += '  <div class="text-xs text-secondary mt-2">已绑定 ' + bindCount + ' 个监听源</div>';
    }

    html += '</div>';
  }

  container.innerHTML = html;
}

function truncateUrl(url) {
  if (!url) return '-';
  return url.length > 45 ? url.slice(0, 42) + '...' : url;
}

/** 显示添加服务器 Modal */
function showAddServerModal() {
  // 检查是否有监听源
  const hasListeners = AppState.allListeners && AppState.allListeners.length > 0;
  const hasConnectedAccounts = AppState.accounts && AppState.accounts.some(a => {
    const state = a.status?.state || a.status?.state;
    return state === 'connected';
  });
  
  // 如果没有任何监听源，提供引导提示
  if (!hasListeners) {
    showListenerGuideModal();
    return;
  }
  
  // 如果没有已连接的账户，提示用户先连接账户
  if (!hasConnectedAccounts) {
    showToast('请先添加并连接一个账户', 'warning');
    showAddAccountModal();
    return;
  }
  
  document.getElementById('edit-server-id').value = '';
  document.getElementById('server-modal-title').innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:-2px;margin-right:6px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> 添加渠道';
  resetServerForm();
  onServerTypeChange('magicpush');
  showModal('server-modal');
}

/** 显示监听源引导 Modal */
function showListenerGuideModal() {
  let modal = document.getElementById('listener-guide-modal');
  if (!modal) {
    const modalHtml = `
      <div class="modal-overlay" id="listener-guide-modal" style="display:flex;z-index:1001;">
        <div class="modal-content" style="max-width:480px;padding:var(--space-6);">
          <div style="text-align:center;margin-bottom:var(--space-5);">
            <div style="width:64px;height:64px;border-radius:50%;background:var(--color-primary-50);color:var(--color-primary-600);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-4);">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <h3 style="margin:0 0 var(--space-2);font-size:var(--font-size-lg);font-weight:600;">暂无监听源</h3>
            <p style="margin:0;color:var(--color-text-secondary);font-size:var(--font-size-sm);line-height:1.6;">
              在添加渠道之前，您需要先创建监听源。监听源用于指定要监听哪个 Telegram 聊天、频道或群组的消息。
            </p>
          </div>
          <div class="guide-steps-container" style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:var(--space-4);margin-bottom:var(--space-4);border:1px solid var(--color-border);">
            <div style="font-weight:500;margin-bottom:var(--space-2);font-size:var(--font-size-sm);color:var(--color-text);">创建监听源的步骤：</div>
            <div style="display:flex;align-items:flex-start;gap:var(--space-3);margin-bottom:var(--space-2);font-size:var(--font-size-sm);color:var(--color-text);">
              <span class="guide-step-number">1</span>
              <span>选择要监听的 Telegram 账户</span>
            </div>
            <div style="display:flex;align-items:flex-start;gap:var(--space-3);margin-bottom:var(--space-2);font-size:var(--font-size-sm);color:var(--color-text);">
              <span class="guide-step-number">2</span>
              <span>选择要监听的聊天、频道或群组</span>
            </div>
            <div style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--font-size-sm);color:var(--color-text);">
              <span class="guide-step-number">3</span>
              <span>配置过滤规则（可选）</span>
            </div>
          </div>
          <div style="display:flex;gap:var(--space-3);">
            <button class="btn btn-ghost" onclick="closeListenerGuideModal()" style="flex:1;">取消</button>
            <button class="btn btn-primary" onclick="startListenerCreation()" style="flex:1;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              创建监听源
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    modal = document.getElementById('listener-guide-modal');
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeListenerGuideModal();
      }
    });
  } else {
    modal.style.display = 'flex';
  }
}

function closeListenerGuideModal() {
  const modal = document.getElementById('listener-guide-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function startListenerCreation() {
  closeListenerGuideModal();
  if (!AppState.accounts || !AppState.accounts.some(a => {
    const state = a.status?.state || a.status?.state;
    return state === 'connected';
  })) {
    showToast('请先添加并连接 Telegram 账户', 'info');
    showAddAccountModal();
  } else {
    showToast('请先创建一个监听源', 'info');
    showAddRouteWizard();
  }
}

/** 渲染服务器绑定监听源的 checkbox 列表 */
function renderServerBindListenerCheckboxes(serverId) {
  const container = document.getElementById('server-bind-listeners');
  if (!container) return;

  const listeners = AppState.allListeners || [];
  if (!listeners.length) {
    container.innerHTML = '<div class="text-xs text-tertiary">暂无监听源，请先在「监听源」tab 中添加</div>';
    return;
  }

  let html = '';
  for (const l of listeners) {
    const lid = escAttr(l.id);
    const laid = escAttr(l._accountId);
    const lname = escHtml(l.name || '未命名');
    const laccount = escHtml(l._accountName || '');
    const checked = (l.forwardTargetId === serverId) ? ' checked' : '';
    const entityLabel = getEntityLabel(l.entity);
    html += '<label class="bind-listener-item">';
    html += '  <input type="checkbox" class="bind-listener-cb" data-lid="' + lid + '" data-laid="' + laid + '"' + checked + '>';
    html += '  <span class="bind-listener-info">';
    html += '    <span class="bind-listener-name">' + lname + '</span>';
    html += '    <span class="bind-listener-meta">' + entityLabel;
    if (laccount) html += ' · ' + laccount;
    html += '</span>';
    html += '  </span>';
    html += '</label>';
  }

  container.innerHTML = html;
}

/** 显示编辑服务器 Modal */
function showEditServerModal(id) {
  const srv = AppState.forwardServers.find(s => s.id === id);
  if (!srv) return;

  document.getElementById('edit-server-id').value = id;
  document.getElementById('server-modal-title').innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:-2px;margin-right:6px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> 编辑渠道';

  document.getElementById('server-type').value = srv.type || 'magicpush';
  document.getElementById('server-name').value = srv.name || '';
  onServerTypeChange(srv.type || 'magicpush');

  if (srv.type === 'magicpush') {
    document.getElementById('server-url').value = srv.url || '';
    document.getElementById('server-token').value = srv.token || '';
  } else if (srv.type === 'webhook') {
    document.getElementById('server-webhook-url').value = srv.url || srv.webhookUrl || '';
    document.getElementById('server-webhook-secret').value = srv.token || srv.secret || '';
    document.getElementById('server-headers').value = srv.headers ? JSON.stringify(srv.headers) : '';
  } else if (srv.type === 'custom') {
    document.getElementById('server-webhook-url').value = srv.url || srv.webhookUrl || '';
    document.getElementById('server-webhook-secret').value = srv.token || srv.secret || '';
    document.getElementById('server-headers').value = srv.headers ? JSON.stringify(srv.headers) : '';
    document.getElementById('server-method').value = srv.method || 'POST';
    document.getElementById('server-body-template').value = srv.bodyTemplate || '';
  }

  document.getElementById('server-rate').value = srv.rateLimit || 2;
  document.getElementById('server-retry').value = srv.retryMax || 3;

  showModal('server-modal');
}

/** 服务器类型切换 */
function onServerTypeChange(type) {
  const elMp = document.getElementById('srv-config-magicpush');
  const elWh = document.getElementById('srv-config-webhook');
  const elCu = document.getElementById('srv-config-custom-extra');
  if (elMp) elMp.style.display = type === 'magicpush' ? '' : 'none';
  if (elWh) elWh.style.display = (type === 'webhook' || type === 'custom') ? '' : 'none';
  if (elCu) elCu.style.display = type === 'custom' ? '' : 'none';
}

function resetServerForm() {
  document.getElementById('server-type').value = 'magicpush';
  document.getElementById('server-name').value = '';
  document.getElementById('server-url').value = '';
  document.getElementById('server-token').value = '';
  document.getElementById('server-webhook-url').value = '';
  document.getElementById('server-webhook-secret').value = '';
  document.getElementById('server-headers').value = '';
  document.getElementById('server-method').value = 'POST';
  document.getElementById('server-body-template').value = '';
  document.getElementById('server-rate').value = '2';
  document.getElementById('server-retry').value = '3';
}

/** 保存服务器 */
async function saveServer() {
  const editId = document.getElementById('edit-server-id').value;
  const type = document.getElementById('server-type').value;
  const name = document.getElementById('server-name').value.trim();

  if (!name) { showToast('请输入服务器名称', 'warning'); return; }

  const baseConfig = {
    type,
    name,
    rateLimit: Math.max(1, Math.min(20, parseInt(document.getElementById('server-rate').value, 10) || 2)),
    retryMax: Math.max(0, Math.min(10, parseInt(document.getElementById('server-retry').value, 10) || 3)),
  };

  let serverData;
  if (type === 'magicpush') {
    const url = document.getElementById('server-url').value.trim();
    let token = document.getElementById('server-token').value.trim();
    if (!url) { showToast('请填写服务地址', 'warning'); return; }
    // 编辑时，token 框显示 ****** 表示不修改
    if (editId && token === '******') {
      token = null;
    } else if (!token) {
      showToast('请填写 Token', 'warning'); return;
    }
    serverData = { ...baseConfig, url };
    if (token) serverData.token = token;
  } else if (type === 'webhook' || type === 'custom') {
    const webhookUrl = document.getElementById('server-webhook-url').value.trim();
    if (!webhookUrl) { showToast('请填写 URL', 'warning'); return; }
    const secret = document.getElementById('server-webhook-secret').value.trim();
    let headers = {};
    try {
      const headerStr = document.getElementById('server-headers').value.trim();
      if (headerStr) headers = JSON.parse(headerStr);
    } catch (e) {
      showToast('请求头格式错误，请检查 JSON', 'warning');
      return;
    }
    serverData = { ...baseConfig, url: webhookUrl, token: secret, headers };
    if (type === 'custom') {
      serverData.method = document.getElementById('server-method').value;
      serverData.bodyTemplate = document.getElementById('server-body-template').value.trim();
    }
  }

  try {
    const btn = document.getElementById('server-save-btn');
    btn.disabled = true;
    btn.textContent = '保存中...';

    let savedServerId = editId;
    if (editId) {
      await api(`/api/forward-servers/${encodeURIComponent(editId)}`, {
        method: 'PUT',
        body: serverData,
      });
      const idx = AppState.forwardServers.findIndex(s => s.id === editId);
      if (idx >= 0) AppState.forwardServers[idx] = { ...AppState.forwardServers[idx], ...serverData };
      showToast('服务器已更新', 'success');
    } else {
      const res = await api('/api/forward-servers', { method: 'POST', body: serverData });
      const newServer = res.data || res.server;
      if (newServer) {
        AppState.forwardServers.push(newServer);
        savedServerId = newServer.id;
      }
      showToast('服务器已添加', 'success');
    }

    if (savedServerId) {
      await saveServerBindings(savedServerId);
    }

    renderForwardServers();
    renderDashServers();
    renderListeners(); // 刷新监听源中的转发目标名显示
    renderDashRoutes();
    closeServerModal();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  } finally {
    const btn = document.getElementById('server-save-btn');
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

/** 保存服务器与监听源的绑定关系 */
async function saveServerBindings(serverId) {
  const checkboxes = document.querySelectorAll('.bind-listener-cb');
  if (!checkboxes.length) return;

  const selectedIds = new Set();
  const updates = [];

  for (const cb of checkboxes) {
    const lid = cb.getAttribute('data-lid');
    const laid = cb.getAttribute('data-laid');
    if (cb.checked) {
      selectedIds.add(lid);
      updates.push({
        url: '/api/accounts/' + encodeURIComponent(laid) + '/listeners/' + encodeURIComponent(lid),
        body: { forwardTargetId: serverId },
        accountId: laid,
        listenerId: lid
      });
    }
  }

  // 对之前绑定到此服务器但本次取消选中的，清除 forwardTargetId
  for (const l of AppState.allListeners) {
    if (l.forwardTargetId === serverId && !selectedIds.has(l.id)) {
      updates.push({
        url: '/api/accounts/' + encodeURIComponent(l._accountId) + '/listeners/' + encodeURIComponent(l.id),
        body: { forwardTargetId: null },
        accountId: l._accountId,
        listenerId: l.id
      });
    }
  }

  if (!updates.length) return;

  const results = await Promise.allSettled(
    updates.map(u => api(u.url, { method: 'PUT', body: u.body }))
  );

  let ok = 0, fail = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      ok++;
    } else {
      fail++;
    }
  }

  // 刷新本地状态 - allListeners
  for (const l of AppState.allListeners) {
    if (selectedIds.has(l.id)) {
      l.forwardTargetId = serverId;
    } else if (l.forwardTargetId === serverId) {
      l.forwardTargetId = null;
    }
  }

  // 同步更新账户中的 listeners 数组
  for (const acc of AppState.accounts) {
    if (acc.listeners) {
      for (const l of acc.listeners) {
        if (selectedIds.has(l.id)) {
          l.forwardTargetId = serverId;
        } else if (l.forwardTargetId === serverId) {
          l.forwardTargetId = null;
        }
      }
    }
  }

  // 刷新视图
  renderListeners();
  renderDashRoutes();
  renderRoutes();

  if (fail > 0) {
    showToast('绑定更新：' + ok + ' 成功 / ' + fail + ' 失败', 'warning');
  } else if (ok > 0) {
    showToast('已绑定 ' + ok + ' 个监听源', 'success');
  }
}

/** 删除服务器 */
async function deleteServer(id) {
  const srv = AppState.forwardServers.find(s => s.id === id);
  if (!srv) return;

  try {
    await api(`/api/forward-servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    AppState.forwardServers = AppState.forwardServers.filter(s => s.id !== id);
    
    // 同步更新监听源的转发目标
    for (const acc of AppState.accounts) {
      if (acc.listeners) {
        for (const l of acc.listeners) {
          if (l.forwardTargetId === id) {
            l.forwardTargetId = null;
          }
        }
      }
    }
    
    rebuildAllListeners();
    renderForwardServers();
    renderDashServers();
    renderListeners();
    renderDashRoutes();
    renderRoutes();
    showToast('服务器已删除', 'success');
  } catch (e) {
    console.error('删除服务器失败:', e);
    showToast(e.message || '删除失败', 'error');
  }
}

/** 测试转发服务器 — 发送一条测试消息 */
async function testServer(id) {
  const btn = document.getElementById('test-btn-' + id);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '发送中...';
  }

  try {
    const res = await api('/api/forward/test', {
      method: 'POST',
      body: { serverId: id }
    });
    const result = res.data || {};
    if (result.success !== false) {
      showToast('✅ 测试消息发送成功！', 'success', 4000);
    } else {
      showToast('❌ 发送失败：' + (result.error || '未知错误'), 'error', 5000);
    }
  } catch (e) {
    showToast('❌ 测试失败：' + (e.message || '请求错误'), 'error', 5000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '测试';
    }
  }
}

function closeServerModal() {
  hideModal('server-modal');
}
function onServerModalOverlayClick(e) {
  if (e.target === e.currentTarget) closeServerModal();
}

// ==================== 入站 Webhook 管理 ====================
function showWebhookInboundModal(webhookId) {
  const modal = document.getElementById('webhook-inbound-modal');
  if (!modal) {
    console.error('Webhook modal not found');
    showToast('找不到 Webhook 对话框', 'error');
    return;
  }
  
  try {
    // 填充渠道下拉框
    const serverSelect = document.getElementById('webhook-server');
    if (serverSelect) {
      const enabledServers = AppState.forwardServers.filter(s => s.enabled !== false);
      serverSelect.innerHTML = '<option value="">选择要绑定的渠道</option>' +
        enabledServers.map(s => `<option value="${escAttr(s.id)}">${escHtml(s.name || s.id)}</option>`).join('');
    }
    
    // 重置表单元素（安全方式）
    const editWebhookId = document.getElementById('edit-webhook-id');
    if (editWebhookId) editWebhookId.value = '';
    
    const webhookName = document.getElementById('webhook-name');
    if (webhookName) webhookName.value = '';
    
    const webhookDesc = document.getElementById('webhook-description');
    if (webhookDesc) webhookDesc.value = '';
    
    // 重置令牌显示状态
    tokenVisible = false;
    const visibleIcon = document.getElementById('token-visible-icon');
    const hiddenIcon = document.getElementById('token-hidden-icon');
    const tokenInput = document.getElementById('webhook-token');
    const tokenValueInput = document.getElementById('webhook-token-value');
    if (visibleIcon) visibleIcon.style.display = '';
    if (hiddenIcon) hiddenIcon.style.display = 'none';
    if (tokenInput) tokenInput.type = 'password';
    if (tokenValueInput) tokenValueInput.type = 'password';
    
    // 设置令牌模式为自动生成
    const autoTokenRadio = document.querySelector('input[name="webhook-token-mode"][value="auto"]');
    if (autoTokenRadio) autoTokenRadio.checked = true;
    
    const tokenInputContainer = document.getElementById('webhook-token-input-container');
    if (tokenInputContainer) tokenInputContainer.style.display = 'none';
    
    const tokenDisplayContainer = document.getElementById('webhook-token-display-container');
    if (tokenDisplayContainer) tokenDisplayContainer.style.display = 'none';
    
    const webhookToken = document.getElementById('webhook-token');
    if (webhookToken) webhookToken.value = '';
    
    const webhookTokenValue = document.getElementById('webhook-token-value');
    if (webhookTokenValue) webhookTokenValue.value = '';
    
    const webhookServer = document.getElementById('webhook-server');
    if (webhookServer) webhookServer.value = '';
    
    const saveBtn = document.getElementById('webhook-save-btn');
    if (saveBtn) saveBtn.textContent = '创建';
    
    // 生成URL预览（新建时显示格式示例）
    const urlValue = document.getElementById('webhook-url-value');
    if (urlValue) {
      if (webhookId) {
        urlValue.value = `${window.location.origin}/api/webhook/${webhookId}`;
      } else {
        urlValue.value = `${window.location.origin}/api/webhook/<创建后自动生成>`;
      }
    }
    
    // 如果是编辑模式，加载现有数据
    if (webhookId) {
      const webhook = AppState.inboundWebhooks?.find(w => w.id === webhookId);
      if (webhook) {
        if (editWebhookId) editWebhookId.value = webhook.id;
        if (webhookName) webhookName.value = webhook.name || '';
        if (webhookServer) webhookServer.value = webhook.forwardTargetId || '';
        
        const authTypeSelect = document.getElementById('webhook-auth-type');
        if (authTypeSelect) authTypeSelect.value = webhook.authType || 'none';
        
        const authKeyInput = document.getElementById('webhook-auth-key');
        if (authKeyInput) authKeyInput.value = webhook.authKey || '';
        
        const msgFormatSelect = document.getElementById('webhook-msg-format');
        if (msgFormatSelect) msgFormatSelect.value = webhook.msgFormat || 'text';
        
        if (urlValue) urlValue.value = `${window.location.origin}/api/webhook/inbound/${webhook.authKey}`;
        if (saveBtn) saveBtn.textContent = '保存修改';
        
        // 如果有令牌，显示在令牌区域供复制
        if (webhook.authKey) {
          const tokenValue = document.getElementById('webhook-token-value');
          if (tokenValue) tokenValue.value = webhook.authKey;
          const tokenDisplayContainer = document.getElementById('webhook-token-display-container');
          if (tokenDisplayContainer) tokenDisplayContainer.style.display = '';
          const tokenInputContainer = document.getElementById('webhook-token-input-container');
          if (tokenInputContainer) tokenInputContainer.style.display = 'none';
          // 切换到手动模式（因为已有令牌）
          const manualTokenRadio = document.querySelector('input[name="webhook-token-mode"][value="manual"]');
          if (manualTokenRadio) manualTokenRadio.checked = true;
          // 重置显示/隐藏图标状态
          const visibleIcon = document.getElementById('token-visible-icon');
          const hiddenIcon = document.getElementById('token-hidden-icon');
          if (visibleIcon) visibleIcon.style.display = '';
          if (hiddenIcon) hiddenIcon.style.display = 'none';
        }
        
        onWebhookAuthTypeChange(webhook.authType || 'none');
      }
    }
    
    modal.style.display = 'flex';
  } catch (error) {
    console.error('Error opening webhook modal:', error);
    showToast('打开 Webhook 对话框失败: ' + error.message, 'error');
  }
}

function closeWebhookInboundModal() {
  // 重置令牌显示状态
  tokenVisible = false;
  const visibleIcon = document.getElementById('token-visible-icon');
  const hiddenIcon = document.getElementById('token-hidden-icon');
  const tokenInput = document.getElementById('webhook-token');
  const tokenValueInput = document.getElementById('webhook-token-value');
  
  if (visibleIcon) visibleIcon.style.display = '';
  if (hiddenIcon) hiddenIcon.style.display = 'none';
  if (tokenInput) tokenInput.type = 'password';
  if (tokenValueInput) tokenValueInput.type = 'password';
  
  hideModal('webhook-inbound-modal');
}

function onWebhookInboundOverlayClick(e) {
  if (e.target === e.currentTarget) closeWebhookInboundModal();
}

function onWebhookAuthTypeChange(type) {
  try {
    const configEl = document.getElementById('webhook-auth-config');
    const labelEl = document.getElementById('webhook-auth-label');
    if (type === 'none') {
      if (configEl) configEl.style.display = 'none';
    } else {
      if (configEl) configEl.style.display = '';
      if (labelEl) {
        labelEl.textContent = type === 'api_key' ? 'API Key' : 'Bearer Token';
      }
    }
  } catch (error) {
    console.error('Error in onWebhookAuthTypeChange:', error);
  }
}

// 令牌模式切换
function onWebhookTokenModeChange(mode) {
  try {
    const inputContainer = document.getElementById('webhook-token-input-container');
    const displayContainer = document.getElementById('webhook-token-display-container');
    
    if (mode === 'auto') {
      if (inputContainer) inputContainer.style.display = 'none';
      if (displayContainer) displayContainer.style.display = 'none';
    } else {
      if (inputContainer) inputContainer.style.display = '';
      if (displayContainer) displayContainer.style.display = 'none';
    }
  } catch (error) {
    console.error('Error in onWebhookTokenModeChange:', error);
  }
}

// 生成随机令牌
function generateWebhookToken() {
  const token = generateRandomToken();
  document.getElementById('webhook-token').value = token;
  showToast('令牌已生成', 'success');
}

// 生成随机令牌（32位）
function generateRandomToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// 切换令牌显示/隐藏
let tokenVisible = false;
function toggleTokenVisibility() {
  const tokenInput = document.getElementById('webhook-token');
  const tokenValueInput = document.getElementById('webhook-token-value');
  const visibleIcon = document.getElementById('token-visible-icon');
  const hiddenIcon = document.getElementById('token-hidden-icon');
  
  // 同时处理两个可能的输入框
  const activeInput = tokenValueInput?.style.display !== 'none' ? tokenValueInput : tokenInput;
  
  if (!activeInput) return;
  
  tokenVisible = !tokenVisible;
  
  if (tokenVisible) {
    // 显示令牌（切换为text类型）
    activeInput.type = 'text';
    if (visibleIcon) visibleIcon.style.display = 'none';
    if (hiddenIcon) hiddenIcon.style.display = '';
  } else {
    // 隐藏令牌（切换为password类型）
    activeInput.type = 'password';
    if (visibleIcon) visibleIcon.style.display = '';
    if (hiddenIcon) hiddenIcon.style.display = 'none';
  }
}

// 复制令牌到剪贴板
function copyWebhookToken() {
  const tokenInput = document.getElementById('webhook-token-value');
  if (tokenInput && tokenInput.value) {
    navigator.clipboard.writeText(tokenInput.value).then(() => {
      showToast('令牌已复制到剪贴板', 'success');
    }).catch(() => {
      showToast('复制失败', 'error');
    });
  } else {
    showToast('没有可复制的令牌', 'warning');
  }
}

// 从列表中复制Webhook令牌
function copyWebhookTokenFromList(webhookId) {
  const webhook = AppState.inboundWebhooks.find(w => w.id === webhookId);
  if (webhook && webhook.authKey) {
    navigator.clipboard.writeText(webhook.authKey).then(() => {
      showToast('令牌已复制到剪贴板', 'success');
    }).catch(() => {
      showToast('复制失败', 'error');
    });
  } else {
    showToast('该Webhook没有设置令牌', 'warning');
  }
}

// 从列表中复制Webhook地址（包含令牌）
function copyWebhookUrlFromList(webhookId) {
  const webhook = AppState.inboundWebhooks.find(w => w.id === webhookId);
  if (webhook && webhook.authKey) {
    const url = `${window.location.origin}/api/webhook/inbound/${webhook.authKey}`;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Webhook 地址已复制', 'success');
    }).catch(() => {
      showToast('复制失败', 'error');
    });
  } else {
    showToast('该 Webhook 没有设置令牌', 'warning');
  }
}

function copyWebhookUrl() {
  const urlInput = document.getElementById('webhook-url-value');
  if (urlInput) {
    navigator.clipboard.writeText(urlInput.value).then(() => {
      showToast('Webhook URL 已复制', 'success');
    }).catch(() => {
      showToast('复制失败', 'error');
    });
  }
}

async function testWebhook() {
  const webhookId = document.getElementById('edit-webhook-id').value;
  const message = document.getElementById('webhook-test-message').value.trim();
  
  if (!webhookId) {
    showToast('请先保存 Webhook', 'warning');
    return;
  }
  
  if (!message) {
    showToast('请输入测试消息', 'warning');
    return;
  }
  
  try {
    const btn = document.getElementById('webhook-test-btn');
    btn.disabled = true;
    btn.textContent = '发送中...';
    
    const authType = document.getElementById('webhook-auth-type').value;
    const authKey = document.getElementById('webhook-auth-key').value;
    
    const headers = {};
    if (authType === 'api_key' && authKey) {
      headers['x-api-key'] = authKey;
    } else if (authType === 'bearer' && authKey) {
      headers['authorization'] = `Bearer ${authKey}`;
    }
    
    const response = await fetch(`/api/webhook/${webhookId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({ text: message })
    });
    
    const result = await response.json();
    if (response.ok && result.success) {
      showToast('测试消息发送成功', 'success');
    } else {
      showToast('发送失败: ' + (result.error || '未知错误'), 'error');
    }
    
    btn.disabled = false;
    btn.textContent = '发送测试消息';
  } catch (error) {
    showToast('发送失败: ' + error.message, 'error');
    const btn = document.getElementById('webhook-test-btn');
    btn.disabled = false;
    btn.textContent = '发送测试消息';
  }
}

async function saveWebhookInbound() {
  const name = document.getElementById('webhook-name').value.trim();
  const description = document.getElementById('webhook-description').value.trim();
  const forwardTargetId = document.getElementById('webhook-server').value;
  const editId = document.getElementById('edit-webhook-id').value;
  
  // 获取当前编辑的webhook（如果有）
  let existingWebhook = null;
  if (editId) {
    existingWebhook = AppState.inboundWebhooks?.find(w => w.id === editId);
  }
  
  // 获取令牌配置
  const tokenMode = document.querySelector('input[name="webhook-token-mode"]:checked').value;
  let token = '';
  
  // 确定令牌值
  if (tokenMode === 'auto') {
    // 自动生成模式：如果是编辑且已存在令牌，保留原有令牌，否则生成新的
    token = existingWebhook?.authKey || generateRandomToken();
  } else {
    // 手动模式：优先使用输入框的值
    token = document.getElementById('webhook-token').value.trim();
    // 如果输入框为空但有显示的令牌，使用显示的令牌
    if (!token) {
      const tokenValueInput = document.getElementById('webhook-token-value');
      if (tokenValueInput?.value) {
        token = tokenValueInput.value;
      }
    }
    // 如果还是空但有现有令牌，使用现有令牌
    if (!token && existingWebhook?.authKey) {
      token = existingWebhook.authKey;
    }
  }
  
  // 验证令牌：只有在创建新webhook且是手动模式且没有令牌时才提示
  if (!editId && tokenMode === 'manual' && !token) {
    showToast('请输入令牌或选择自动生成', 'warning');
    return;
  }
  
  if (!name) { showToast('请输入 Webhook 名称', 'warning'); return; }
  if (!forwardTargetId) { showToast('请选择要绑定的渠道', 'warning'); return; }
  
  const webhookData = {
    name,
    description: description || undefined,
    forwardTargetId,
    authType: token ? 'api_key' : 'none',
    authKey: token || undefined,
    msgFormat: 'text',
  };
  
  try {
    const btn = document.getElementById('webhook-save-btn');
    btn.disabled = true;
    btn.textContent = '保存中...';
    
    if (editId) {
      await api(`/api/webhook/${encodeURIComponent(editId)}`, {
        method: 'PUT',
        body: webhookData,
      });
      const idx = AppState.inboundWebhooks?.findIndex(w => w.id === editId);
      if (idx >= 0 && AppState.inboundWebhooks) {
        AppState.inboundWebhooks[idx] = { ...AppState.inboundWebhooks[idx], ...webhookData };
      }
      showToast('Webhook 已更新', 'success');
      renderDashWebhooks();
      // 编辑成功后自动关闭
      setTimeout(() => {
        closeWebhookInboundModal();
      }, 800);
    } else {
      const res = await api('/api/webhook', { method: 'POST', body: webhookData });
      const newWebhook = res.data || res.webhook;
      if (newWebhook) {
        if (!AppState.inboundWebhooks) AppState.inboundWebhooks = [];
        AppState.inboundWebhooks.push(newWebhook);
        
        // 立即更新显示完整的Webhook地址（包含令牌）
        const urlValue = document.getElementById('webhook-url-value');
        if (urlValue && newWebhook.authKey) {
          urlValue.value = `${window.location.origin}/api/webhook/inbound/${newWebhook.authKey}`;
        }
        
        // 显示生成的令牌供用户复制
        if (token) {
          document.getElementById('webhook-token-value').value = token;
          document.getElementById('webhook-token-display-container').style.display = '';
        }
        
        showToast('Webhook 已创建，请在关闭前复制地址', 'success');
        renderDashWebhooks();
        // 创建成功后自动关闭模态框（延迟让用户复制）
        setTimeout(() => {
          closeWebhookInboundModal();
        }, 3000);
      }
    }
    
    btn.disabled = false;
    btn.textContent = editId ? '保存修改' : '创建';
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
    const btn = document.getElementById('webhook-save-btn');
    btn.disabled = false;
    btn.textContent = editId ? '保存修改' : '创建 Webhook';
  }
}


// ==================== 登录流程（支持多账户）====================

/** 发送验证码 - 向后兼容包装 */
function sendCodeForLogin() {
  return LoginFlow.sendCode();
}

/** 提交验证码 - 向后兼容包装 */
function submitCode() {
  return LoginFlow.submitCode();
}

/** 提交两步验证密码 - 向后兼容包装 */
function submit2FA() {
  return LoginFlow.submit2FA();
}

/** 返回手机号输入 - 向后兼容包装 */
function backToPhone() {
  const codeRow = document.getElementById('code-input-row');
  const phoneRow = document.getElementById('phone-input-row');
  if (codeRow) codeRow.style.display = 'none';
  if (phoneRow) phoneRow.style.display = '';
  const els = ['login-phone-input', 'login-code'];
  els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const displayEl = document.getElementById('login-phone-display');
  if (displayEl) displayEl.textContent = '';
}

/** 关闭登录弹窗 - 向后兼容包装 */
function closeLoginModal() {
  hideModal('login-modal');
  LoginFlow.reset();
}
function onLoginModalOverlayClick(e) {
  if (e.target === e.currentTarget) closeLoginModal();
}

/** 由后端/SSE 触发登录弹窗（传入目标 accountId） - 向后兼容包装 */
function promptLoginForAccount(accountId, accountName) {
  return LoginFlow.show(accountId, accountName);
}


// ==================== 消息日志 ====================

function addLog(log) {
  // 先去重，防止重复添加相同消息
  const key = log.id ? `${log.id}` : (log.timestamp ? `${log.timestamp}` : null);
  if (key) {
    const exists = AppState.logs.some(existing =>
      (existing.id && existing.id === log.id) ||
      (existing.timestamp && existing.timestamp === log.timestamp && existing.content === log.content)
    );
    if (exists) return;
  }

  AppState.logs.unshift(log);
  if (AppState.logs.length > AppState.maxLogs) AppState.logs.pop();

  // 保存到 localStorage
  saveLogsToStorage();

  // 更新日志统计
  updateLogStats();

  // 只更新统计，不重新渲染整个最近消息列表
  LogRenderer.appendLog(log);

  // 使用增量更新方式添加最近日志
  updateRecentLogsIncremental(log);
}

// 增量更新最近日志显示
function updateRecentLogsIncremental(newLog) {
  const container = document.getElementById('dash-recent-logs');
  const emptyEl = document.getElementById('dash-logs-empty');
  if (!container) return;
  
  // 隐藏空状态
  if (emptyEl) emptyEl.style.display = 'none';
  
  const time = new Date(newLog.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
  
  let html = '';
  if (newLog.isOperation) {
    const opStClass = newLog.level === 'error' ? 'error' : newLog.level === 'warning' ? 'warning' : 'success';
    const opStText = newLog.level === 'error' ? '操作失败' : newLog.level === 'warning' ? '注意' : '操作';
    const opContent = (newLog.detail || newLog.action || '').slice(0, 100);
    html = '<div class="list-item">' +
      '<span class="recent-log-time">' + time + '</span>' +
      '<span class="tag tag-' + opStClass + '">' + opStText + '</span>' +
      '<span class="list-item-name">' + escHtml(opContent) + '</span>' +
      '</div>';
  } else {
    const stClass = newLog.status === 'forwarded' ? 'success' : newLog.status === 'failed' ? 'error' : 'warning';
    const stText = newLog.status === 'forwarded' ? '已转发' : newLog.status === 'skipped' ? '已跳过' : '失败';
    const content = (newLog.content || '').slice(0, 100);
    html = '<div class="list-item">' +
      '<span class="recent-log-time">' + time + '</span>' +
      '<span class="tag tag-' + stClass + '">' + stText + '</span>' +
      '<span class="list-item-name">' + escHtml(content || '(无内容)') + '</span>' +
      '</div>';
  }
  
  // 在容器开头插入新日志
  container.insertAdjacentHTML('afterbegin', html);
  
  // 如果超过5条，移除最后一条
  const items = container.querySelectorAll('.list-item');
  if (items.length > 5) {
    items[items.length - 1].remove();
  }
}

function addOperationLogEntry(log) {
  // 操作日志标记
  const opLog = {
    ...log,
    isOperation: true
  };
  
  AppState.logs.unshift(opLog);
  if (AppState.logs.length > AppState.maxLogs) AppState.logs.pop();
  
  saveLogsToStorage();
  LogRenderer.appendLog(opLog);
  renderDashLogs();
}

function addServerLogEntry(log) {
  // 服务端日志合并到系统日志
  const systemLog = {
    ...log,
    action: 'system',
    detail: log.message,
    isOperation: true,
    type: undefined
  };
  
  AppState.logs.unshift(systemLog);
  if (AppState.logs.length > AppState.maxLogs) AppState.logs.pop();
  
  saveLogsToStorage();
  LogRenderer.appendLog(systemLog);
  renderDashLogs();
}

// ==================== 简单日志渲染器 ====================
// 日志状态管理
const LogState = {
  currentPage: 1,
  pageSize: 50,
  totalLogs: 0,
  serverLogs: [],
  autoRefresh: true,
  refreshTimer: null
};

const LogRenderer = {
  container: null,
  content: null,
  empty: null,
  paginationInfo: null,
  prevBtn: null,
  nextBtn: null,
  isInitialized: false,

  init() {
    this.container = document.getElementById('log-entries-body');
    this.content = document.getElementById('logs-container');
    this.empty = document.getElementById('logs-empty');
    this.paginationInfo = document.getElementById('log-pagination-info');
    this.prevBtn = document.getElementById('log-prev-btn');
    this.nextBtn = document.getElementById('log-next-btn');

    if (!this.content) {
      console.warn('[LogRenderer] logs-container not found');
      return;
    }

    console.log('[LogRenderer] Initializing with', AppState.logs?.length || 0, 'logs');
    this.isInitialized = true;
    this.render();
  },

  // 获取当前筛选参数
  getFilterParams() {
    return {
      type: (document.getElementById('log-type-filter') || {}).value || '',
      level: (document.getElementById('log-level-filter') || {}).value || '',
      status: (document.getElementById('log-status-filter') || {}).value || '',
      search: (document.getElementById('log-search-input') || {}).value || ''
    };
  },

  // 从前端本地数据筛选（用于SSE实时数据）
  getFilteredLogsFromLocal() {
    let logs = AppState.logs || [];
    const filters = this.getFilterParams();

    // 类型筛选（system, operation, message）
    if (filters.type) {
      if (filters.type === 'system') {
        logs = logs.filter(l => l.action === 'system');
      } else if (filters.type === 'operation') {
        logs = logs.filter(l => l.isOperation && l.action !== 'system');
      } else if (filters.type === 'message') {
        logs = logs.filter(l => !l.isOperation);
      }
    }

    // 级别筛选
    if (filters.level) {
      logs = logs.filter(l => {
        const logLevel = l.level || (l.status === 'forwarded' ? 'info' : l.status === 'skipped' ? 'warn' : 'error');
        return logLevel === filters.level;
      });
    }

    // 状态筛选
    if (filters.status) {
      logs = logs.filter(l => l.status === filters.status);
    }

    // 模糊搜索匹配
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      logs = logs.filter(l => {
        const content = (l.content || l.detail || l.action || l.message || '').toLowerCase();
        const error = (l.error || '').toLowerCase();
        return content.includes(searchLower) || 
               error.includes(searchLower) ||
               (l.content || l.detail || l.action || l.message || '').toLowerCase().indexOf(searchLower) > -1;
      });
    }

    return logs;
  },

  // 渲染单个日志项
  renderLogItem(log) {
    const time = log.timestamp ? new Date(log.timestamp).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }) : '-';

    // 获取搜索词用于高亮
    const searchText = (document.getElementById('log-search-input') || {}).value || '';
    
    // 支持新的统一日志格式
    const logType = log.type || (log.action === 'system' ? 'system' : log.isOperation ? 'operation' : 'message');
    const logLevel = log.level || (log.status === 'forwarded' ? 'info' : log.status === 'skipped' ? 'warn' : 'error');

    // 高亮显示错误级别
    const isError = logLevel === 'error';
    const highlightClass = isError ? 'log-highlight-error' : '';

    // 搜索高亮辅助函数
    const highlightText = (text) => {
      if (!searchText || !text) return escHtml(text || '');
      const escaped = escHtml(text);
      const searchLower = searchText.toLowerCase();
      const idx = escaped.toLowerCase().indexOf(searchLower);
      if (idx === -1) return escaped;
      const before = escaped.substring(0, idx);
      const match = escaped.substring(idx, idx + searchText.length);
      const after = escaped.substring(idx + searchText.length);
      return `${before}<mark class="log-highlight">${match}</mark>${after}`;
    };

    if (logType === 'system' || log.action === 'system') {
      const systemLevelClass = logLevel === 'error' ? 'error' : logLevel === 'warn' ? 'warning' : 'info';
      const systemLevelText = logLevel === 'error' ? '系统错误' : logLevel === 'warn' ? '系统警告' : '系统';
      const detailText = log.detail || log.action || '';
      return `<div class="log-entry operation-log system-log system-log-${systemLevelClass} ${highlightClass}">
        <div class="log-entry-header">
          <span class="log-time">${time}</span>
          <span class="log-tag log-tag-${systemLevelClass}">${systemLevelText}</span>
          <span class="log-source" style="color:var(--color-text);font-weight:500;">${highlightText(detailText)}</span>
        </div>
      </div>`;
    }

    if (logType === 'operation' || log.isOperation) {
      const opStatusClass = logLevel === 'error' ? 'error' : logLevel === 'warn' ? 'warning' : 'success';
      const opStatusText = logLevel === 'error' ? '操作失败' : logLevel === 'warn' ? '注意' : '操作';
      const detailText = log.detail || log.action || '';
      return `<div class="log-entry operation-log ${highlightClass}">
        <div class="log-entry-header">
          <span class="log-time">${time}</span>
          <span class="log-tag log-tag-${opStatusClass}">${opStatusText}</span>
          <span class="log-source" style="color:var(--color-text-secondary);font-weight:500;">${highlightText(detailText)}</span>
        </div>
      </div>`;
    }

    if (logType === 'server') {
      const serverLevelClass = logLevel === 'error' ? 'error' : logLevel === 'warn' ? 'warning' : logLevel === 'debug' ? 'debug' : 'info';
      const serverLevelText = logLevel === 'error' ? '服务端错误' : logLevel === 'warn' ? '服务端警告' : logLevel === 'debug' ? '调试' : '服务端';
      const messageText = log.message || '';
      return `<div class="log-entry server-log ${highlightClass}">
        <div class="log-entry-header">
          <span class="log-time">${time}</span>
          <span class="log-tag log-tag-${serverLevelClass}">${serverLevelText}</span>
          <span class="log-source" style="color:var(--color-text-secondary);font-family:monospace;font-size:12px;">${highlightText(messageText)}</span>
        </div>
      </div>`;
    } else {
      const statusClass = log.status === 'forwarded' ? 'success' : log.status === 'failed' ? 'error' : 'warning';
      const statusText = log.status === 'forwarded' ? '已转发' : log.status === 'skipped' ? '已跳过' : '失败';
      const accName = log.accountName || (AppState.accounts?.find(a => a.id === log.accountId)?.name) || log.accountId || '-';
      const accTag = log.accountId ? `<span class="log-tag" title="来自账户">${highlightText(accName)}</span>` : '';
      const contentHtml = log.content ? `<div class="log-content">${highlightText(truncate(log.content, 300))}</div>` : '';
      const errorHtml = log.error ? `<div class="log-error">${highlightText(log.error)}</div>` : '';
      const sourceHtml = highlightText(log.listenerName || log.source || '');

      return `<div class="log-entry ${log.status} ${highlightClass}">
        <div class="log-entry-header">
          <span class="log-time">${time}</span>
          <span class="log-tag log-tag-${statusClass}">${statusText}</span>
          ${accTag}
          <span class="log-source">${sourceHtml}</span>
        </div>
        ${contentHtml}
        ${errorHtml}
      </div>`;
    }
  },

  // 使用本地数据渲染
  render() {
    if (!this.isInitialized || !this.content) return;

    const logs = this.getFilteredLogsFromLocal();

    console.log('[LogRenderer] render called, filtered logs:', logs.length);

    // 更新空状态
    if (!logs.length) {
      this.content.innerHTML = '';
      if (this.empty) this.empty.style.display = '';
      this.updatePagination(0, 0, 0);
      return;
    }

    if (this.empty) this.empty.style.display = 'none';

    // 简单分页（使用本地数据）
    const start = (LogState.currentPage - 1) * LogState.pageSize;
    const end = start + LogState.pageSize;
    const pagedLogs = logs.slice(start, end);

    // 渲染日志
    this.content.innerHTML = pagedLogs.map(log => this.renderLogItem(log)).join('');
    
    // 更新分页UI
    this.updatePagination(logs.length, start, Math.min(end, logs.length));
  },

  // 更新分页UI
  updatePagination(total, start, end) {
    if (!this.paginationInfo || !this.prevBtn || !this.nextBtn) return;
    
    this.paginationInfo.textContent = total > 0 ? `显示 ${start + 1} - ${end} 共 ${total} 条` : '显示 0 - 0 共 0 条';
    
    this.prevBtn.disabled = LogState.currentPage <= 1;
    this.nextBtn.disabled = end >= total;
  },

  // 添加日志（SSE推送到前端）
  appendLog(log) {
    if (!this.isInitialized || !this.content) return;

    if (LogState.autoRefresh) {
      // 保存当前滚动位置
      const wasAtTop = this.container.scrollTop < 100;

      // 重新渲染所有日志
      this.render();

      // 如果在顶部附近，滚动到顶部以显示新日志
      if (wasAtTop) {
        this.container.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }
};

function renderLogs(append = false) {
  // 使用简单渲染器
  LogRenderer.render();
}

function filterLogs() {
  LogRenderer.render();
}

function resetLogFilters() {
  const filterIds = ['log-status-filter', 'log-search-input'];
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else if (el.tagName === 'INPUT') el.value = '';
    }
  });
  filterLogs();
}

// 搜索功能
function searchLogs() {
  LogRenderer.render();
}

function refreshLogs() {
  LogRenderer.render();
}

function truncate(str, len) {
  return str && str.length > len ? str.slice(0, len) + '...' : str || '';
}

async function clearLogs() {
  try {
    // 调用后端清空API
    await api('/api/messages/history', { method: 'DELETE' });
    
    // 清空本地数据
    AppState.logs = [];
    clearLogsFromStorage();

    LogRenderer.render();
    renderDashLogs();
    updateLogStats();

    // 重置统计
    Object.assign(AppState.stats, { received: 0, forwarded: 0, skipped: 0, failed: 0 });
    clearStatsFromStorage();
    renderDashStats();

    showToast('日志和统计已清空', 'success');
  } catch (e) {
    showToast(e.message || '清空失败', 'error');
  }
}


// ==================== SSE 实时事件 ====================
function connectSSE() {
  if (AppState.eventSource) {
    AppState.eventSource.close();
    AppState.eventSource = null;
  }

  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  let isConnected = false;
  
  function createSSE() {
    try {
      const es = new EventSource('/api/events');
      AppState.eventSource = es;

      function handleData(e, type) {
        try {
          const data = JSON.parse(e.data);
          handleSSEMessage({ type: type, ...data });
        } catch (err) { 
          console.warn('SSE ' + type + ' 解析失败:', err); 
        }
      }

      es.addEventListener('status', (e) => handleData(e, 'status'));
      es.addEventListener('message', (e) => handleData(e, 'message'));
      es.addEventListener('log', (e) => handleData(e, 'log'));
      es.addEventListener('stats', (e) => handleData(e, 'stats'));
      es.addEventListener('require_auth', (e) => handleData(e, 'require_auth'));
      es.addEventListener('op_log', (e) => handleData(e, 'op_log'));
      es.addEventListener('server_log', (e) => handleData(e, 'server_log'));
      es.addEventListener('connected', async (e) => {
        console.log('SSE 连接成功');
        isConnected = true;
        reconnectAttempts = 0;
        
        // 获取系统日志历史（包含服务端日志）
        try {
          const response = await api('/api/logs?type=system&pageSize=100');
          if (response.data?.items?.length) {
            response.data.items.forEach(log => {
              addOperationLogEntry(log);
            });
            console.log('[SSE] 已加载', response.data.items.length, '条系统日志');
          }
        } catch (e) {
          console.warn('[SSE] 获取系统日志失败:', e.message);
        }
      });

      es.onopen = (e) => {
        isConnected = true;
        reconnectAttempts = 0;
      };

      es.onerror = (event) => {
        isConnected = false;
        
        // 只在真正连接失败时显示警告
        if (reconnectAttempts === 0) {
          console.warn('SSE 连接中断，尝试重连...');
        }
        
        if (reconnectAttempts >= maxReconnectAttempts) {
          console.error('SSE 重连次数超过上限，停止重连');
          es.close();
          AppState.eventSource = null;
          showToast('服务器连接失败，请刷新页面重试', 'error', 5000);
          return;
        }
        
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
        
        if (reconnectAttempts <= 3) {
          console.log(`SSE 尝试重连 (${reconnectAttempts}/${maxReconnectAttempts}, 延迟 ${delay}ms)...`);
        }
        
        setTimeout(() => {
          if (AppState.eventSource) {
            AppState.eventSource.close();
            AppState.eventSource = null;
          }
          createSSE();
        }, delay);
      };
    } catch (err) {
      console.error('创建SSE连接失败:', err);
      showToast('SSE连接创建失败，请刷新页面', 'error', 5000);
    }
  }
  
  createSSE();
}

function handleSSEMessage(msg) {
  switch (msg.type) {
    case 'message':
      // msgRecord.forward.status = 'success' | 'failed' | 'skipped'
      // msgRecord.content.text = 消息文本
      addLog({
        timestamp: msg.timestamp || Date.now(),
        status: msg.forward?.status === 'success' ? 'forwarded' :
                 msg.forward?.status === 'skipped' ? 'skipped' : 'failed',
        listenerName: msg.source?.name || msg.listenerName || '',
        content: msg.content?.text || msg.text || '',
        error: msg.forward?.error || msg.error || '',
        accountId: msg.accountId,
        accountName: msg.accountName,
      });
      updateStatsIncremental(msg);
      break;

    case 'connection_status':
      const prevState = AppState.connectionStatus?.state;
      AppState.connectionStatus = msg.data || msg;
      updateConnectionUI();
      // 同步账户状态到 accounts 数组
      if (msg.accountId) {
        const acc = AppState.accounts.find(a => a.id === msg.accountId);
        // 服务器端直接发送 state/user，不嵌套在 data 下
        const state = msg.data?.state || msg.state;
        const user = msg.data?.user || msg.user;
        if (acc) {
          const prevAccState = acc.status?.state;
          acc.status = { state, user };
          // 只有状态真正变化时才重渲染
          if (prevAccState !== state) {
            renderAccounts();
            renderDashAccounts();
            renderDashRoutes();
          }
        }
      }
      // 只有连接状态真正变化时才刷新UI
      if (prevState !== AppState.connectionStatus.state) {
        renderAccounts();
        renderDashAccounts();
        renderDashRoutes();
      }
      break;

    case 'require_auth':
      // 不再自动弹出登录框，让用户手动操作
      break;

    case 'stats':
      Object.assign(AppState.stats, msg.data || {});
      updateStats();
      break;

    case 'op_log':
      addOperationLogEntry({
        timestamp: msg.timestamp,
        action: msg.action,
        detail: msg.detail,
        level: msg.level
      });
      break;

    case 'server_log':
      addServerLogEntry(msg);
      break;
  }
}

function updateStatsIncremental(msg) {
  const fwdStatus = msg.forward?.status;
  if (fwdStatus === 'success') AppState.stats.forwarded++;
  else if (fwdStatus === 'skipped') AppState.stats.skipped++;
  else if (fwdStatus === 'failed') AppState.stats.failed++;
  AppState.stats.received++;

  // 只更新统计数字，不重渲染整个 dashboard
  const elFwd = document.getElementById('dash-forwarded');
  const elSkip = document.getElementById('dash-skipped');
  const elFail = document.getElementById('dash-failed');
  const elRecv = document.getElementById('dash-received');
  if (elFwd) elFwd.textContent = AppState.stats.forwarded;
  if (elSkip) elSkip.textContent = AppState.stats.skipped;
  if (elFail) elFail.textContent = AppState.stats.failed;
  if (elRecv) elRecv.textContent = AppState.stats.received;

  // 保存统计数据到 localStorage
  saveStatsToStorage();
}

function updateStats() {
  const els = { received: 'stat-received', forwarded: 'stat-forwarded', skipped: 'stat-skipped', failed: 'stat-failed' };
  for (const [key, id] of Object.entries(els)) {
    const el = document.getElementById(id);
    if (el) el.textContent = AppState.stats[key] || 0;
  }
  // 同时更新 dashboard 的统计数字
  renderDashStats();
  // 更新日志页面的统计数字
  updateLogStats();
}

function updateLogStats() {
  const logs = AppState.logs || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const messageLogs = logs.filter(l => !l.isOperation);
  const total = messageLogs.length;
  const success = messageLogs.filter(l => l.status === 'forwarded').length;
  const skipped = messageLogs.filter(l => l.status === 'skipped').length;
  const failed = messageLogs.filter(l => l.status === 'failed').length;
  const todayCount = messageLogs.filter(l => {
    if (!l.timestamp) return false;
    const logDate = new Date(l.timestamp);
    logDate.setHours(0, 0, 0, 0);
    return logDate.getTime() === today.getTime();
  }).length;

  const elTotal = document.getElementById('stat-total');
  const elSuccess = document.getElementById('stat-success');
  const elFailed = document.getElementById('stat-failed');
  const elToday = document.getElementById('stat-today');

  if (elTotal) elTotal.textContent = total;
  if (elSuccess) elSuccess.textContent = success;
  if (elFailed) elFailed.textContent = failed;
  if (elToday) elToday.textContent = todayCount;
}

/** 更新连接状态指示器 */
function updateConnectionUI() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (!dot || !text) return;

  const state = AppState.connectionStatus.state || 'disconnected';

  dot.className = 'status-dot ' + (
    state === 'connected' ? 'connected' :
    state === 'connecting' ? 'connecting' : 'disconnected'
  );

  if (state === 'connected') {
    var cu = AppState.connectionStatus.user;
    if (cu) {
      // user 可能是对象或字符串，统一处理
      if (typeof cu === 'object' && cu !== null) {
        text.textContent = '@' + (cu.username || cu.firstName || cu.id || '');
      } else {
        text.textContent = '@' + String(cu || '');
      }
    } else {
      text.textContent = '已连接';
    }
  } else if (state === 'connecting') {
    text.textContent = '连接中...';
  } else if (state === 'authenticating') {
    text.textContent = '待登录';
  } else {
    text.textContent = '未连接';
  }

  // 如果有任何账户在线，整体视为已连接
  const hasOnline = AppState.accounts.some(a => a.status && a.status.state === 'connected');
  if (hasOnline && state !== 'connected') {
    // 有账户在线但主状态不是 connected 时，保持各账户独立状态
  }
}


// ==================== 辅助函数 ====================
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 获取聊天实体对应的颜色 */
function getEntityColor(entity) {
  const colors = {
    private: '#6366f1',   // 靛蓝 - 私聊
    group: '#f59e0b',     // 琥珀 - 群聊
    channel: '#10b981',   // 翠绿 - 频道
    bot: '#8b5cf6',       // 紫色 - 机器人
    supergroup: '#3b82f6',// 蓝色 - 超级群组
  };
  return colors[entity] || colors.supergroup;
}

/** 获取聊天实体对应的 SVG 图标 HTML（圆形头像风格） */
function getChatIconHtml(entity, name) {
  const color = getEntityColor(entity);
  const initial = (name && name.length > 0) ? name.charAt(0).toUpperCase() : '?';

  const svgs = {
    private: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    group: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    channel: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    bot: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="15" x2="8" y2="15.01"/><line x1="16" y1="15" x2="16" y2="15.01"/></svg>',
    supergroup: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  };
  const svg = svgs[entity] || svgs.supergroup;

  return '<div class="listener-icon" style="color:' + color + ';background:' + color + '14;">' + svg + '</div>';
}

/** 兼容旧函数：对话列表仍用 emoji 简洁显示 */
function getChatIcon(entity) {
  const map = { private: '👤', group: '👥', channel: '📢', bot: '🤖', supergroup: '💬', unknown: '💬' };
  return map[entity] || map.unknown;
}

function getEntityLabel(entity) {
  const map = { private: '私聊', group: '群聊', channel: '频道', bot: '机器人', supergroup: '群组', unknown: '未知' };
  return map[entity] || map.unknown;
}

/**
 * 将 gramjs 内部正数 ID 还原为 Telegram 原始 API 格式
 * gramjs 的 entity.id 统一为正数，但 Telegram 实际格式因类型而异：
 * - private/bot: 正数（如 7963152146）
 * - group (basicgroup): 负数（如 -3560307029）
 * - channel/supergroup: -100 + id（如 -1003876265278）
 */
function formatChatId(chatId, entity) {
  const id = String(chatId || '');
  if (entity === 'group') {
    // 普通群组：转为负数
    return '-' + id;
  }
  if (entity === 'channel' || entity === 'supergroup') {
    // 频道/超级群组：加 -100 前缀
    return '-100' + id;
  }
  // private / bot 保持正数
  return id;
}

function populateAccountFilters() {
  const options = ['<option value="">全部账户</option>',
    ...AppState.accounts.map(a => `<option value="${a.id}">${escHtml(a.name || a.id)}</option>`)];
  const filterEls = ['listener-account-filter', 'log-account-filter'];
  filterEls.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const currentVal = el.value;
      el.innerHTML = options.join('');
      // 尝试保留之前的选中值
      if (currentVal && AppState.accounts.some(a => a.id === currentVal)) {
        el.value = currentVal;
      }
    }
  });
}

function toggleProxySettings(prefix) {
  const checkbox = document.getElementById(`${prefix}-proxy-enabled`);
  const settingsDiv = document.getElementById(`${prefix}-proxy-settings`);
  if (settingsDiv)
    settingsDiv.style.display = checkbox.checked ? '' : 'none';
}

/** Modal 控制 */
function showModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('closing');
    el.style.display = 'flex';
  }
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('closing');
    setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('closing');
    }, 280);
  }
}

// ==================== 全局设置 Modal ====================
const DEFAULT_SETTINGS = {
  autoConnect: true,
  autoListen: true,
  theme: 'light',
  themeColor: 'indigo',
  sidebarExpanded: true,
  autoScroll: true,
  showFiltered: false,
  maxLogs: 500,
  notifyForward: false,
  notifyConnection: true,
  notifyError: true,
  browserNotify: false,
  localStorage: true,
  maskSensitive: true,
  opLog: true
};

function showSettingsModal() {
  document.getElementById('settings-modal').style.display = 'flex';
  loadSettingsToForm();
  updateThemeUI();
  updateColorUI();
}

function closeSettingsModal() {
  hideModal('settings-modal');
}

function onSettingsModalOverlayClick(e) {
  if (e.target === e.currentTarget) closeSettingsModal();
}

function loadSettingsToForm() {
  const settings = { ...DEFAULT_SETTINGS, ...(AppState.settings || {}) };
  
  const boolFields = [
    'autoConnect', 'autoListen', 'sidebarExpanded', 'autoScroll', 
    'showFiltered', 'notifyForward', 'notifyConnection', 'notifyError',
    'browserNotify', 'localStorage', 'maskSensitive', 'opLog'
  ];
  
  boolFields.forEach(field => {
    const el = document.getElementById(`setting-${field.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
    if (el) el.checked = settings[field] !== false;
  });
  
  const maxLogsEl = document.getElementById('setting-max-logs');
  if (maxLogsEl) maxLogsEl.value = settings.maxLogs || 500;
}

function updateThemeUI() {
  const theme = AppState.settings?.theme || 'light';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeValue === theme);
  });
}

function updateColorUI() {
  const color = AppState.settings?.themeColor || 'indigo';
  const isCustomColor = color.startsWith('#');
  
  document.querySelectorAll('.color-btn').forEach(btn => {
    if (isCustomColor) {
      btn.classList.toggle('active', btn.dataset.color === 'custom');
    } else {
      btn.classList.toggle('active', btn.dataset.color === color);
    }
  });
  
  const customBtn = document.querySelector('.color-btn-custom');
  if (customBtn && isCustomColor) {
    customBtn.style.background = color;
  }
}

function setTheme(theme) {
  const root = document.documentElement;
  
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
  
  AppState.settings = { ...AppState.settings, theme };
  updateThemeUI();
  saveThemeToStorage(theme);
}

function setThemeColor(color) {
  const root = document.documentElement;
  
  if (color.startsWith('#')) {
    root.setAttribute('data-theme-color', 'custom');
    applyCustomThemeColor(color);
    AppState.settings = { ...AppState.settings, themeColor: color };
    const customBtn = document.querySelector('.color-btn-custom');
    if (customBtn) customBtn.style.background = color;
  } else {
    root.setAttribute('data-theme-color', color);
    AppState.settings = { ...AppState.settings, themeColor: color };
  }
  
  updateColorUI();
  saveThemeToStorage(AppState.settings.theme, color);
}

function applyCustomThemeColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  
  const root = document.documentElement;
  root.style.setProperty('--color-primary-50', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`);
  root.style.setProperty('--color-primary-100', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`);
  root.style.setProperty('--color-primary-200', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`);
  root.style.setProperty('--color-primary-300', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`);
  root.style.setProperty('--color-primary-400', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`);
  root.style.setProperty('--color-primary-500', hex);
  root.style.setProperty('--color-primary-600', adjustBrightness(hex, -20));
  root.style.setProperty('--color-primary-700', adjustBrightness(hex, -35));
  root.style.setProperty('--color-primary-800', adjustBrightness(hex, -45));
  root.style.setProperty('--color-primary-900', adjustBrightness(hex, -55));
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function adjustBrightness(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  const adjust = (val) => Math.max(0, Math.min(255, Math.round(val + (255 * percent / 100))));
  return `rgb(${adjust(rgb.r)}, ${adjust(rgb.g)}, ${adjust(rgb.b)})`;
}

function saveThemeToStorage(theme, themeColor) {
  try {
    const settings = JSON.parse(localStorage.getItem('tg_push_settings') || '{}');
    if (theme) settings.theme = theme;
    if (themeColor) settings.themeColor = themeColor;
    localStorage.setItem('tg_push_settings', JSON.stringify(settings));
  } catch (e) {
    console.warn('[Storage] 保存主题设置失败:', e);
  }
}

function loadThemeFromStorage() {
  try {
    const settings = JSON.parse(localStorage.getItem('tg_push_settings') || '{}');
    if (settings.theme) {
      setTheme(settings.theme);
    }
    if (settings.themeColor) {
      setThemeColor(settings.themeColor);
    }
    AppState.settings = { ...AppState.settings, ...settings };
  } catch (e) {
    console.warn('[Storage] 加载主题设置失败:', e);
  }
}

function resetSettings() {
  AppState.settings = { ...DEFAULT_SETTINGS };
  loadSettingsToForm();
  setTheme(DEFAULT_SETTINGS.theme);
  setThemeColor(DEFAULT_SETTINGS.themeColor);
  showToast('已恢复默认设置', 'success');
}

async function saveSettings() {
  const settings = {
    autoConnect: document.getElementById('setting-auto-connect')?.checked ?? true,
    autoListen: document.getElementById('setting-auto-listen')?.checked ?? true,
    theme: AppState.settings?.theme || 'light',
    themeColor: AppState.settings?.themeColor || 'indigo',
    sidebarExpanded: document.getElementById('setting-sidebar-expanded')?.checked ?? true,
    autoScroll: document.getElementById('setting-auto-scroll')?.checked ?? true,
    showFiltered: document.getElementById('setting-show-filtered')?.checked ?? false,
    maxLogs: parseInt(document.getElementById('setting-max-logs')?.value || '500', 10),
    notifyForward: document.getElementById('setting-notify-forward')?.checked ?? false,
    notifyConnection: document.getElementById('setting-notify-connection')?.checked ?? true,
    notifyError: document.getElementById('setting-notify-error')?.checked ?? true,
    browserNotify: document.getElementById('setting-browser-notify')?.checked ?? false,
    localStorage: document.getElementById('setting-local-storage')?.checked ?? true,
    maskSensitive: document.getElementById('setting-mask-sensitive')?.checked ?? true,
    opLog: document.getElementById('setting-op-log')?.checked ?? true
  };
  
  try {
    await api('/api/config', {
      method: 'PUT',
      body: { settings }
    });
    AppState.settings = settings;
    
    try {
      localStorage.setItem('tg_push_settings', JSON.stringify(settings));
    } catch (e) {}
    
    showToast('设置已保存', 'success');
    closeSettingsModal();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

// ============================================================
// Dashboard + Routes （新增，整合监听源+转发配置+过滤规则）
// ============================================================

// ==================== Dashboard ====================
function refreshDashboard() {
  Promise.all([
    api('/api/accounts'),
    api('/api/forward-servers'),
    api('/api/stats'),
  ]).then(([accRes, srvRes, statsRes]) => {
    AppState.accounts = accRes.data || accRes.accounts || [];
    AppState.forwardServers = srvRes.data || [];
    Object.assign(AppState.stats, statsRes.stats || {});
    renderDashboard();
    populateAccountFilters();
  }).catch(() => {});
}

function renderDashAccounts() {
  const container = document.getElementById('dash-accounts');
  const emptyEl = document.getElementById('dash-accounts-empty');
  const summaryEl = document.getElementById('dash-account-summary');
  const clearBtnContainer = document.getElementById('clear-all-accounts-container');
  if (!container) return;

  if (!AppState.accounts.length) {
    if (emptyEl) emptyEl.style.display = '';
    if (summaryEl) summaryEl.textContent = '0 个账户';
    if (clearBtnContainer) clearBtnContainer.style.display = 'none';
    if (window.paginatedRenderers['accounts']) {
      window.paginatedRenderers['accounts'].refresh();
    }
    return;
  }
  
  if (emptyEl) emptyEl.style.display = 'none';
  if (summaryEl) summaryEl.textContent = `${AppState.accounts.length} 个账户`;
  if (clearBtnContainer) clearBtnContainer.style.display = '';

  if (!window.paginatedRenderers['accounts']) {
    window.paginatedRenderers['accounts'] = createPaginatedRenderer('dash-accounts', renderAccountItem, () => AppState.accounts, { pageSize: 10 });
  }
  
  const isCollapsed = document.querySelector('.card-collapsible[data-card-id="accounts"]')?.classList.contains('collapsed');
  if (!isCollapsed) {
    window.paginatedRenderers['accounts'].loadInitialData();
  }
}

function renderAccountItem(acc) {
  // 使用新的 AccountRenderer 渲染卡片视图
  return AccountRenderer.renderCard(acc);
}

function renderDashServers() {
  const container = document.getElementById('dash-servers');
  const summaryEl = document.getElementById('dash-server-summary');
  if (!container) return;

  const serverCount = AppState.forwardServers.length;
  if (summaryEl) summaryEl.textContent = `${serverCount} 个渠道`;

  if (!window.paginatedRenderers['servers']) {
    window.paginatedRenderers['servers'] = createPaginatedRenderer('dash-servers', renderServerItem, () => AppState.forwardServers, { pageSize: 10 });
  }
  
  const isCollapsed = document.querySelector('.card-collapsible[data-card-id="servers"]')?.classList.contains('collapsed');
  if (!isCollapsed) {
    window.paginatedRenderers['servers'].loadInitialData();
  }
}

function renderServerItem(srv) {
  const typeLabel = { magicpush: 'Magic Push', webhook: 'Webhook', custom: '自定义' }[srv.type] || srv.type;
  const sid = escAttr(srv.id);
  const enabled = srv.enabled !== false;
  const tagClass = enabled ? 'tag-success' : 'tag-neutral';
  const statusTagText = enabled ? '启用中' : '已禁用';
  
  return `<div class="list-item" data-id="${sid}">
    <label class="toggle">
      <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleServerEnabled('${sid}')">
      <span class="toggle-track"></span>
      <span class="toggle-thumb"></span>
    </label>
    <span class="tag ${tagClass}">${statusTagText}</span>
    <span class="tag ${({ magicpush: 'tag-primary', webhook: 'tag-success', custom: 'tag-warning' }[srv.type] || 'tag-neutral')}">${typeLabel}</span>
    <span class="list-item-name">${escHtml(srv.name)}</span>
    <button class="btn btn-ghost btn-sm list-item-btn icon-btn" onclick="showEditServerModal('${sid}')" title="编辑"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
    <button class="btn btn-ghost btn-sm text-error list-item-btn icon-btn" onclick="deleteServer('${sid}')" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
  </div>`;
}

function renderDashWebhooks() {
  const container = document.getElementById('dash-webhooks');
  const summaryEl = document.getElementById('dash-webhook-summary');
  
  const cardEl = document.querySelector('#dash-webhooks').closest('.card');
  if (cardEl) cardEl.style.display = '';

  const webhooks = AppState.inboundWebhooks || [];
  if (summaryEl) summaryEl.textContent = `${webhooks.length} 个 Webhook`;

  if (!window.paginatedRenderers['webhooks']) {
    window.paginatedRenderers['webhooks'] = createPaginatedRenderer('dash-webhooks', renderWebhookItem, () => AppState.inboundWebhooks || [], { pageSize: 10 });
  }
  
  const isCollapsed = document.querySelector('.card-collapsible[data-card-id="webhooks"]')?.classList.contains('collapsed');
  if (!isCollapsed) {
    window.paginatedRenderers['webhooks'].loadInitialData();
  }
}

function getServerName(serverId) {
  if (!serverId) return '未设置';
  const server = AppState.forwardServers.find(s => s.id === serverId);
  return server ? server.name : serverId;
}

function renderWebhookItem(webhook) {
  const wid = escAttr(webhook.id);
  const wname = escHtml(webhook.name || webhook.id);
  const enabled = webhook.enabled !== false;
  const tagClass = enabled ? 'tag-success' : 'tag-neutral';
  const tagText = enabled ? '启用中' : '已禁用';
  
  return `<div class="list-item" data-id="${wid}">
    <label class="toggle">
      <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleWebhookEnabled('${wid}')">
      <span class="toggle-track"></span>
      <span class="toggle-thumb"></span>
    </label>
    <span class="tag ${tagClass}">${tagText}</span>
    <span class="tag tag-primary">Webhook</span>
    <span class="list-item-name">${wname}</span>
    <button class="btn btn-ghost btn-sm list-item-btn icon-btn" onclick="copyWebhookUrlFromList('${wid}')" title="复制 Webhook 地址和令牌">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
    <button class="btn btn-ghost btn-sm list-item-btn icon-btn" onclick="showWebhookInboundModal('${wid}')" title="编辑">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    </button>
    <button class="btn btn-ghost btn-sm text-error list-item-btn icon-btn" onclick="deleteWebhookInbound('${wid}')" title="删除">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </div>`;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '未知';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = Math.floor((now - then) / 1000);
  
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}天前`;
  return new Date(timestamp).toLocaleDateString();
}

async function toggleWebhookEnabled(webhookId) {
  const webhook = AppState.inboundWebhooks.find(w => w.id === webhookId);
  if (!webhook) {
    showToast('Webhook 不存在', 'error');
    return;
  }
  
  const newEnabled = webhook.enabled === false ? true : false;
  try {
    await api(`/api/webhook/${encodeURIComponent(webhookId)}`, {
      method: 'PUT',
      body: { enabled: newEnabled }
    });
    webhook.enabled = newEnabled;
    
    // 只更新变化的元素，避免整个列表重建导致闪烁
    updateWebhookItemUI(webhookId);
    
    const summaryEl = document.getElementById('dash-webhook-summary');
    if (summaryEl) summaryEl.textContent = `${AppState.inboundWebhooks.length} 个 Webhook`;
    
    showToast(newEnabled ? 'Webhook 已启用' : 'Webhook 已禁用', 'success');
  } catch (error) {
    showToast('操作失败: ' + error.message, 'error');
  }
}

/** 增量更新单个 Webhook 的 UI 状态 */
function updateWebhookItemUI(webhookId) {
  const itemEl = document.querySelector(`.list-item[data-id="${webhookId}"]`);
  if (!itemEl) return;

  const webhook = AppState.inboundWebhooks.find(w => w.id === webhookId);
  if (!webhook) return;

  const checkbox = itemEl.querySelector('input[type="checkbox"]');
  if (checkbox) checkbox.checked = webhook.enabled !== false;

  const tags = itemEl.querySelectorAll('.tag');
  if (tags && tags.length > 0) {
    tags[0].className = `tag ${webhook.enabled !== false ? 'tag-success' : 'tag-neutral'}`;
    tags[0].textContent = webhook.enabled !== false ? '启用中' : '已禁用';
  }
}

async function toggleServerEnabled(serverId) {
  const server = AppState.forwardServers.find(s => s.id === serverId);
  if (!server) {
    showToast('渠道不存在', 'error');
    return;
  }
  
  const newEnabled = server.enabled === false ? true : false;
  try {
    await api(`/api/forward-servers/${encodeURIComponent(serverId)}`, {
      method: 'PUT',
      body: { enabled: newEnabled }
    });
    server.enabled = newEnabled;
    
    // 只更新变化的元素，避免整个列表重建导致闪烁
    updateServerItemUI(serverId);
    
    const summaryEl = document.getElementById('dash-server-summary');
    if (summaryEl) summaryEl.textContent = `${AppState.forwardServers.length} 个渠道`;
    
    showToast(newEnabled ? '渠道已启用' : '渠道已禁用', 'success');
  } catch (error) {
    showToast('操作失败: ' + error.message, 'error');
  }
}

/** 增量更新单个渠道的 UI 状态 */
function updateServerItemUI(serverId) {
  const itemEl = document.querySelector(`.list-item[data-id="${serverId}"]`);
  if (!itemEl) return;

  const server = AppState.forwardServers.find(s => s.id === serverId);
  if (!server) return;

  const checkbox = itemEl.querySelector('input[type="checkbox"]');
  if (checkbox) checkbox.checked = server.enabled !== false;

  const tags = itemEl.querySelectorAll('.tag');
  if (tags && tags.length > 0) {
    tags[0].className = `tag ${server.enabled !== false ? 'tag-success' : 'tag-neutral'}`;
    tags[0].textContent = server.enabled !== false ? '启用中' : '已禁用';
  }
}

async function deleteWebhookInbound(webhookId) {
  try {
    await api(`/api/webhook/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE'
    });
    AppState.inboundWebhooks = (AppState.inboundWebhooks || []).filter(w => w.id !== webhookId);
    renderDashWebhooks();
    showToast('Webhook 已删除', 'success');
  } catch (error) {
    showToast('删除失败: ' + error.message, 'error');
  }
}

function renderDashRoutes() {
  const container = document.getElementById('dash-routes');
  const summaryEl = document.getElementById('dash-route-summary');
  if (!container) return;

  rebuildAllListeners();

  const listenerCount = AppState.allListeners.length;
  if (summaryEl) summaryEl.textContent = `${listenerCount} 条路由`;

  if (!window.paginatedRenderers['routes']) {
    window.paginatedRenderers['routes'] = createPaginatedRenderer('dash-routes', renderRouteItem, () => AppState.allListeners, { pageSize: 10 });
  }
  
  const isCollapsed = document.querySelector('.card-collapsible[data-card-id="routes"]')?.classList.contains('collapsed');
  if (!isCollapsed) {
    window.paginatedRenderers['routes'].loadInitialData();
  }
}

function renderRouteItem(listener) {
  const fwdTarget = getForwardTargetName(listener.forwardTargetId);
  const enabled = !!listener.enabled;
  const lid = escAttr(listener.id);
  const laid = escAttr(listener._accountId);
  const lname = escHtml(listener.name);
  
  // 根据 entity 或 chatId 推断监听类型
  let entityType = listener.entity;
  if (!entityType && listener.chatId) {
    const chatId = String(listener.chatId);
    if (chatId.indexOf('-100') === 0) entityType = 'supergroup';
    else if (chatId.charAt(0) === '-') entityType = 'group';
    else entityType = 'private';
  }
  const entityLabel = getEntityLabel(entityType);
  
  const enabledClass = enabled ? 'tag-success' : 'tag-neutral';
  const enabledText = enabled ? '监听中' : '已暂停';
  const accountName = escHtml(listener._accountName || '');

  let fwdHtml = fwdTarget ? '<span class="list-item-meta">→ ' + escHtml(fwdTarget) + '</span>' : '';
  let accountHtml = accountName ? '<span class="tag tag-primary">' + accountName + '</span>' : '';

  let html = '<div class="list-item" data-id="' + lid + '" data-account="' + laid + '">';
  html += '<label class="toggle">';
  html += '<input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="toggleListenerEnabled(\'' + lid + '\', \'' + laid + '\')">';
  html += '<span class="toggle-track"></span><span class="toggle-thumb"></span></label>';
  html += '<span class="tag ' + enabledClass + '">' + enabledText + '</span>';
  html += accountHtml;
  html += '<span class="tag tag-secondary">' + entityLabel + '</span>';
  html += '<span class="list-item-name">' + lname + '</span>';
  html += fwdHtml;
  html += '<button class="btn btn-ghost btn-sm list-item-btn icon-btn" onclick="configRouteRules(\'' + lid + '\')" title="配置规则"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>';
  html += '<button class="btn btn-ghost btn-sm text-error list-item-btn icon-btn" onclick="removeListener(\'' + lid + '\', \'' + laid + '\')" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
  html += '</div>';
  return html;
}

const CardCollapseState = {
  storageKey: 'tgpush_card_collapse_states',
  getStates() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey)) || {};
    } catch {
      return {};
    }
  },
  setState(cardId, collapsed) {
    const states = this.getStates();
    states[cardId] = collapsed;
    localStorage.setItem(this.storageKey, JSON.stringify(states));
  },
  isCollapsed(cardId) {
    return this.getStates()[cardId] === true;
  }
};

const LazyRenderCache = {
  storageKey: 'tgpush_card_lazy_cache',
  getCache() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey)) || {};
    } catch {
      return {};
    }
  },
  setCache(cardId, data) {
    const cache = this.getCache();
    cache[cardId] = { data, timestamp: Date.now() };
    localStorage.setItem(this.storageKey, JSON.stringify(cache));
  },
  getCacheData(cardId) {
    return this.getCache()[cardId];
  },
  clearCache(cardId) {
    const cache = this.getCache();
    delete cache[cardId];
    localStorage.setItem(this.storageKey, JSON.stringify(cache));
  }
};

const PaginationConfig = {
  pageSize: 10,
  maxVisiblePages: 3
};

function createPaginatedRenderer(containerId, renderItemFn, getItemsFn, options = {}) {
  const { pageSize = PaginationConfig.pageSize, showLoadMore = true } = options;
  let currentPage = 1;
  let allItems = [];
  let isExpanded = false;
  
  return {
    getContainer() {
      return document.getElementById(containerId);
    },
    setExpanded(expanded) {
      isExpanded = expanded;
      if (expanded && allItems.length === 0) {
        this.loadInitialData();
      }
    },
    loadInitialData() {
      allItems = getItemsFn();
      currentPage = 1;
      this.render();
    },
    loadMore() {
      currentPage++;
      this.render();
    },
    getTotalPages() {
      return Math.ceil(allItems.length / pageSize);
    },
    getVisibleItems() {
      return allItems.slice(0, currentPage * pageSize);
    },
    hasMoreItems() {
      return this.getVisibleItems().length < allItems.length;
    },
    render() {
      const container = this.getContainer();
      if (!container) return;
      
      // 保存空状态元素
      const emptyEl = container.querySelector('.empty-state');
      
      const visibleItems = this.getVisibleItems();
      let html = '';
      
      for (const item of visibleItems) {
        html += renderItemFn(item);
      }
      
      if (showLoadMore && this.hasMoreItems()) {
        html += `<div class="load-more-container" style="padding: 8px 0; text-align: center;">
          <button class="btn btn-ghost btn-sm" onclick="window.paginatedRenderers['${containerId}'].loadMore()">
            加载更多 (${visibleItems.length}/${allItems.length})
          </button>
        </div>`;
      }
      
      // 清空容器但保留空状态元素
      container.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = visibleItems.length > 0 ? 'none' : '';
        container.appendChild(emptyEl);
      }
      
      // 插入新内容
      if (html) {
        container.insertAdjacentHTML('beforeend', html);
      }
    },
    refresh() {
      allItems = getItemsFn();
      currentPage = 1;
      this.render();
    }
  };
}

window.paginatedRenderers = {};

function toggleCardCollapse(cardId) {
  const card = document.querySelector(`.card-collapsible[data-card-id="${cardId}"]`);
  if (!card) return;
  
  const isCollapsed = card.classList.toggle('collapsed');
  CardCollapseState.setState(cardId, isCollapsed);
  
  const content = card.querySelector('.card-content');
  if (content) {
    if (isCollapsed) {
      content.style.maxHeight = '0';
      content.style.opacity = '0';
    } else {
      // 根据不同卡片设置合适的 max-height
      if (cardId === 'logs') {
        content.style.maxHeight = '600px';
      } else {
        content.style.maxHeight = '350px';
      }
      content.style.opacity = '1';
      
      if (window.paginatedRenderers[cardId]) {
        window.paginatedRenderers[cardId].setExpanded(true);
      }
    }
  }
}

function initCardCollapseStates() {
  const cards = document.querySelectorAll('.card-collapsible');
  cards.forEach(card => {
    const cardId = card.dataset.cardId;
    if (CardCollapseState.isCollapsed(cardId)) {
      card.classList.add('collapsed');
      const content = card.querySelector('.card-content');
      if (content) {
        content.style.maxHeight = '0';
        content.style.opacity = '0';
      }
    } else {
      const content = card.querySelector('.card-content');
      if (content) {
        if (cardId === 'logs') {
          content.style.maxHeight = '600px';
        } else {
          content.style.maxHeight = '350px';
        }
        content.style.opacity = '1';
      }
      if (window.paginatedRenderers[cardId]) {
        window.paginatedRenderers[cardId].setExpanded(true);
      }
    }
  });
}

function renderDashboard() {
  initCardCollapseStates();
  renderDashAccounts();
  renderDashServers();
  renderDashWebhooks();
  renderDashStats();
  renderDashLogs();
  renderDashRoutes();
}

// 定期检查Webhook健康状态
let webhookHealthCheckInterval = null;

function startWebhookHealthCheck(intervalMs = 30000) {
  if (webhookHealthCheckInterval) {
    clearInterval(webhookHealthCheckInterval);
  }
  
  // 立即执行一次
  checkWebhookHealth();
  
  // 定期检查
  webhookHealthCheckInterval = setInterval(checkWebhookHealth, intervalMs);
}

function stopWebhookHealthCheck() {
  if (webhookHealthCheckInterval) {
    clearInterval(webhookHealthCheckInterval);
    webhookHealthCheckInterval = null;
  }
}

async function checkWebhookHealth() {
  try {
    const res = await api('/api/webhooks/health');
    if (res.success && res.data) {
      // 检查是否有变化
      let hasChanges = false;
      for (const health of res.data) {
        const webhook = AppState.inboundWebhooks.find(w => w.id === health.id);
        if (webhook) {
          const oldStatus = webhook._healthStatus;
          const newStatus = health.status;
          if (oldStatus !== newStatus) {
            hasChanges = true;
          }
          webhook._healthStatus = newStatus;
          webhook.stats = health.stats;
        } else {
          hasChanges = true;
        }
      }
      // 只有当数据真正变化时才重新渲染
      if (hasChanges || res.data.length !== AppState.inboundWebhooks.length) {
        renderDashWebhooks();
      }
    }
  } catch (err) {
    console.warn('[Webhook] 健康检查失败:', err.message);
  }
}

// 在页面卸载时停止健康检查
window.addEventListener('beforeunload', () => {
  stopWebhookHealthCheck();
});

function renderDashStats() {
  const dashReceived = document.getElementById('dash-received');
  const dashForwarded = document.getElementById('dash-forwarded');
  const dashSkipped = document.getElementById('dash-skipped');
  const dashFailed = document.getElementById('dash-failed');
  if (dashReceived) dashReceived.textContent = AppState.stats.received || 0;
  if (dashForwarded) dashForwarded.textContent = AppState.stats.forwarded || 0;
  if (dashSkipped) dashSkipped.textContent = AppState.stats.skipped || 0;
  if (dashFailed) dashFailed.textContent = AppState.stats.failed || 0;
}

function renderDashLogs() {
  const container = document.getElementById('dash-recent-logs');
  const emptyEl = document.getElementById('dash-logs-empty');
  if (!container) return;

  const recent = (AppState.logs || []).slice(0, 5);
  if (!recent.length) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // 保存空状态元素
  const savedEmptyEl = container.querySelector('.empty-state');
  
  let html = '';
  for (const log of recent) {
    const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    
    if (log.isOperation) {
      const opStClass = log.level === 'error' ? 'error' : log.level === 'warning' ? 'warning' : 'success';
      const opStText = log.level === 'error' ? '操作失败' : log.level === 'warning' ? '注意' : '操作';
      const opContent = (log.detail || log.action || '').slice(0, 100);
      html += '<div class="list-item">'
        + '<span class="recent-log-time">' + time + '</span>'
        + '<span class="tag tag-' + opStClass + '">' + opStText + '</span>'
        + '<span class="list-item-name">' + escHtml(opContent) + '</span>'
        + '</div>';
    } else {
      const stClass = log.status === 'forwarded' ? 'success' : log.status === 'failed' ? 'error' : 'warning';
      const stText = log.status === 'forwarded' ? '已转发' : log.status === 'skipped' ? '已跳过' : '失败';
      const content = (log.content || '').slice(0, 100);
      html += '<div class="list-item">'
        + '<span class="recent-log-time">' + time + '</span>'
        + '<span class="tag tag-' + stClass + '">' + stText + '</span>'
        + '<span class="list-item-name">' + escHtml(content || '(无内容)') + '</span>'
        + '</div>';
    }
  }
  
  // 清空容器但保留空状态元素
  container.innerHTML = '';
  if (savedEmptyEl) {
    savedEmptyEl.style.display = 'none';
    container.appendChild(savedEmptyEl);
  }
  
  // 插入新内容
  if (html) {
    container.insertAdjacentHTML('beforeend', html);
  }
}

function updateRouteCount() {
  const badge = document.getElementById('route-count');
  if (badge) {
    const count = AppState.allListeners.length;
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
  }
}

// ==================== Routes（消息路由）====================
function renderRoutes() {
  const container = document.getElementById('dash-routes');
  const emptyEl = document.getElementById('dash-routes-empty');
  const summaryEl = document.getElementById('dash-route-summary');
  if (!container) return;

  if (!AppState.allListeners.length) {
    if (emptyEl) emptyEl.style.display = '';
    if (summaryEl) summaryEl.textContent = '0 条路由';
    if (window.paginatedRenderers['routes']) {
      window.paginatedRenderers['routes'].refresh();
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (summaryEl) summaryEl.textContent = `${AppState.allListeners.length} 条路由`;

  if (!window.paginatedRenderers['routes']) {
    window.paginatedRenderers['routes'] = createPaginatedRenderer('dash-routes', renderDashListenerItemWrapper, () => AppState.allListeners, { pageSize: 10 });
  }
  
  const isCollapsed = document.querySelector('.card-collapsible[data-card-id="routes"]')?.classList.contains('collapsed');
  if (!isCollapsed) {
    window.paginatedRenderers['routes'].loadInitialData();
  }
}

function renderDashListenerItemWrapper(listener) {
  return renderDashListenerItem(listener, getForwardTargetName(listener.forwardTargetId), !!listener.enabled);
}

function renderRouteItem(listener) {
  const fwdTarget = getForwardTargetName(listener.forwardTargetId);
  const enabled = !!listener.enabled;
  const lid = escAttr(listener.id);
  const laid = escAttr(listener._accountId);
  const lname = escHtml(listener.name);
  const lchatId = escHtml(formatChatId(listener.chatId, listener.entity));
  const entityLabel = getEntityLabel(listener.entity);
  const enabledClass = enabled ? 'tag-success' : 'tag-neutral';
  const enabledText = enabled ? '监听中' : '已暂停';
  const iconHtml = getChatIconHtml(listener.entity, listener.name);

  let fwdHtml = '';
  if (fwdTarget) {
    fwdHtml = '<span>·</span><span class="fwd-target-label">→ ' + escHtml(fwdTarget) + '</span>';
  }

  let html = '';
  html += '<div class="listener-item entryIn" data-id="' + lid + '" data-account="' + laid + '">';
  html += '  <div class="listener-item-main">';
  html += iconHtml;
  html += '    <label class="toggle">';
  html += '      <input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="toggleListenerEnabled(\'' + lid + '\', \'' + laid + '\')">';
  html += '      <span class="toggle-track"></span><span class="toggle-thumb"></span>';
  html += '    </label>';
  html += '  <div class="listener-item-info">';
  html += '    <div class="listener-item-top">';
  html += '      <span class="listener-item-name" id="name-' + lid + '">' + lname + '</span>';
  html += '    </div>';
  html += '    <div class="listener-item-sub">';
  html += '      <span>ID: ' + lchatId + '</span><span>·</span><span>' + entityLabel + '</span>';
  html += fwdHtml;
  html += '    </div>';
  html += '  </div>';
  html += '  </div>';
  html += '  <div class="listener-item-actions">';
  html += '    <span class="tag ' + enabledClass + '" style="margin-right:8px;line-height:1.8;">' + enabledText + '</span>';
  html += '    <button class="btn btn-ghost btn-sm text-xs listener-item-btn" onclick="configRouteRules(\'' + lid + '\')" title="配置规则">规则</button>';
  html += '    <button class="btn btn-ghost btn-sm text-xs listener-item-btn" onclick="editListener(\'' + lid + '\', \'' + laid + '\')" title="编辑">编辑</button>';
  html += '    <button class="btn btn-ghost btn-sm text-error listener-item-btn icon-btn" onclick="removeListener(\'' + lid + '\', \'' + laid + '\')" title="移除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
  html += '  </div>';
  html += '</div>';

  return html;
}

function onRouteAccountFilterChange(val) {
  renderRoutes();
}

// ==================== 添加路由向导 ====================
let wizardState = { step: 1, accountId: null, listenerId: null, serverId: null };

function showAddRouteWizard() {
  const connectedAccounts = AppState.accounts.filter(a => {
    const state = a.status?.state || a.status?.state;
    return state === 'connected';
  });
  
  if (!AppState.accounts.length) {
    showToast('请先添加账户', 'warning');
    return;
  }
  
  if (!connectedAccounts.length) {
    showToast('没有已连接的账户，请先连接一个账户', 'warning');
    return;
  }
  
  wizardState = { step: 1, accountId: null, listenerId: null, serverId: null };
  document.getElementById('route-wizard-modal').style.display = 'flex';
  renderWizardAccounts();
  showWizardStep(1);
}

function closeRouteWizard(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById('route-wizard-modal');
  if (modal) modal.style.display = 'none';
}

function showWizardStep(step) {
  wizardState.step = step;
  document.getElementById('wizard-step-1').style.display = step === 1 ? '' : 'none';
  document.getElementById('wizard-step-2').style.display = step === 2 ? '' : 'none';
  document.getElementById('wizard-step-3').style.display = step === 3 ? '' : 'none';
  document.getElementById('wizard-prev-btn').style.display = step > 1 ? '' : 'none';
  document.getElementById('wizard-next-btn').style.display = step < 3 ? '' : 'none';
  document.getElementById('wizard-done-btn').style.display = step === 3 ? '' : 'none';
}

function renderWizardAccounts() {
  const container = document.getElementById('wizard-accounts');
  if (!container) return;
  let html = '';
  for (const acc of AppState.accounts) {
    const st = acc.status || {};
    const state = st.state || 'disconnected';
    const isConnected = state === 'connected';
    const aid = escAttr(acc.id);
    html += '<div class="wizard-option ' + (wizardState.accountId === acc.id ? 'wizard-option-selected' : '') + '" onclick="selectWizardAccount(event,\'' + aid + '\')" style="'
      + 'padding:10px 12px;border-radius:var(--radius-md);cursor:pointer;transition:all 0.15s;display:flex;align-items:center;gap:8px;'
      + (isConnected ? '' : 'opacity:0.5;cursor:not-allowed;') + '">';
    html += '<span class="status-dot ' + (isConnected ? 'connected' : 'disconnected') + '" style="width:6px;height:6px;flex-shrink:0;"></span>';
    html += '<span style="font-weight:500;flex:1;">' + escHtml(acc.name || acc.id) + '</span>';
    if (!isConnected) html += '<span style="font-size:11px;color:var(--color-text-tertiary);">未连接</span>';
    html += '</div>';
  }
  container.innerHTML = html;
}

function selectWizardAccount(e, accountId) {
  const acc = AppState.accounts.find(a => a.id === accountId);
  if (!acc || !acc.status || acc.status.state !== 'connected') {
    showToast('请先连接此账户', 'warning');
    return;
  }
  wizardState.accountId = accountId;
  // 高亮选中
  document.querySelectorAll('#wizard-accounts .wizard-option').forEach(el => el.classList.remove('wizard-option-selected'));
  if (e && e.currentTarget) e.currentTarget.classList.add('wizard-option-selected');
  // 自动进入下一步
  wizardNext();
}

function wizardNext() {
  if (wizardState.step === 1 && !wizardState.accountId) {
    showToast('请先选择账户', 'warning');
    return;
  }
  if (wizardState.step === 2 && !wizardState.listenerId) {
    showToast('请先选择监听源', 'warning');
    return;
  }
  if (wizardState.step === 1) {
    showWizardStep(2);
    renderWizardListeners(wizardState.accountId);
  } else if (wizardState.step === 2) {
    showWizardStep(3);
    renderWizardServers();
  }
}

function wizardPrev() {
  if (wizardState.step === 2) {
    wizardState.listenerId = null;
    showWizardStep(1);
  } else if (wizardState.step === 3) {
    wizardState.serverId = null;
    showWizardStep(2);
    renderWizardListeners(wizardState.accountId);
  }
}

function renderWizardListeners(accountId) {
  var container = document.getElementById('wizard-listeners');
  if (!container) return;

  var acc = AppState.accounts.find(function(a) { return a.id === accountId; });
  if (!acc) { container.innerHTML = '<div class="text-sm text-tertiary">账户不存在</div>'; return; }

  // 显示加载状态
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:24px;color:var(--color-text-secondary);font-size:13px;gap:8px;"><div class="spinner spinner-sm"></div><span>加载对话列表...</span></div>';

  // 加载对话列表
  api('/api/accounts/' + encodeURIComponent(accountId) + '/dialogs').then(function(res) {
    var dialogs = res.data || res.dialogs || [];
    if (!dialogs.length) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--color-text-tertiary);font-size:13px;">该账户暂无对话</div>';
      return;
    }

    // 分页：向导中限制显示前50个，提供搜索/筛选
    var pageSize = 50;
    var total = dialogs.length;
    var displayData = total > pageSize ? dialogs.slice(0, pageSize) : dialogs;

    var html = '';
    for (var di = 0; di < displayData.length; di++) {
      var d = displayData[di];
      var exists = (acc.listeners || []).some(function(l) { return String(l.chatId) === String(d.id); });
      var entityLabel = getEntityLabel(d.entity || d.type);
      var isSelected = wizardState.listenerId === d.id;
      var onclickAttr = exists ? '' : 'onclick="selectWizardListener(event,\'' + escAttr(d.id) + '\', \'' + escAttr(d.name || d.title || d.id) + '\', \'' + escAttr(d.entity || d.type) + '\')"';
      html += '<div class="wizard-option ' + (isSelected ? 'wizard-option-selected' : '') + (exists ? ' wizard-option-disabled' : '') + '" '
        + onclickAttr + ' '
        + 'style="padding:8px 12px;border-radius:var(--radius-md);cursor:pointer;transition:all 0.15s;display:flex;align-items:center;gap:8px;font-size:13px;'
        + (exists ? 'opacity:0.4;cursor:not-allowed;' : '') + '">';
      html += getChatIconHtml(d.entity || d.type, d.name || d.title);
      html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(d.name || d.title || 'Unknown') + '</span>';
      html += '<span style="font-size:11px;color:var(--color-text-tertiary);">' + entityLabel + '</span>';
      if (exists) html += '<span style="font-size:10px;color:var(--color-text-tertiary);">已添加</span>';
      html += '</div>';
    }

    // 超出时提示
    if (total > pageSize) {
      html += '<div style="text-align:center;padding:8px;font-size:11px;color:var(--color-text-tertiary);">显示前 ' + pageSize + ' 个（共 ' + total + ' 个），请使用搜索查找更多</div>';
    }

    container.innerHTML = html;
  }).catch(function() {
    container.innerHTML = '<div class="text-sm text-error" style="text-align:center;padding:12px;">加载失败，<a href="#" style="color:var(--color-primary)" onclick="renderWizardListeners(\'' + escAttr(accountId) + '\');return false;">点击重试</a></div>';
  });
}

function selectWizardListener(e, chatId, chatName, entity) {
  wizardState.listenerId = chatId;
  wizardState.listenerName = chatName;
  wizardState.listenerEntity = entity;
  // 高亮
  document.querySelectorAll('#wizard-listeners .wizard-option').forEach(el => el.classList.remove('wizard-option-selected'));
  if (e && e.currentTarget) e.currentTarget.classList.add('wizard-option-selected');
}

function wizardAddManualChat() {
  const input = document.getElementById('wizard-chat-id');
  if (!input) return;
  const rawId = (input.value || '').trim();
  if (!rawId) { showToast('请输入 Chat ID', 'warning'); return; }

  let entityType = 'supergroup';
  if (rawId.indexOf('-100') === 0) entityType = 'supergroup';
  else if (rawId.charAt(0) === '-') entityType = 'group';
  else entityType = 'private';

  wizardState.listenerId = rawId;
  wizardState.listenerName = 'Chat ' + rawId;
  wizardState.listenerEntity = entityType;
  showToast('已选择手动输入的 ID', 'success');
}

async function wizardDone() {
  if (!wizardState.accountId || !wizardState.listenerId) {
    showToast('请完成所有步骤', 'warning');
    return;
  }

  try {
    const res = await api(`/api/accounts/${encodeURIComponent(wizardState.accountId)}/listeners`, {
      method: 'POST',
      body: {
        chatId: wizardState.listenerId,
        name: wizardState.listenerName || wizardState.listenerId,
        entity: wizardState.listenerEntity || 'supergroup',
        forwardTargetId: wizardState.serverId,
      },
    });
    const newListener = res.data || res.listener;
    if (newListener) {
      // 同步更新账户中的 listeners 数组
      const acc = AppState.accounts.find(a => a.id === wizardState.accountId);
      if (acc) {
        if (!acc.listeners) acc.listeners = [];
        acc.listeners.push(newListener);
      }
      // 重新构建 allListeners 以确保一致性
      rebuildAllListeners();
      applyListenerFilter();
      renderRoutes();
      updateRouteCount();
      renderDashRoutes();
      renderListeners();
    }
    showToast('路由已创建', 'success');
    closeRouteWizard(null);
  } catch (e) {
    showToast(e.message || '创建失败', 'error');
  }
}

function renderWizardServers() {
  const container = document.getElementById('wizard-servers');
  if (!container) return;
  if (!AppState.forwardServers.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:16px;color:var(--color-text-secondary);font-size:13px;">
        <div style="margin-bottom:12px;">暂无渠道，将创建不绑定转发目标的路由</div>
        <button class="btn btn-secondary btn-sm" onclick="skipWizardServer()" style="margin-top:8px;">
          继续创建（不绑定）
        </button>
      </div>
    `;
    return;
  }
  let html = '';
  for (const srv of AppState.forwardServers) {
    const sid = escAttr(srv.id);
    const isSelected = wizardState.serverId === srv.id;
    html += '<div class="wizard-option ' + (isSelected ? 'wizard-option-selected' : '') + '" onclick="selectWizardServer(event,\'' + sid + '\')" '
      + 'style="padding:10px 12px;border-radius:var(--radius-md);cursor:pointer;transition:all 0.15s;display:flex;align-items:center;gap:8px;">';
    html += '<span class="tag ' + ({ magicpush: 'tag-primary', webhook: 'tag-success', custom: 'tag-warning' }[srv.type] || 'tag-neutral') + '" style="font-size:10px;">' + ({ magicpush: 'Magic Push', webhook: 'Webhook', custom: '自定义' }[srv.type] || srv.type) + '</span>';
    html += '<span style="font-weight:500;flex:1;min-width:0;">' + escHtml(srv.name) + '</span>';
    html += '<button class="btn btn-ghost btn-sm" style="height:22px;font-size:10px;padding:0 6px;flex-shrink:0;" onclick="event.stopPropagation();showEditServerModal(\'' + sid + '\')" title="编辑">✎</button>';
    html += '</div>';
  }
  html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--color-border);text-align:center;">';
  html += '<button class="btn btn-secondary btn-sm" onclick="skipWizardServer()">跳过（不绑定渠道）</button>';
  html += '</div>';
  container.innerHTML = html;
}

function skipWizardServer() {
  wizardState.serverId = null;
  document.querySelectorAll('#wizard-servers .wizard-option').forEach(el => el.classList.remove('wizard-option-selected'));
}

function selectWizardServer(e, serverId) {
  wizardState.serverId = serverId;
  document.querySelectorAll('#wizard-servers .wizard-option').forEach(el => el.classList.remove('wizard-option-selected'));
  if (e && e.currentTarget) e.currentTarget.classList.add('wizard-option-selected');
}

// ==================== 路由规则配置（从路由列表点"规则"进入）====================
function configRouteRules(listenerId) {
  // 复用现有规则 Tab 的逻辑，但用 Modal 展示
  const listener = AppState.allListeners.find(l => l.id === listenerId);
  if (!listener) return;

  // 构建规则编辑 Modal 的 HTML（简化版，直接操作 listener.rules）
  let rules = listener.rules || {};
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'route-rules-modal';
  modal.innerHTML = '<div class="modal-box modal-lg">'
    + '<div class="modal-header"><div class="modal-title">路由规则 - ' + escHtml(listener.name) + '</div>'
    + '<button class="modal-close" onclick="closeRouteRulesModal()">×</button></div>'
    + '<div class="modal-body" id="route-rules-body">'
    + '  <div class="card mb-4"><div class="card-header"><span class="card-title">包含关键词</span></div>'
    + '    <div class="card-body"><input type="text" class="form-input" id="route-rule-include-input" placeholder="输入后回车添加" onkeydown="if(event.key===\'Enter\')addRouteRuleTag(\'include\', \'' + listenerId + '\')">'
    + '    <div class="flex flex-wrap gap-1 mt-2" id="route-rule-include-tags"></div></div></div>'
    + '  <div class="card mb-4"><div class="card-header"><span class="card-title">排除关键词</span></div>'
    + '    <div class="card-body"><input type="text" class="form-input" id="route-rule-exclude-input" placeholder="输入后回车添加" onkeydown="if(event.key===\'Enter\')addRouteRuleTag(\'exclude\', \'' + listenerId + '\')">'
    + '    <div class="flex flex-wrap gap-1 mt-2" id="route-rule-exclude-tags"></div></div></div>'
    + '  <div class="card mb-4"><div class="card-header"><span class="card-title">忽略选项</span></div>'
    + '    <div class="card-body flex flex-col gap-3">'
    + '      <label class="toggle-wrap"><span>忽略转发消息</span><label class="toggle"><input type="checkbox" id="route-rule-ignore-fwd"><span class="toggle-track"></span><span class="toggle-thumb"></span></label></label>'
    + '      <label class="toggle-wrap"><span>忽略回复消息</span><label class="toggle"><input type="checkbox" id="route-rule-ignore-reply"><span class="toggle-track"></span><span class="toggle-thumb"></span></label></label>'
    + '    </div></div>'
    + '</div>'
    + '<div class="modal-footer"><button class="btn btn-secondary" onclick="closeRouteRulesModal()">取消</button>'
    + '<button class="btn btn-primary" onclick="saveRouteRules(\'' + listenerId + '\')">保存</button></div>'
    + '</div>';
  // 先移除旧的 modal（如果存在）
  const oldModal = document.getElementById('route-rules-modal');
  if (oldModal) oldModal.remove();
  document.body.appendChild(modal);
  modal.style.display = 'flex';

  // 填充现有规则
  renderRouteRuleTags(listenerId, 'include', rules.includeKeywords || []);
  renderRouteRuleTags(listenerId, 'exclude', rules.excludeKeywords || []);
  document.getElementById('route-rule-ignore-fwd').checked = !!rules.ignoreForwarded;
  document.getElementById('route-rule-ignore-reply').checked = !!rules.ignoreReplies;
}

function renderRouteRuleTags(listenerId, type, tags) {
  const el = document.getElementById('route-rule-' + type + '-tags');
  if (!el) return;
  el.innerHTML = (tags || []).map((t, i) =>
    '<span class="tag tag-primary tag-removable" onclick="removeRouteRuleTag(\'' + type + '\', ' + i + ', \'' + listenerId + '\')">' + escHtml(t) + ' ×</span>'
  ).join('');
}

window.addRouteRuleTag = function(type, listenerId) {
  const input = document.getElementById('route-rule-' + type + '-input');
  const val = (input.value || '').trim();
  if (!val) return;
  const listener = AppState.allListeners.find(l => l.id === listenerId);
  if (!listener) return;
  if (!listener.rules) listener.rules = {};
  const key = type === 'include' ? 'includeKeywords' : 'excludeKeywords';
  if (!listener.rules[key]) listener.rules[key] = [];
  if (listener.rules[key].includes(val)) return;
  listener.rules[key].push(val);
  input.value = '';
  renderRouteRuleTags(listenerId, type, listener.rules[key]);
};

window.removeRouteRuleTag = function(type, idx, listenerId) {
  const listener = AppState.allListeners.find(l => l.id === listenerId);
  if (!listener || !listener.rules) return;
  const key = type === 'include' ? 'includeKeywords' : 'excludeKeywords';
  if (listener.rules[key]) listener.rules[key].splice(idx, 1);
  renderRouteRuleTags(listenerId, type, listener.rules[key] || []);
};

function saveRouteRules(listenerId) {
  const listener = AppState.allListeners.find(l => l.id === listenerId);
  if (!listener) return;
  if (!listener.rules) listener.rules = {};

  listener.rules.ignoreForwarded = document.getElementById('route-rule-ignore-fwd').checked;
  listener.rules.ignoreReplies = document.getElementById('route-rule-ignore-reply').checked;

  // 同步更新账户中的 listeners 数组
  const acc = AppState.accounts.find(a => a.id === listener._accountId);
  if (acc && acc.listeners) {
    const accListener = acc.listeners.find(l => l.id === listenerId);
    if (accListener) {
      if (!accListener.rules) accListener.rules = {};
      accListener.rules.ignoreForwarded = listener.rules.ignoreForwarded;
      accListener.rules.ignoreReplies = listener.rules.ignoreReplies;
    }
  }

  // 保存到后端
  api(`/api/accounts/${encodeURIComponent(listener._accountId)}/listeners/${encodeURIComponent(listenerId)}`, {
    method: 'PUT',
    body: { rules: listener.rules },
  }).then(() => {
    showToast('规则已保存', 'success');
    closeRouteRulesModal();
  }).catch(e => showToast(e.message || '保存失败', 'error'));
}

function closeRouteRulesModal() {
  const modal = document.getElementById('route-rules-modal');
  if (modal) modal.remove();
}

// ==================== 初始化时更新 ====================
// 在 DOMContentLoaded 中已调用 renderAccounts/renderForwardServers
// 切换到 dashboard/routes/logs tab 时刷新
const _origSwitchTab = switchTab;
switchTab = function(tabId) {
  _origSwitchTab(tabId);
  if (tabId === 'dashboard') refreshDashboard();
  if (tabId === 'logs') LogRenderer.render();
};

// ==================== 账户设置 Modal ====================
function showAccountSettingsModal() {
  const container = document.getElementById('account-settings-list');
  if (!container) return;

  if (!AppState.accounts.length) {
    container.innerHTML = '<div class="empty-state" style="padding:var(--space-8);">'
      + '<div class="empty-state-title">暂无账户</div>'
      + '<div class="empty-state-desc">点击「添加账户」开始</div></div>';
  } else {
    let html = '<div class="account-grid">';
    for (const acc of AppState.accounts) {
      const status = acc.status || {};
      const state = status.state || 'disconnected';
      const stateClass = state === 'connected' ? 'connected' : state === 'connecting' || state === 'authenticating' ? 'connecting' : 'disconnected';
      let userDisplay = '';
      if (status.user) {
        userDisplay = typeof status.user === 'object'
          ? (status.user.username || status.user.firstName || '')
          : String(status.user);
      }
      const lid = escAttr(acc.id);
      html += '<div class="account-card">';
      html += '<div class="account-card-header">';
      html += '<div class="account-card-info">';
      html += '<div class="account-card-name">' + escHtml(acc.name || '未命名') + '</div>';
      html += '<div class="account-card-meta">';
      if (userDisplay) html += '<span class="account-user">@' + escHtml(userDisplay) + '</span>';
      html += '<span class="account-listener-count">' + ((acc.listeners || []).length) + ' 个监听源</span>';
      html += '</div></div>';
      // 操作按钮
      html += '<div class="flex gap-2">';
      if (state === 'disconnected') {
        html += '<button class="btn btn-primary btn-sm" onclick="connectAccount(\'' + lid + '\')">连接</button>';
      } else if (state === 'connected') {
        html += '<button class="btn btn-danger-outline btn-sm" onclick="disconnectAccount(\'' + lid + '\')">断开</button>';
      } else if (state === 'authenticating' || state === 'waiting_code') {
        html += '<button class="btn btn-primary btn-sm" onclick="LoginFlow.show(\'' + lid + '\');closeAccountSettingsModal();">登录验证</button>';
      } else {
        html += '<div class="spinner spinner-sm"></div>';
      }
      html += '<button class="btn btn-ghost btn-sm" onclick="showEditAccountModal(\'' + lid + '\');closeAccountSettingsModal();">编辑</button>';
      html += '<button class="btn btn-ghost btn-sm text-error" onclick="deleteAccountAndRefresh(\'' + lid + '\')">删除</button>';
      html += '</div></div></div>';
    }
    html += '</div>';
    container.innerHTML = html;
  }
  showModal('account-settings-modal');
}

function closeAccountSettingsModal() {
  hideModal('account-settings-modal');
}

function onAccountSettingsOverlayClick(e) {
  if (e.target === e.currentTarget) closeAccountSettingsModal();
}

async function deleteAccountAndRefresh(id) {
  await deleteAccount(id);
  showAccountSettingsModal();
}

// ==================== 配置文件管理 ====================
function exportConfig() {
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: AppState.settings || DEFAULT_SETTINGS,
    accounts: AppState.accounts || [],
    forwardServers: AppState.forwardServers || []
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tg-magicpush-config-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('配置已导出', 'success');
}

async function importConfig(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.version || !data.settings) {
      throw new Error('无效的配置文件');
    }

    if (!confirm('导入配置将覆盖现有设置，确定继续？')) {
      return;
    }

    if (data.settings) {
      AppState.settings = data.settings;
    }

    if (data.accounts && Array.isArray(data.accounts)) {
      for (const acc of data.accounts) {
        try {
          const existing = AppState.accounts.find(a => a.id === acc.id);
          if (existing) {
            await api(`/api/accounts/${encodeURIComponent(acc.id)}`, { method: 'PUT', body: acc });
          } else {
            await api('/api/accounts', { method: 'POST', body: acc });
          }
        } catch (e) {
          console.error('Failed to restore account', e);
        }
      }
    }

    if (data.forwardServers && Array.isArray(data.forwardServers)) {
      for (const fs of data.forwardServers) {
        try {
          const existing = AppState.forwardServers.find(a => a.id === fs.id);
          if (existing) {
            await api(`/api/forward-servers/${encodeURIComponent(fs.id)}`, { method: 'PUT', body: fs });
          } else {
            await api('/api/forward-servers', { method: 'POST', body: fs });
          }
        } catch (e) {
          console.error('Failed to restore forward server', e);
        }
      }
    }

    await loadAllData();
    showToast('配置导入成功', 'success');
    if (AppState.settings) {
      loadSettingsToForm();
      if (AppState.settings.theme) setTheme(AppState.settings.theme);
      if (AppState.settings.themeColor) setThemeColor(AppState.settings.themeColor);
    }
  } catch (e) {
    showToast(e.message || '导入失败', 'error');
  } finally {
    event.target.value = '';
  }
}

// ==================== 增强的日志管理 ====================

// 日志类型变化处理 - 动态显示对应筛选条件
function onLogTypeChange() {
  const typeFilter = (document.getElementById('log-type-filter') || {}).value || '';
  const levelContainer = document.getElementById('filter-level-container');
  const statusContainer = document.getElementById('filter-status-container');
  const levelFilter = document.getElementById('log-level-filter');
  const statusFilter = document.getElementById('log-status-filter');
  const searchInput = document.getElementById('log-search-input');

  // 隐藏所有条件容器
  if (levelContainer) levelContainer.style.display = 'none';
  if (statusContainer) statusContainer.style.display = 'none';

  // 根据类型显示对应的筛选条件
  if (typeFilter === 'system') {
    // 系统日志 - 显示级别筛选
    if (levelContainer) levelContainer.style.display = '';
    if (searchInput) searchInput.placeholder = '搜索系统日志内容...';
    // 清空状态筛选
    if (statusFilter) statusFilter.selectedIndex = 0;
  } else if (typeFilter === 'operation') {
    // 操作日志 - 只显示搜索框
    if (searchInput) searchInput.placeholder = '搜索操作日志内容...';
    // 清空级别和状态筛选
    if (levelFilter) levelFilter.selectedIndex = 0;
    if (statusFilter) statusFilter.selectedIndex = 0;
  } else if (typeFilter === 'message') {
    // 消息日志 - 显示状态筛选
    if (statusContainer) statusContainer.style.display = '';
    if (searchInput) searchInput.placeholder = '搜索消息内容...';
    // 清空级别筛选
    if (levelFilter) levelFilter.selectedIndex = 0;
  } else if (typeFilter === 'server') {
    // 服务端日志 - 显示级别筛选
    if (levelContainer) levelContainer.style.display = '';
    if (searchInput) searchInput.placeholder = '搜索服务端日志...';
    // 清空状态筛选
    if (statusFilter) statusFilter.selectedIndex = 0;
  } else {
    // 全部类型 - 显示级别和状态筛选
    if (levelContainer) levelContainer.style.display = '';
    if (statusContainer) statusContainer.style.display = '';
    if (searchInput) searchInput.placeholder = '搜索日志内容...';
  }

  // 重置页码并重新筛选
  LogState.currentPage = 1;
  LogRenderer.render();
}

// 筛选变化处理
function onFilterChange() {
  LogState.currentPage = 1;
  LogRenderer.render();
}

// 切换自动刷新
function toggleAutoRefresh() {
  const checkbox = document.getElementById('log-auto-refresh');
  LogState.autoRefresh = checkbox ? checkbox.checked : true;
  showToast(LogState.autoRefresh ? '自动刷新已开启' : '自动刷新已关闭', 'info');
}

// 切换导出下拉菜单
function toggleExportDropdown(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('export-dropdown');
  if (dropdown) {
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  }
}

// 点击外部关闭下拉菜单
document.addEventListener('click', () => {
  const dropdown = document.getElementById('export-dropdown');
  if (dropdown) dropdown.style.display = 'none';
});

// 导出日志（使用后端API）
async function exportLogs(format = 'json') {
  try {
    const filters = LogRenderer.getFilterParams();
    const params = new URLSearchParams({
      format,
      type: filters.type || 'all',
      level: filters.level || 'all',
      status: filters.status || 'all',
      search: filters.search || ''
    });

    const url = `/api/logs/export?${params.toString()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `tg-push-logs-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    
    showToast(`正在导出 ${format.toUpperCase()} 文件...`, 'info');
  } catch (e) {
    console.error('Export failed:', e);
    showToast('导出失败: ' + (e.message || '未知错误'), 'error');
  }
}

// 从服务器刷新日志
async function refreshLogsFromServer() {
  try {
    showToast('正在刷新日志...', 'info');
    
    const filters = LogRenderer.getFilterParams();
    const params = new URLSearchParams({
      type: filters.type || '',
      level: filters.level || '',
      status: filters.status || '',
      search: filters.search || '',
      page: LogState.currentPage,
      pageSize: LogState.pageSize
    });

    const response = await api(`/api/logs?${params.toString()}`);
    
    if (response && response.success && response.data) {
      // 更新服务器日志数据
      LogState.serverLogs = response.data.items || [];
      LogState.totalLogs = response.data.pagination?.total || 0;
      
      // 重新渲染
      LogRenderer.render();
      showToast('日志已刷新', 'success');
    }
  } catch (e) {
    console.error('Refresh failed:', e);
    showToast('刷新失败: ' + (e.message || '未知错误'), 'error');
  }
}

// 分页切换
function changePage(delta) {
  LogState.currentPage += delta;
  if (LogState.currentPage < 1) LogState.currentPage = 1;
  LogRenderer.render();
}

// 旧的函数保持兼容
function filterLogs() {
  onFilterChange();
}

function refreshLogs() {
  LogRenderer.render();
}

function clearLogs() {
  // 保持现有功能
  AppState.logs = [];
  try {
    localStorage.removeItem('tg_push_message_logs');
  } catch (e) {}
  LogState.currentPage = 1;
  LogRenderer.render();
  showToast('日志已清空', 'success');
}

// ==================== 账户信息 ====================
function showAccountInfo() {
  const content = document.getElementById('account-info-content');
  const connectedAccounts = AppState.accounts.filter(a => a.state === 'connected');

  if (connectedAccounts.length === 0) {
    content.innerHTML = '<div style="color:var(--color-text-tertiary);">暂无账户连接</div>';
  } else {
    let html = '';
    for (const acc of connectedAccounts) {
      html += `
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:var(--space-4);margin-bottom:var(--space-3);text-align:left;">
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;">
            <div style="width:48px;height:48px;border-radius:50%;background:var(--color-primary-100);display:flex;align-items:center;justify-content:center;">
              ${acc.firstName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:600;color:var(--color-text-primary);">${acc.firstName}${acc.lastName ? ' ' + acc.lastName : ''}</div>
              ${acc.username ? `<div style="font-size:13px;color:var(--color-text-secondary);">@${acc.username}</div>` : ''}
              ${acc.phone ? `<div style="font-size:13px;color:var(--color-text-tertiary);">${acc.phone}</div>` : ''}
            </div>
          </div>
          <div style="font-size:13px;color:var(--color-text-tertiary);">
            <div><strong>账户 ID:</strong> ${acc.id}</div>
            <div><strong>状态:</strong> ${acc.state}</div>
            ${acc.userId ? `<div><strong>用户 ID:</strong> ${acc.userId}</div>` : ''}
          </div>
        </div>
      `;
    }
    content.innerHTML = html;
  }

  showModal('account-modal');
}

function closeAccountModal() {
  hideModal('account-modal');
}

function onAccountModalOverlayClick(e) {
  if (e.target === e.currentTarget) closeAccountModal();
}
