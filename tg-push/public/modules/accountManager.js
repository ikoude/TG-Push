/**
 * ============================================================
 * 账户管理器模块 - AccountManager
 * 
 * 功能说明：
 * - 统一管理多个 Telegram 账户的生命周期
 * - 提供账户的添加、编辑、删除、连接、断开等核心功能
 * - 实现登录流程的统一管理（验证码、两步验证）
 * - 管理多账户的状态隔离和同步
 * - 提供统一的 API 接口和事件通知机制
 * 
 * 使用示例：
 *   AccountManager.getAccount('acc_123')
 *   AccountManager.connect('acc_123')
 *   AccountManager.delete('acc_123')
 * ============================================================
 */

/**
 * 账户管理器 - 主类
 */
const AccountManager = {
  /**
   * 获取指定 ID 的账户
   * @param {string} accountId - 账户 ID
   * @returns {object|null} 账户对象或 null
   */
  getAccount(accountId) {
    if (!accountId) return null;
    return AppState.accounts.find(acc => acc.id === accountId) || null;
  },

  /**
   * 获取所有账户
   * @returns {Array} 账户列表
   */
  getAllAccounts() {
    return AppState.accounts || [];
  },

  /**
   * 获取当前激活的账户
   * @returns {object|null} 当前激活的账户对象或 null
   */
  getActiveAccount() {
    return this.getAccount(AppState.activeAccountId);
  },

  /**
   * 设置当前激活的账户并跳转到监听源标签页
   * @param {string} accountId - 账户 ID
   */
  async setActiveAccount(accountId) {
    if (!accountId || !this.getAccount(accountId)) {
      showToast('账户不存在', 'error');
      return;
    }
    
    AppState.activeAccountId = accountId;
    
    // 检查该账户是否有有效的 session，如果没有但已配置，尝试连接
    const account = this.getAccount(accountId);
    if (account && !this.isAccountConnected(accountId)) {
      // 检查是否有已保存的 session
      try {
        // 尝试自动连接
        showToast('正在连接账户...', 'info');
        await this.connect(accountId);
      } catch (e) {
        console.warn('账户自动连接失败:', e.message);
        showToast('账户未连接，请手动点击"连接"按钮', 'warning');
      }
    }
    
    // 重新渲染依赖激活账户的 UI
    renderDashAccounts();
    renderAccounts();
    
    // 跳转到消息路由标签页（包含监听源管理功能）
    if (typeof switchTab === 'function') {
      switchTab('routes');
    }
    
    // 延迟更新监听源筛选器以确保 DOM 已更新
    setTimeout(() => {
      const routeAccountFilter = document.getElementById('route-account-filter');
      if (routeAccountFilter) {
        routeAccountFilter.value = accountId;
        if (typeof onRouteAccountFilterChange === 'function') {
          onRouteAccountFilterChange(accountId);
        }
      }
    }, 100);
    
    showToast('已切换到账户：' + (account.name || accountId), 'success');
  },

  /**
   * 检查账户是否已连接
   * @param {string} accountId - 账户 ID
   * @returns {boolean} 是否已连接
   */
  isAccountConnected(accountId) {
    const account = this.getAccount(accountId);
    if (!account) return false;
    
    const state = account.status?.state;
    return state === 'connected';
  },

  /**
   * 获取账户连接状态
   * @param {string} accountId - 账户 ID
   * @returns {string} 状态: disconnected|connecting|authenticating|connected
   */
  getAccountState(accountId) {
    const acc = this.getAccount(accountId);
    return acc?.status?.state || 'disconnected';
  },

  /**
   * 处理会话过期
   * @param {string} accountId - 账户 ID
   */
  handleSessionExpired(accountId) {
    // 显示一个确认对话框，询问用户是否要重新登录
    if (confirm('该账户的会话已过期，是否要重新登录？')) {
      // 设置当前账户为活跃账户
      AppState.activeAccountId = accountId;
      // 显示编辑账户模态框，让用户可以重新登录
      showEditAccountModal(accountId);
    }
  },

  /**
   * 连接账户
   * @param {string} accountId - 账户 ID
   * @returns {Promise<void>}
   */
  async connect(accountId) {
    if (!accountId) {
      showToast('账户 ID 不能为空', 'error');
      return;
    }

    const acc = this.getAccount(accountId);
    if (!acc) {
      showToast('账户不存在', 'error');
      return;
    }

    try {
      showToast('正在连接...', 'info');
      await api(`/api/accounts/${encodeURIComponent(accountId)}/connect`, {
        method: 'POST',
      });
    } catch (e) {
      let errorMsg = e.message || '服务器错误，请稍后重试';
      
      // 处理常见的连接错误
      if (errorMsg.includes('session') || errorMsg.includes('会话')) {
        errorMsg = '会话已过期，需要重新登录';
        // 显示登录对话框，让用户重新登录
        this.handleSessionExpired(accountId);
      } else if (errorMsg.includes('network') || errorMsg.includes('网络')) {
        errorMsg = '网络连接失败，请检查网络设置';
      } else if (errorMsg.includes('timeout') || errorMsg.includes('超时')) {
        errorMsg = '连接超时，请检查网络和服务器状态';
      } else if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('找不到')) {
        errorMsg = '无法连接到服务器，请检查服务器地址';
      }
      
      // 显示错误提示，持续5秒
      showToast(errorMsg, 'error', 5000);
      
      // 更新账户卡片的连接状态显示
      this.updateConnectionStatus(accountId, 'error', errorMsg);
    }
  },

  /**
   * 断开账户连接
   * @param {string} accountId - 账户 ID
   * @returns {Promise<void>}
   */
  async disconnect(accountId) {
    if (!accountId) {
      showToast('账户 ID 不能为空', 'error');
      return;
    }

    const acc = this.getAccount(accountId);
    if (!acc) {
      showToast('账户不存在', 'error');
      return;
    }

    try {
      await api(`/api/accounts/${encodeURIComponent(accountId)}/disconnect`, {
        method: 'POST',
      });
    } catch (e) {
      showToast(e.message || '断开连接失败', 'error');
    }
  },

  /**
   * 更新账户卡片的连接状态显示
   * @param {string} accountId - 账户 ID
   * @param {string} state - 连接状态：'connected', 'connecting', 'disconnected', 'error'
   * @param {string} errorMsg - 错误信息（可选）
   */
  updateConnectionStatus(accountId, state, errorMsg) {
    const cardEl = document.querySelector(`.account-card-item[data-account-id="${accountId}"]`);
    if (!cardEl) return;

    const statusDot = cardEl.querySelector('.status-dot');
    const statusText = cardEl.querySelector('.status-text');
    
    if (!statusDot || !statusText) return;

    // 更新状态点和文本
    statusDot.className = `status-dot ${state}`;
    
    const stateText = {
      connected: '已连接',
      connecting: '连接中...',
      disconnected: '未连接',
      error: '连接错误'
    };
    
    statusText.textContent = stateText[state] || state;

    // 如果有错误信息，更新详情区域的代理显示
    if (errorMsg && state === 'error') {
      const detailsEl = cardEl.querySelector('.account-card-item-details');
      if (detailsEl) {
        const errorDetail = detailsEl.querySelector('.detail-item-error');
        if (!errorDetail) {
          const newDetail = document.createElement('div');
          newDetail.className = 'detail-item detail-item-error';
          newDetail.innerHTML = `
            <span class="detail-label">错误</span>
            <span class="detail-value text-error">${errorMsg}</span>
          `;
          detailsEl.appendChild(newDetail);
        } else {
          errorDetail.querySelector('.detail-value').textContent = errorMsg;
        }
      }
    }
  },

  /**
   * 删除账户
   * @param {string} accountId - 账户 ID
   * @returns {Promise<void>}
   */
  async delete(accountId) {
    if (!accountId) {
      showToast('账户 ID 不能为空', 'error');
      return;
    }

    const acc = this.getAccount(accountId);
    if (!acc) {
      showToast('账户不存在', 'error');
      return;
    }

    try {
      await api(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      });

      AppState.accounts = AppState.accounts.filter(a => a.id !== accountId);
      
      // 如果删除的是当前激活的账户，清空激活账户
      if (AppState.activeAccountId === accountId) {
        AppState.activeAccountId = null;
      }

      // 重新渲染相关 UI
      rebuildAllListeners();
      renderAccounts();
      renderDashAccounts();
      renderDashRoutes();
      renderListeners();
      populateAccountFilters();
      updateRouteCount();
      
      showToast(`账户「${acc.name || accountId}」已删除`, 'success');
    } catch (e) {
      showToast(e.message || '删除失败', 'error');
    }
  },

  /**
   * 安全清除所有账户数据
   * 此操作将删除所有账户信息和 session 数据
   * @returns {Promise<void>}
   */
  async clearAllAccounts() {
    if (!confirm('警告：此操作将清除所有账户数据、监听源配置和转发规则！\n\n此操作不可恢复，确定要继续吗？')) {
      return;
    }

    try {
      // 逐个删除所有账户
      const accounts = [...AppState.accounts];
      for (const acc of accounts) {
        try {
          await api(`/api/accounts/${encodeURIComponent(acc.id)}`, {
            method: 'DELETE',
          });
        } catch (e) {
          console.warn(`删除账户 ${acc.id} 失败:`, e);
        }
      }

      // 清空 AppState
      AppState.accounts = [];
      AppState.activeAccountId = null;
      AppState.listeners = [];
      AppState.allListeners = [];

      // 重新渲染所有相关 UI
      renderAccounts();
      renderDashAccounts();
      renderDashRoutes();
      renderListeners();
      populateAccountFilters();
      updateRouteCount();

      showToast('所有账户数据已安全清除', 'success');
    } catch (e) {
      showToast(e.message || '清除账户数据失败', 'error');
    }
  },

  /**
   * 保存或更新账户配置
   * @param {string|null} accountId - 账户 ID（新增时为 null）
   * @param {object} config - 账户配置
   * @returns {Promise<void>}
   */
  async save(accountId, config) {
    try {
      let result;
      
      if (accountId) {
        // 更新现有账户
        result = await api(`/api/accounts/${encodeURIComponent(accountId)}`, {
          method: 'PATCH',
          body: config,
        });
      } else {
        // 创建新账户
        result = await api('/api/accounts', {
          method: 'POST',
          body: config,
        });
      }

      hideModal('account-modal');
      
      // 如果是新建账户，自动激活并尝试连接
      if (!accountId && result.id) {
        AppState.activeAccountId = result.id;
        showToast('账户已添加，正在连接...', 'info');
        try {
          await this.connect(result.id);
        } catch (e) {
          showToast(e.message || '连接失败，请检查配置', 'warning');
        }
      }
      
    } catch (e) {
      showToast(e.message || '保存失败', 'error');
    }
  },
};

