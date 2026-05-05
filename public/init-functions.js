// ==================== 系统初始化功能 ====================

/**
 * 清除所有账户数据
 */
async function clearAllAccounts() {
  try {
    const response = await fetch('/api/init/clear-accounts', { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      showToast('账户数据已清除', 'success');
      AppState.accounts = [];
      AppState.activeAccountId = null;
      AppState.allListeners = [];
      AppState.listeners = [];
      renderAccounts();
      renderListeners();
      updateConnectionUI();
    } else {
      showToast('清除失败: ' + (result.errors?.[0] || '未知错误'), 'error');
    }
  } catch (error) {
    showToast('清除账户失败: ' + error.message, 'error');
  }
}

/**
 * 清除所有日志（消息日志和操作日志）
 */
async function clearAllLogs() {
  try {
    const response = await fetch('/api/init/clear-logs', { method: 'POST' });
    const result = await response.json();

    if (result.success) {
      showToast('日志已清除', 'success');
      AppState.logs = [];
      try {
        localStorage.removeItem('tg_push_message_logs');
      } catch (e) {}
      LogRenderer.render();
    } else {
      showToast('清除失败: ' + (result.errors?.[0] || '未知错误'), 'error');
    }
  } catch (error) {
    showToast('清除日志失败: ' + error.message, 'error');
  }
}

/**
 * 还原系统配置至默认状态
 */
async function restoreSystemConfig() {
  try {
    const response = await fetch('/api/init/restore-config', { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      showToast('配置已还原', 'success');
      loadSettingsToForm();
      closeSettingsModal();
    } else {
      showToast('还原失败: ' + (result.errors?.[0] || '未知错误'), 'error');
    }
  } catch (error) {
    showToast('还原配置失败: ' + error.message, 'error');
  }
}

/**
 * 执行完整初始化（清除所有数据）
 */
async function performFullInit() {
  try {
    showToast('正在执行初始化...', 'info');
    
    const response = await fetch('/api/init/full', { method: 'POST' });
    const result = await response.json();
    
    if (result.overallSuccess) {
      showToast('初始化完成，系统已恢复至初始状态', 'success');
      AppState.accounts = [];
      AppState.activeAccountId = null;
      AppState.forwardServers = [];
      AppState.inboundWebhooks = [];
      AppState.allListeners = [];
      AppState.listeners = [];
      AppState.logs = [];
      AppState.stats = { received: 0, forwarded: 0, skipped: 0, failed: 0 };
      AppState.connectionStatus = { state: 'disconnected', user: null };

      try {
        localStorage.removeItem('tg_push_message_logs');
        localStorage.removeItem('tg_push_stats');
      } catch (e) {}

      loadSettingsToForm();
      
      renderAccounts();
      renderListeners();
      renderServers();
      renderWebhooks();
      LogRenderer.render();
      updateConnectionUI();
      
      closeSettingsModal();
    } else {
      const errors = [
        ...(result.accountData.errors || []),
        ...(result.logs.errors || []),
        ...(result.config.errors || [])
      ];
      showToast('初始化失败: ' + errors.join('; ') || '未知错误', 'error');
    }
  } catch (error) {
    showToast('初始化失败: ' + error.message, 'error');
  }
}