/**
 * 登录流程管理器
 */
const LoginFlow = {
  /**
   * 显示登录验证弹窗
   * @param {string} accountId - 账户 ID
   * @param {string} [accountName] - 账户名称
   */
  show(accountId, accountName) {
    const acc = AccountManager.getAccount(accountId);
    const displayName = acc?.name || accountName || accountId;

    const titleEl = document.getElementById('login-modal-title');
    const targetIdEl = document.getElementById('login-target-account-id');
    
    if (!titleEl || !targetIdEl) {
      console.warn('[LoginFlow] 登录弹窗元素未找到');
      return;
    }

    titleEl.innerHTML =
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:-2px;margin-right:6px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> 登录 Telegram — ${escHtml(displayName)}`;
    
    targetIdEl.value = accountId;
    
    this.reset();
    showModal('login-modal');
  },

  /**
   * 重置登录流程到初始状态
   */
  reset() {
    const lastPhone = localStorage.getItem('tg_last_phone');
    const phoneInput = document.getElementById('login-phone-input');
    const codeRow = document.getElementById('code-input-row');
    const phoneRow = document.getElementById('phone-input-row');
    const step2fa = document.getElementById('login-step-2fa');
    
    // 清空输入框
    const els = ['login-phone-input', 'login-code', 'login-2fa'];
    els.forEach(id => { 
      const el = document.getElementById(id); 
      if (el) el.value = '';
    });
    
    // 清除所有错误提示
    this.clearCodeError();
    const phoneInputEl = document.getElementById('login-phone-input');
    const tfaInputEl = document.getElementById('login-2fa');
    if (phoneInputEl) phoneInputEl.classList.remove('error');
    if (tfaInputEl) tfaInputEl.classList.remove('error');
    
    // 恢复显示状态
    if (phoneRow) phoneRow.style.display = '';
    if (codeRow) codeRow.style.display = 'none';
    if (step2fa) step2fa.style.display = 'none';
    
    // 自动填充上次使用的手机号
    if (lastPhone && phoneInput) phoneInput.value = lastPhone;
  },

  /**
   * 发送验证码
   */
  async sendCode() {
    const inputEl = document.getElementById('login-phone-input');
    if (!inputEl) {
      showToast('登录界面未就绪', 'error');
      return;
    }

    const phone = String(inputEl.value || '').trim().replace(/\s/g, '');

    // 清除之前的错误状态
    inputEl.classList.remove('error');

    if (!phone) {
      showToast('请输入手机号', 'warning');
      inputEl.classList.add('error');
      inputEl.focus();
      return;
    }

    // 格式校验：必须以 + 开头，且包含数字
    if (phone[0] !== '+') {
      showToast('手机号需以 + 开头（国际格式），如 +8613800138000', 'warning');
      inputEl.classList.add('error');
      inputEl.focus();
      return;
    }

    const digitsOnly = phone.replace(/[+]/g, '');
    if (digitsOnly.length < 7 || !/^\d+$/.test(digitsOnly)) {
      showToast('手机号格式不正确，请检查后重试', 'warning');
      inputEl.classList.add('error');
      inputEl.focus();
      return;
    }

    // 保存手机号到 localStorage
    try {
      localStorage.setItem('tg_last_phone', phone);
    } catch (e) {}

    const accountId = document.getElementById('login-target-account-id').value;
    if (!accountId) {
      showToast('目标账户丢失，请重新操作', 'error');
      return;
    }

    try {
      await api(`/api/accounts/${encodeURIComponent(accountId)}/auth/send-code`, {
        method: 'POST',
        body: { phoneNumber: phone },
      });

      const phoneRow = document.getElementById('phone-input-row');
      const codeRow = document.getElementById('code-input-row');
      const phoneDisplay = document.getElementById('login-phone-display');
      
      if (phoneDisplay) phoneDisplay.textContent = phone;
      if (phoneRow) phoneRow.style.display = 'none';
      if (codeRow) codeRow.style.display = '';
      
      // 自动聚焦验证码输入框
      const codeInput = document.getElementById('login-code');
      if (codeInput) codeInput.focus();
      
    } catch (e) {
      showToast(e.message || '发送验证码失败', 'error');
    }
  },

  /**
   * 清除验证码错误提示
   */
  clearCodeError() {
    const codeInput = document.getElementById('login-code');
    const codeError = document.getElementById('login-code-error');
    if (codeInput) codeInput.classList.remove('error');
    if (codeError) codeError.style.display = 'none';
  },

  /**
   * 提交验证码
   */
  async submitCode() {
    const codeInput = document.getElementById('login-code');
    const codeError = document.getElementById('login-code-error');
    const code = (codeInput?.value || '').trim();

    if (!code) {
      if (codeInput) codeInput.classList.add('error');
      if (codeError) codeError.style.display = '';
      if (codeInput) codeInput.focus();
      return;
    }

    const accountId = document.getElementById('login-target-account-id').value;
    if (!accountId) {
      showToast('目标账户丢失，请重新操作', 'error');
      return;
    }

    try {
      const result = await api(`/api/accounts/${encodeURIComponent(accountId)}/auth/verify`, {
        method: 'POST',
        body: { code },
      });

      if (result.needTwoFactor) {
        // 需要两步验证
        const codeRow = document.getElementById('code-input-row');
        const step2fa = document.getElementById('login-step-2fa');
        
        if (codeRow) codeRow.style.display = 'none';
        if (step2fa) step2fa.style.display = '';
        
        // 自动聚焦两步验证输入框
        const tfaInput = document.getElementById('login-2fa');
        if (tfaInput) tfaInput.focus();
      } else {
        // 登录成功，关闭弹窗
        hideModal('login-modal');
        showToast('登录成功', 'success');
      }
      
    } catch (e) {
      showToast(e.message || '验证码错误', 'error');
    }
  },

  /**
   * 提交两步验证密码
   */
  async submit2FA() {
    const tfaInput = document.getElementById('login-2fa');
    const password = (tfaInput?.value || '').trim();

    if (!password) {
      showToast('请输入两步验证密码', 'warning');
      if (tfaInput) tfaInput.classList.add('error');
      return;
    }

    const accountId = document.getElementById('login-target-account-id').value;
    if (!accountId) {
      showToast('目标账户丢失，请重新操作', 'error');
      return;
    }

    try {
      await api(`/api/accounts/${encodeURIComponent(accountId)}/auth/password`, {
        method: 'POST',
        body: { password },
      });

      hideModal('login-modal');
      showToast('登录成功', 'success');
      
    } catch (e) {
      showToast(e.message || '两步验证失败', 'error');
    }
  },
};

/**
 * 账户模态框管理器 - 处理添加/编辑账户及手机验证
 */
const AccountModal = {
  countdownTimer: null,
  countdownSeconds: 0,
  tempAccountId: null,
  isCreatingNewAccount: false,  // 标记是否正在创建新账户（尚未完全验证）
  phoneCodeHash: null,         // 保存 phoneCodeHash

  /**
   * 显示错误提示
   */
  showPhoneError(msg) {
    const errEl = document.getElementById('account-phone-error');
    const inputEl = document.getElementById('account-phone');
    if (errEl) {
      errEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' + msg;
      errEl.style.display = '';
    }
    if (inputEl) inputEl.classList.add('error');
  },

  /**
   * 清除手机号错误提示
   */
  clearPhoneError() {
    const errEl = document.getElementById('account-phone-error');
    const inputEl = document.getElementById('account-phone');
    if (errEl) errEl.style.display = 'none';
    if (inputEl) inputEl.classList.remove('error');
  },

  /**
   * 显示验证码错误提示
   */
  showCodeError(msg) {
    const errEl = document.getElementById('account-code-error');
    const inputEl = document.getElementById('account-code');
    if (errEl) {
      errEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' + msg;
      errEl.style.display = '';
    }
    if (inputEl) inputEl.classList.add('error');
  },

  /**
   * 清除验证码错误提示
   */
  clearCodeError() {
    const errEl = document.getElementById('account-code-error');
    const inputEl = document.getElementById('account-code');
    if (errEl) errEl.style.display = 'none';
    if (inputEl) inputEl.classList.remove('error');
  },

  /**
   * 验证手机号格式
   */
  validatePhone(phone) {
    if (!phone || !phone.trim()) {
      return { valid: false, error: '请输入手机号' };
    }

    const cleanPhone = phone.trim().replace(/\s/g, '');

    if (cleanPhone[0] !== '+') {
      return { valid: false, error: '手机号需以 + 开头（国际格式），如 +8613800138000' };
    }

    const digitsOnly = cleanPhone.replace(/[+]/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      return { valid: false, error: '手机号格式不正确，请检查后重试' };
    }

    if (!/^\d+$/.test(digitsOnly)) {
      return { valid: false, error: '手机号只能包含数字' };
    }

    return { valid: true };
  },

  /**
   * 开始倒计时
   */
  startCountdown(seconds = 60) {
    this.countdownSeconds = seconds;
    const btn = document.getElementById('account-send-code-btn');
    const hint = document.getElementById('account-phone-hint');

    if (btn) {
      btn.disabled = true;
      this.updateCountdownText();
    }

    if (hint) {
      hint.textContent = '';
      hint.style.display = 'none';
    }

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }

    this.countdownTimer = setInterval(() => {
      this.countdownSeconds--;
      this.updateCountdownText();

      if (this.countdownSeconds <= 0) {
        this.stopCountdown();
      }
    }, 1000);
  },

  /**
   * 更新倒计时文本
   */
  updateCountdownText() {
    const btn = document.getElementById('account-send-code-btn');
    if (btn) {
      if (this.countdownSeconds > 0) {
        btn.textContent = `${this.countdownSeconds}s 后重试`;
      } else {
        btn.textContent = '获取验证码';
      }
    }
  },

  /**
   * 停止倒计时
   */
  stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownSeconds = 0;

    const btn = document.getElementById('account-send-code-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
    }
  },

  /**
   * 发送验证码
   */
  async sendCode() {
    const phoneInput = document.getElementById('account-phone');
    const phone = (phoneInput?.value || '').trim();

    this.clearPhoneError();

    // 验证 API 凭证
    const apiIdInput = document.getElementById('account-api-id');
    const apiHashInput = document.getElementById('account-api-hash');
    const apiId = (apiIdInput?.value || '').trim();
    const apiHash = (apiHashInput?.value || '').trim();

    if (!apiId || !apiHash) {
      this.showPhoneError('请先填写 API ID 和 API Hash');
      if (!apiId) apiIdInput?.focus();
      else apiHashInput?.focus();
      return;
    }

    const validation = this.validatePhone(phone);
    if (!validation.valid) {
      this.showPhoneError(validation.error);
      phoneInput?.focus();
      return;
    }

    const btn = document.getElementById('account-send-code-btn');
    if (btn) btn.disabled = true;

    try {
      const nameInput = document.getElementById('account-name');
      const proxyEnabled = document.getElementById('account-proxy-enabled');
      const proxyType = document.getElementById('account-proxy-type');
      const proxyHost = document.getElementById('account-proxy-host');
      const proxyPort = document.getElementById('account-proxy-port');
      const proxyUsername = document.getElementById('account-proxy-username');
      const proxyPassword = document.getElementById('account-proxy-password');

      const accountData = {
        name: nameInput?.value || phone,
        apiId: parseInt(apiId, 10),
        apiHash: apiHash,
        phoneNumber: phone,
        proxy: proxyEnabled?.checked ? {
          enabled: true,
          type: proxyType?.value || 'socks5',
          host: proxyHost?.value || '',
          port: parseInt(proxyPort?.value, 10) || 1080,
          username: proxyUsername?.value || '',
          password: proxyPassword?.value || '',
        } : { enabled: false },
      };

      // 先创建账户（但标记为正在创建新账户，暂时不要刷新UI
      this.isCreatingNewAccount = true;
      
      const result = await api('/api/accounts', {
        method: 'POST',
        body: accountData,
      });

      this.tempAccountId = result.data?.id || result.id;

      // 立即连接并发送验证码
      try {
        await api(`/api/connect`, {
          method: 'POST',
          body: { 
            accountId: this.tempAccountId,
            apiId: parseInt(apiId, 10),
            apiHash: apiHash,
            proxy: accountData.proxy
          },
        });
      } catch (connectErr) {
        console.warn('[AccountModal] 连接失败，尝试只发送验证码:', connectErr.message);
      }

      // 发送验证码
      const codeResult = await api('/api/send-code', {
        method: 'POST',
        body: { accountId: this.tempAccountId, phoneNumber: phone },
      });

      // 保存 phoneCodeHash 用于后续验证
      this.phoneCodeHash = codeResult.data?.phoneCodeHash;

      const codeRow = document.getElementById('account-code-row');
      const hint = document.getElementById('account-phone-hint');

      if (codeRow) codeRow.style.display = '';
      if (hint) {
        const message = codeResult.data?.message || '验证码已发送，请查收短信';
        hint.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#27ae60;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' + message;
        hint.style.display = '';
      }

      const codeInput = document.getElementById('account-code');
      if (codeInput) codeInput.focus();

      this.startCountdown(60);

      showToast('验证码已发送', 'success');

    } catch (e) {
      let errorMsg = e.message || '发送验证码失败';
      
      // 如果创建账户失败，清理标记
      this.cleanupTempAccount();
      
      // 提供更友好的错误提示
      if (errorMsg.includes('API') || errorMsg.includes('apiId') || errorMsg.includes('apiHash')) {
        errorMsg = '请检查 API ID 和 API Hash 是否正确';
      } else if (errorMsg.includes('network') || errorMsg.includes('Network') || errorMsg.includes('connect')) {
        errorMsg = '网络连接失败，请检查网络和代理设置';
      } else if (errorMsg.includes('timeout')) {
        errorMsg = '请求超时，请稍后重试';
      }
      
      this.showPhoneError(errorMsg);
      this.stopCountdown();
    }
  },

  /**
   * 保存账户（完整流程：发送验证码 → 验证 → 保存）
   */
  async save() {
    // 检查是否在两步验证阶段
    const passwordRow = document.getElementById('account-password-row');
    if (passwordRow && passwordRow.style.display !== 'none') {
      // 处理两步验证
      const passwordInput = document.getElementById('account-password');
      const password = (passwordInput?.value || '').trim();
      if (!password) {
        this.showPasswordError('请输入两步验证密码');
        passwordInput?.focus();
        return;
      }

      const btn = document.getElementById('account-save-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '验证中...';
      }

      try {
        await api(`/api/accounts/${encodeURIComponent(this.tempAccountId)}/auth/password`, {
          method: 'POST',
          body: { password },
        });

        this.completeAccountCreation();

      } catch (e) {
        this.showPasswordError(e.message || '两步验证失败');
        if (btn) {
          btn.disabled = false;
          btn.textContent = '验证';
        }
      }
      return;
    }

    // 检查是否在验证码验证阶段
    const codeRow = document.getElementById('account-code-row');
    if (codeRow && codeRow.style.display !== 'none' && this.tempAccountId) {
      // 处理验证码验证
      const codeInput = document.getElementById('account-code');
      const code = (codeInput?.value || '').trim();

      if (!code || code.length < 4) {
        this.showCodeError('请输入验证码');
        codeInput?.focus();
        return;
      }

      const btn = document.getElementById('account-save-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '验证中...';
      }

      try {
        const result = await api(`/api/accounts/${encodeURIComponent(this.tempAccountId)}/auth/verify`, {
          method: 'POST',
          body: { code, phoneCodeHash: this.phoneCodeHash },
        });

        if (result.needTwoFactor || (result.data && result.data.need2FA)) {
          // 需要两步验证，切换到密码输入界面
          this.switchToPasswordInput();
        } else {
          // 登录成功，完成创建
          this.completeAccountCreation();
        }

      } catch (e) {
        // 更细致的错误处理
        let errorMsg = e.message || '验证码错误';
        
        if (errorMsg.includes('timeout') || errorMsg.includes('超时')) {
          errorMsg = '验证码已超时，请重新获取';
          // 允许用户重新发送验证码
          this.stopCountdown();
        } else if (errorMsg.includes('invalid') || errorMsg.includes('错误')) {
          errorMsg = '验证码不正确，请检查后重试';
        } else if (errorMsg.includes('expired') || errorMsg.includes('过期')) {
          errorMsg = '验证码已过期，请重新获取';
          this.stopCountdown();
        }
        
        this.showCodeError(errorMsg);
        if (btn) {
          btn.disabled = false;
          btn.textContent = '保存并连接';
        }
      }
      return;
    }

    // 如果没有在任何验证阶段，则先发送验证码
    await this.sendCode();
  },

  /**
   * 切换到两步验证密码输入界面
   */
  switchToPasswordInput() {
    // 隐藏验证码输入
    const codeRow = document.getElementById('account-code-row');
    const passwordRow = document.getElementById('account-password-row');
    const hint = document.getElementById('account-phone-hint');

    if (codeRow) codeRow.style.display = 'none';
    if (passwordRow) passwordRow.style.display = '';
    if (hint) {
      hint.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#2980b9;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>账户开启了两步验证，请输入密码';
      hint.style.display = '';
    }

    // 更改按钮文字
    const btn = document.getElementById('account-save-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '验证';
    }
  },

  /**
   * 清理临时创建的账户（用于验证失败或取消时）
   */
  async cleanupTempAccount() {
    if (this.isCreatingNewAccount && this.tempAccountId) {
      try {
        // 尝试删除还未验证完成的临时账户
        await api(`/api/accounts/${encodeURIComponent(this.tempAccountId)}`, {
          method: 'DELETE',
        });
        console.log('[AccountModal] 已清理临时创建的账户:', this.tempAccountId);
      } catch (e) {
        console.warn('[AccountModal] 清理临时账户失败:', e.message);
      }
    }
    this.isCreatingNewAccount = false;
    this.tempAccountId = null;
  },

  /**
   * 完成账户创建
   */
  async completeAccountCreation() {
    const accountIdToKeep = this.tempAccountId;
    const wasCreatingNew = this.isCreatingNewAccount;

    this.reset();
    hideModal('account-modal');

    try {
      // 获取最新的账户列表
      const response = await api('/api/accounts');
      const newAccounts = response.data || [];

      // 移除重复的账户（基于 ID 去重）
      const existingIds = new Set();
      const uniqueAccounts = [];
      for (const acc of newAccounts) {
        if (!existingIds.has(acc.id)) {
          existingIds.add(acc.id);
          uniqueAccounts.push(acc);
        } else {
          console.warn('[AccountManager] 发现重复账户，已移除:', acc.id);
        }
      }

      // 如果当前创建的账户已存在但有重复，确保只保留一个
      const accountExists = uniqueAccounts.some(a => a.id === accountIdToKeep);
      if (!accountExists && accountIdToKeep) {
        // 如果账户不存在于列表中，尝试从临时状态中恢复
        console.warn('[AccountManager] 账户', accountIdToKeep, '不在列表中，尝试刷新...');
      }

      AppState.accounts = uniqueAccounts;
      AppState.activeAccountId = accountIdToKeep;

      // 完整刷新所有相关 UI
      renderAccounts();
      renderDashAccounts();
      renderDashRoutes();
      rebuildAllListeners();  // ✅ 新增：刷新监听源列表
      populateAccountFilters();  // ✅ 新增：刷新账户筛选器

      showToast('账户添加成功', 'success');

      // 自动连接
      if (accountIdToKeep) {
        try {
          await api(`/api/accounts/${encodeURIComponent(accountIdToKeep)}/connect`, {
            method: 'POST',
          });
        } catch (e) {
          console.warn('自动连接失败:', e.message);
        }
      }
    } catch (e) {
      console.error('[AccountManager] 刷新账户列表失败:', e);
      showToast('账户添加成功，但刷新列表失败，请手动刷新', 'warning');
    }
  },

  /**
   * 显示密码错误提示
   */
  showPasswordError(msg) {
    const errEl = document.getElementById('account-password-error');
    const inputEl = document.getElementById('account-password');
    if (errEl) {
      errEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' + msg;
      errEl.style.display = '';
    }
    if (inputEl) inputEl.classList.add('error');
  },

  /**
   * 清除密码错误提示
   */
  clearPasswordError() {
    const errEl = document.getElementById('account-password-error');
    const inputEl = document.getElementById('account-password');
    if (errEl) errEl.style.display = 'none';
    if (inputEl) inputEl.classList.remove('error');
  },

  /**
   * 测试代理连接
   */
  async testProxy() {
    const testBtn = document.getElementById('account-test-proxy-btn');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = '测试中...';
    }

    const proxyEnabled = document.getElementById('account-proxy-enabled');
    const proxyType = document.getElementById('account-proxy-type');
    const proxyHost = document.getElementById('account-proxy-host');
    const proxyPort = document.getElementById('account-proxy-port');
    const proxyUsername = document.getElementById('account-proxy-username');
    const proxyPassword = document.getElementById('account-proxy-password');

    const proxyConfig = {
      enabled: proxyEnabled?.checked,
      type: proxyType?.value || 'socks5',
      host: proxyHost?.value || '',
      port: parseInt(proxyPort?.value, 10) || 7890,
      username: proxyUsername?.value || '',
      password: proxyPassword?.value || '',
    };

    try {
      const result = await api('/api/check-reachability', {
        method: 'POST',
        body: { proxy: proxyConfig },
      });

      showToast('代理连接测试成功！', 'success');
    } catch (e) {
      showToast(e.message || '代理连接测试失败', 'error');
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.textContent = '测试连接';
      }
    }
  },

  /**
   * 重置模态框状态
   */
  reset() {
    this.stopCountdown();
    // 注意：不要在这里清理临时账户，completeAccountCreation 已经保存了账户ID
    // 只有在失败或取消时才清理
    this.phoneCodeHash = null;

    const els = ['account-phone', 'account-code', 'account-password'];
    els.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    this.clearPhoneError();
    this.clearCodeError();
    this.clearPasswordError();

    // 重置到验证码输入阶段
    const codeRow = document.getElementById('account-code-row');
    const passwordRow = document.getElementById('account-password-row');
    const hint = document.getElementById('account-phone-hint');
    const codeInput = document.getElementById('account-code');
    const passwordInput = document.getElementById('account-password');
    
    if (codeRow) codeRow.style.display = 'none';
    if (passwordRow) passwordRow.style.display = 'none';
    if (hint) hint.style.display = 'none';
    if (codeInput) codeInput.value = '';
    if (passwordInput) passwordInput.value = '';

    const btn = document.getElementById('account-save-btn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '保存并连接';
    }
  },
};

/**
 * UI 渲染器 - 账户列表相关
 */
const AccountRenderer = {
  /**
   * 获取用户头像显示（如果没有头像则显示默认头像）
   * @param {object} user - 用户对象
   * @param {string} name - 账户名称
   * @returns {string} HTML 字符串
   */
  getAvatarHtml(user, name) {
    const initials = (name || 'User').charAt(0).toUpperCase();
    
    return `<div class="account-avatar">
      <span class="account-avatar-text">${initials}</span>
    </div>`;
  },

  /**
   * 渲染账户卡片（用于概览页面）
   * @param {object} acc - 账户对象
   * @returns {string} HTML 字符串
   */
  renderCard(acc) {
    const st = acc.status || {};
    const state = st.state || 'disconnected';
    const dotClass = state === 'connected' ? 'connected' : state === 'connecting' || state === 'authenticating' ? 'connecting' : 'disconnected';
    
    // 获取用户信息
    let userInfo = {
      username: '',
      firstName: '',
      lastName: '',
      phone: ''
    };
    if (st.user && typeof st.user === 'object') {
      userInfo = {
        username: st.user.username || '',
        firstName: st.user.firstName || '',
        lastName: st.user.lastName || '',
        phone: st.user.phone || acc.phone || ''
      };
    } else if (st.user) {
      userInfo.firstName = st.user;
    }

    const listenerCount = (acc.listeners || []).length;
    const isActive = AppState.activeAccountId === acc.id;

    let actionsHtml = '';
    if (state === 'disconnected') {
      actionsHtml = `<button class="btn btn-primary btn-sm w-full" onclick="AccountManager.connect('${escAttr(acc.id)}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg> 连接
      </button>`;
    } else if (state === 'connecting') {
      actionsHtml = `<div class="flex justify-center p-2">
        <div class="spinner spinner-sm"></div>
        <span class="text-secondary text-sm ml-2">连接中...</span>
      </div>`;
    } else if (state === 'authenticating') {
      actionsHtml = `<button class="btn btn-primary btn-sm w-full" onclick="LoginFlow.show('${escAttr(acc.id)}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 12v4"/><path d="M12 12h4"/><path d="M12 12h-4"/><path d="M12 12v-4"/></svg> 登录验证
      </button>`;
    } else if (state === 'connected') {
      actionsHtml = `<button class="btn btn-danger-outline btn-sm w-full" onclick="AccountManager.disconnect('${escAttr(acc.id)}')">断开连接</button>`;
    } else {
      actionsHtml = `<button class="btn btn-secondary btn-sm w-full" onclick="AccountManager.connect('${escAttr(acc.id)}')">重试连接</button>`;
    }

    // 构建完整的账户卡片 HTML
    return `<div class="account-card-item ${isActive ? 'active' : ''}" data-account-id="${escAttr(acc.id)}">
      <div class="account-card-item-header">
        ${this.getAvatarHtml(st.user, acc.name)}
        <div class="account-card-item-info">
          <div class="account-card-item-name">
            ${escHtml(acc.name || acc.id)}
            ${isActive ? '<span class="tag tag-primary tag-sm ml-2">当前</span>' : ''}
          </div>
          ${userInfo.username ? `<div class="account-card-item-username">@${escHtml(userInfo.username)}</div>` : ''}
          ${userInfo.phone ? `<div class="account-card-item-phone">${escHtml(userInfo.phone)}</div>` : ''}
          ${acc.phone && !userInfo.phone ? `<div class="account-card-item-phone">${escHtml(acc.phone)}</div>` : ''}
        </div>
        <div class="account-card-item-status">
          <span class="status-dot ${dotClass}"></span>
          <span class="status-text">${this.getStatusText(state)}</span>
        </div>
      </div>
      
      <div class="account-card-item-details">
        <div class="detail-item">
          <span class="detail-label">监听源</span>
          <span class="detail-value">${listenerCount} 个</span>
        </div>
        ${acc.proxy && acc.proxy.enabled ? `
        <div class="detail-item">
          <span class="detail-label">代理</span>
          <span class="detail-value">${escHtml(acc.proxy.type || 'SOCKS5')} ${escHtml(acc.proxy.host || '')}:${escHtml(acc.proxy.port || '')}</span>
        </div>
        ` : ''}
      </div>
      
      <div class="account-card-item-actions">
        ${actionsHtml}
        <div class="account-card-item-more-actions">
          <button class="btn btn-ghost btn-sm" onclick="showEditAccountModal('${escAttr(acc.id)}')" title="编辑账户">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            编辑
          </button>
          <button class="btn btn-ghost btn-sm text-error" onclick="AccountManager.delete('${escAttr(acc.id)}')" title="删除账户">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            删除
          </button>
        </div>
      </div>
    </div>`;
  },

  /**
   * 获取状态文本
   * @param {string} state - 状态值
   * @returns {string} 状态文本
   */
  getStatusText(state) {
    const statusMap = {
      'connected': '已连接',
      'connecting': '连接中',
      'authenticating': '待登录',
      'disconnected': '未连接',
      'error': '错误'
    };
    return statusMap[state] || '未知';
  },

  /**
   * 渲染账户列表项（用于其他页面）
   * @param {object} acc - 账户对象
   * @returns {string} HTML 字符串
   */
  renderListItem(acc) {
    const st = acc.status || {};
    const state = st.state || 'disconnected';
    const dotClass = state === 'connected' ? 'connected' : state === 'connecting' || state === 'authenticating' ? 'connecting' : 'disconnected';
    
    let userShow = '';
    if (st.user) {
      userShow = typeof st.user === 'object' ? (st.user.username || st.user.firstName || '') : st.user;
    }
    
    const listenerCount = (acc.listeners || []).length;
    const accId = escAttr(acc.id);
    const isActive = AppState.activeAccountId === acc.id;
    
    let actionBtn = '';
    if (state === 'disconnected') {
      actionBtn = `<button class="btn btn-primary btn-sm list-item-btn" onclick="AccountManager.connect('${accId}')">连接</button>`;
    } else if (state === 'connected') {
      actionBtn = `<button class="btn btn-danger-outline btn-sm list-item-btn" onclick="AccountManager.disconnect('${accId}')">断开</button>`;
    } else if (state === 'connecting') {
      actionBtn = '<span class="list-item-meta">连接中...</span>';
    } else if (state === 'authenticating') {
      actionBtn = `<button class="btn btn-primary btn-sm list-item-btn" onclick="LoginFlow.show('${accId}')">登录验证</button>`;
    } else {
      actionBtn = `<span class="list-item-meta">${state}</span>`;
    }

    return `<div class="list-item ${isActive ? 'active' : ''}">
      <span class="status-dot ${dotClass}"></span>
      <span class="list-item-name">${escHtml(acc.name || acc.id)}</span>
      ${userShow ? `<span class="list-item-meta">@${escHtml(userShow)}</span>` : ''}
      <span class="list-item-meta">${listenerCount} 源</span>
      ${actionBtn}
      <button class="btn btn-ghost btn-sm list-item-btn icon-btn" onclick="event.stopPropagation(); showEditAccountModal('${accId}')" title="编辑">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
      <button class="btn btn-ghost btn-sm text-error list-item-btn icon-btn" onclick="event.stopPropagation(); AccountManager.delete('${accId}')" title="删除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>`;
  },
};
