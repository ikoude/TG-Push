/**
 * src/services/telegram-client.js — gramjs TG 客户端封装 v2
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { NewMessage } = require('telegram/events');
const configManager = require('../config');

const ConnectionState = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  WAITING_CODE: 'waiting_code',
  WAITING_2FA: 'waiting_password',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

class TGClient {
  constructor(accountId) {
    this.accountId = accountId;
    this.client = null;
    this.state = ConnectionState.IDLE;
    this.userInfo = null;
    this.forwarder = null;
    this.isListening = false;
    this._statusCallbacks = [];
    this._messageCallbacks = [];
    this._reconnectTimer = null;
    this._reconnectCount = 0;
  }

  onStatusChange(callback) {
    this._statusCallbacks.push(callback);
  }

  onMessage(callback) {
    this._messageCallbacks.push(callback);
  }

  removeCallback(callback) {
    this._statusCallbacks = this._statusCallbacks.filter(cb => cb !== callback);
    this._messageCallbacks = this._messageCallbacks.filter(cb => cb !== callback);
  }

  _emitStatus(data) {
    const payload = {
      accountId: this.accountId,
      state: this.state,
      user: this.userInfo,
      listening: this.isListening,
      ...data,
      timestamp: new Date().toISOString()
    };
    for (const cb of this._statusCallbacks) {
      try { cb(payload); } catch (e) { /* ignore */ }
    }
  }

  _emitMessage(msg) {
    for (const cb of this._messageCallbacks) {
      try { cb(msg); } catch (e) { /* ignore */ }
    }
  }

  setForwarder(forwarder) {
    this.forwarder = forwarder;
  }

  getForwarderForTarget(targetId) {
    if (!targetId) {
      return this.forwarder;
    }
    if (this.forwarder?.id === targetId) {
      return this.forwarder;
    }
    if (this.forwarders && this.forwarders.has(targetId)) {
      return this.forwarders.get(targetId);
    }
    return null;
  }

  getStatus() {
    return {
      accountId: this.accountId,
      state: this.state,
      user: this.userInfo ? {
        id: this.userInfo.id,
        firstName: this.userInfo.firstName,
        lastName: this.userInfo.lastName || '',
        username: this.userInfo.username || '',
        phone: this.userInfo.phone || ''
      } : null,
      listening: this.isListening,
      reconnectCount: this._reconnectCount
    };
  }

  async checkReachability(proxyConfig) {
    const config = configManager.get();
    const account = configManager.getAccount(this.accountId);
    const proxy = proxyConfig || account?.proxy || config.telegram?.proxy;

    console.log(`[TG:${this.accountId}] 检测 API 可达性...`);

    const start = Date.now();
    const TG_DC2_HOST = '149.154.167.51';
    const TG_DC2_PORT = 443;

    try {
      if (proxy && proxy.enabled && proxy.host) {
        const { SocksClient } = require('socks');
        const info = await SocksClient.createConnection({
          proxy: {
            host: proxy.host,
            port: parseInt(proxy.port, 10),
            type: 5,
            userId: proxy.username || undefined,
            password: proxy.password || undefined
          },
          command: 'connect',
          timeout: 12000,
          destination: { host: TG_DC2_HOST, port: TG_DC2_PORT }
        });
        info.socket.destroy();
      } else {
        await new Promise((resolve, reject) => {
          const net = require('net');
          const socket = net.createConnection({ host: TG_DC2_HOST, port: TG_DC2_PORT, timeout: 10000 }, resolve);
          socket.on('error', reject);
          socket.on('timeout', () => reject(new Error('连接超时')));
          socket.once('connect', () => { socket.destroy(); resolve(); });
        });
      }

      const latency = Date.now() - start;
      console.log(`[TG:${this.accountId}] API 可达, 延迟 ${latency}ms`);
      return { reachable: true, latencyMs: latency };

    } catch (err) {
      const latency = Date.now() - start;
      const msg = err.message || String(err);

      let errorDetail = msg;
      if (msg.includes('timed out') || msg.includes('ETIMEDOUT') || msg.includes('超时')) {
        errorDetail = '连接超时，请检查代理是否正常运行';
      } else if (msg.includes('ECONNREFUSED')) {
        errorDetail = '代理连接被拒绝，请检查代理服务是否运行';
      } else if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
        errorDetail = 'DNS 解析失败，请检查代理地址是否正确';
      } else if (msg.includes('SOCKS') || msg.includes('socks')) {
        errorDetail = 'SOCKS5 代理错误：' + msg;
      }

      return { reachable: false, error: errorDetail, latencyMs: latency };
    }
  }

  async connect(params = {}) {
    const account = configManager.getAccount(this.accountId);

    const apiId = params.apiId || account?.apiId || 0;
    const apiHash = params.apiHash || account?.apiHash || '';
    const proxy = params.proxy || account?.proxy || {};

    if (!apiId || !apiHash) {
      throw new Error('API ID 和 API Hash 不能为空');
    }

    this._setState(ConnectionState.CONNECTING);
    this._emitStatus({ message: '正在连接到 Telegram...' });

    try {
      const sessionString = configManager.getSession(this.accountId) || '';

      const clientParams = {
        connectionRetries: 3,
        retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000)
      };

      if (proxy && proxy.enabled && proxy.host) {
        clientParams.proxy = this._buildProxyOptions(proxy);
      }

      this.client = new TelegramClient(
        new StringSession(sessionString),
        apiId,
        apiHash,
        clientParams
      );

      console.log(`[TG:${this.accountId}] 开始连接...`);
      await this.client.connect();
      console.log(`[TG:${this.accountId}] TCP 连接建立`);

      const isAuthorized = await this.client.checkAuthorization();

      if (isAuthorized) {
        const me = await this.client.getMe();
        this.userInfo = me;
        this._setState(ConnectionState.CONNECTED);

        const currentSession = this.client.session.save();
        if (currentSession && currentSession.length > 10) {
          configManager.saveSession(this.accountId, currentSession);
        }

        if (account) {
          configManager.updateAccount(this.accountId, {
            status: { state: 'connected', user: { firstName: me.firstName, lastName: me.lastName || '', username: me.username || '', phone: me.phone || '' } }
          });
        }

        this._startListening();
        console.log(`[TG:${this.accountId}] 已连接为: ${me.firstName} (${me.username || me.id})`);
        this._emitStatus({ message: `已连接为 ${me.firstName}` });
        return { connected: true, authorized: true, user: this._formatUser(me) };
      } else {
        this._setState(ConnectionState.WAITING_CODE);
        this._emitStatus({ message: '请输入手机号和验证码' });
        return { connected: true, authorized: false, needPhone: true };
      }
    } catch (err) {
      console.error(`[TG:${this.accountId}] 连接失败:`, err.message);
      this._setState(ConnectionState.ERROR);
      this._emitStatus({ error: err.message });

      if (this.client) {
        try { await this.client.destroy(); } catch (e) { /**/ }
        this.client = null;
      }

      throw err;
    }
  }

  async sendCode(phoneNumber) {
    if (!this.client) {
      throw new Error('未连接，请先调用 connect()');
    }

    const account = configManager.getAccount(this.accountId);
    const config = configManager.get();
    console.log(`[TG:${this.accountId}] 发送验证码到 ${phoneNumber}`);
    this._setState(ConnectionState.WAITING_CODE);
    this._emitStatus({ message: `正在发送验证码到 ${phoneNumber}...` });

    this._pendingPhone = phoneNumber;

    const result = await this.client.sendCode(
      { apiId: account?.apiId || config.telegram?.apiId, apiHash: account?.apiHash || config.telegram?.apiHash },
      phoneNumber
    );

    this._emitStatus({ message: `验证码已发送到 ${phoneNumber}` });
    return {
      phoneCodeHash: result.phoneCodeHash,
      isCodeViaApp: result.isCodeViaApp,
      message: result.isCodeViaApp ? '验证码已发送到 Telegram App' : '验证码已通过短信发送'
    };
  }

  async signIn(code, phoneCodeHash) {
    if (!this.client) {
      throw new Error('未连接');
    }

    const phoneNumber = this._pendingPhone;
    if (!phoneNumber) {
      throw new Error('未找到手机号，请重新发送验证码');
    }

    try {
      const result = await this.client.invoke(new Api.auth.SignIn({
        phoneNumber,
        phoneCodeHash,
        phoneCode: code
      }));

      const user = result.user || result;
      await this._onAuthorized(user);
      return { success: true };
    } catch (err) {
      const errMsg = err.errorMessage || err.message || String(err);

      if (errMsg === 'SESSION_PASSWORD_NEEDED' || errMsg.includes('SESSION_PASSWORD_NEEDED')) {
        this._setState(ConnectionState.WAITING_2FA);
        this._emitStatus({ message: '需要两步验证密码' });
        return { need2FA: true, hint: '' };
      }
      if (errMsg.includes('PHONE_CODE_INVALID') || errMsg.includes('PHONE_CODE_EXPIRED')) {
        throw new Error('验证码错误或已过期，请重新获取');
      }
      if (errMsg.includes('PHONE_CODE_EMPTY')) {
        throw new Error('验证码不能为空');
      }
      if (errMsg.includes('PHONE_NUMBER_UNOCCUPIED')) {
        throw new Error('该号码尚未注册 Telegram');
      }
      throw err;
    }
  }

  async submitPassword(password) {
    if (!this.client) {
      throw new Error('未连接');
    }

    const account = configManager.getAccount(this.accountId);
    const config = configManager.get();

    const user = await this.client.signInWithPassword(
      { apiId: account?.apiId || config.telegram?.apiId, apiHash: account?.apiHash || config.telegram?.apiHash },
      {
        password: async () => password,
        onError: async (err) => {
          console.error(`[TG:${this.accountId}] 2FA 错误:`, err.message);
          return true;
        }
      }
    );

    await this._onAuthorized(user);
    return { success: true };
  }

  async disconnect(clearSession = false) {
    console.log(`[TG:${this.accountId}] 断开连接...`);

    this.isListening = false;

    if (clearSession && this.client) {
      try { await this.client.logOut(); } catch (e) { console.warn(`[TG:${this.accountId}] 注销时出错:`, e.message); }
      configManager.deleteSession(this.accountId);
    }

    if (this.client) {
      try { await this.client.destroy(); } catch (e) { /**/ }
      this.client = null;
    }

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._reconnectCount = 0;
    this.userInfo = null;
    this.forwarder = null;

    const account = configManager.getAccount(this.accountId);
    if (account) {
      configManager.updateAccount(this.accountId, { status: { state: 'disconnected' } });
    }

    this._setState(ConnectionState.DISCONNECTED);
    this._emitStatus({ message: clearSession ? '已断开并清除 Session' : '已断开' });

    return { success: true };
  }

  async getDialogs(limit = 100) {
    if (!this.client) {
      throw new Error('未连接');
    }

    const result = await this.client.getDialogs({ limit });
    const dialogs = [];

    for (const dialog of result) {
      const entity = dialog.entity;
      if (!entity) continue;

      dialogs.push({
        id: entity.id,
        accessHash: entity.accessHash,
        name: entity.title || entity.firstName || entity.lastName ||
              `${entity.firstName || ''} ${entity.lastName || ''}`.trim() || 'Unknown',
        type: this._detectEntityType(entity),
        unreadCount: dialog.unreadCount || 0
      });
    }

    return dialogs;
  }

  async _onAuthorized(userEntity) {
    this.userInfo = userEntity;
    this._setState(ConnectionState.CONNECTED);

    const sessionString = this.client.session.save();
    if (sessionString && sessionString.length > 10) {
      configManager.saveSession(this.accountId, sessionString);
    }

    this._startListening();
    console.log(`[TG:${this.accountId}] 登录成功: ${userEntity.firstName} (${userEntity.username || userEntity.id})`);
    this._emitStatus({ message: `已连接为 ${userEntity.firstName}`, user: this._formatUser(userEntity) });
  }

  _startListening() {
    if (!this.client || this.isListening) return;

    this.isListening = true;
    this._reconnectCount = 0;

    console.log(`[TG:${this.accountId}] 开始监听消息...`);
    this.client.addEventHandler(this._handleNewMessage.bind(this), new NewMessage({}));
  }

  async _handleNewMessage(event) {
    if (!this.isListening) return;

    const message = event.message;
    if (!message) return;
    if (message.out) return;

    const account = configManager.getAccount(this.accountId);
    if (!account) return;

    const listeners = account.listeners || [];
    const chatId = event.chatId || event.message?.peerId?.chatId || event.message?.peerId?.channelId || event.message?.peerId?.userId || '';
    const normalizedEventChatId = this._normalizeChatId(chatId);

    const matchedListener = listeners.find(l =>
      l.chatId && this._normalizeChatId(l.chatId) === normalizedEventChatId
    );

    if (!matchedListener) {
      console.log(`[Filter:${this.accountId}] 跳过非监听源消息: chatId=${chatId}`);
      return;
    }

    const chatEntity = event.message.peerId;
    let sender;
    try { sender = await event.message.getSender(); } catch (e) { sender = null; }

    const sourceName = await this._getSourceName(event, listeners);
    const messageType = this._getMessageType(message);
    const textContent = message.text || '';
    const mediaType = messageType !== 'text' ? messageType : null;

    const msgRecord = {
      id: message.id.toString(),
      timestamp: new Date(message.date * 1000).toISOString(),
      accountId: this.accountId,
      accountName: account.name,
      source: {
        type: this._detectPeerType(chatEntity),
        name: sourceName,
        chatId: chatId,
        senderName: sender ? (sender.firstName || sender.username || sender.id.toString()) : ''
      },
      content: {
        text: textContent,
        mediaType: mediaType,
        hasForward: !!message.fwdFrom,
        hasReply: !!message.replyTo
      },
      filter: null,
      forward: null
    };

    const filterResult = this._filterMessage(msgRecord, matchedListener, account);
    msgRecord.filter = filterResult;

    if (!filterResult.matched) {
      console.log(`[Filter:${this.accountId}] 消息被跳过 - 监听源: ${matchedListener.name}, 原因: ${filterResult.skippedReason}, 规则: ${JSON.stringify(filterResult.matchedRule)}`);
    }

    if (filterResult.matched) {
      const targetForwarder = this.getForwarderForTarget(matchedListener.forwardTargetId);

      if (targetForwarder) {
        const formattedMsg = this._formatMessageForPush(msgRecord);
        const forwardResult = await targetForwarder.send(
          `[${sourceName}]`,
          formattedMsg
        );
        msgRecord.forward = {
          status: forwardResult.success ? 'success' : 'failed',
          timestamp: new Date().toISOString(),
          error: forwardResult.error || null,
          retryCount: 0,
          targetServer: targetForwarder.name
        };

        if (!forwardResult.success) {
          console.error(`[Forward:${this.accountId}] 失败 (${targetForwarder.name}): ${forwardResult.error}`);
        }
      } else {
        console.warn(`[Forward:${this.accountId}] 监听源 ${matchedListener.name} 未绑定转发目标`);
        msgRecord.forward = {
          status: 'skipped',
          skippedReason: '未绑定转发目标',
          timestamp: new Date().toISOString()
        };
      }
    } else {
      msgRecord.forward = {
        status: 'skipped',
        skippedReason: filterResult.skippedReason,
        timestamp: new Date().toISOString()
      };
    }

    this._emitMessage(msgRecord);
  }

  _filterMessage(msgRecord, listener, account) {
    const globalFilters = configManager.get().filters;
    const filters = listener.rules && Object.keys(listener.rules).length > 0
      ? listener.rules
      : globalFilters;

    if (!filters) {
      console.debug(`[Filter:${this.accountId}] 监听源 ${listener.name} 无过滤规则，使用全局规则:`, globalFilters);
      if (!globalFilters) return { matched: false, skippedReason: '无过滤规则', matchedRule: null };
    } else {
      console.debug(`[Filter:${this.accountId}] 监听源 ${listener.name} 使用自有规则:`, filters);
    }

    const text = filters.caseSensitive ? msgRecord.content.text : msgRecord.content.text.toLowerCase();

    console.debug(`[Filter:${this.accountId}] 过滤消息 - 文本长度: ${text.length}, 内容: ${text.slice(0, 50)}...`);

    if (filters.ignoreForwarded && msgRecord.content.hasForward) {
      return { matched: false, skippedReason: '转发消息', matchedRule: null };
    }

    if (filters.ignoreReplies && msgRecord.content.hasReply) {
      return { matched: false, skippedReason: '回复消息', matchedRule: null };
    }

    const textLen = msgRecord.content.text.length;
    if (filters.minLength > 0 && textLen < filters.minLength) {
      return { matched: false, skippedReason: `文本过短(${textLen} < ${filters.minLength})`, matchedRule: null };
    }
    if (filters.maxLength > 0 && textLen > filters.maxLength) {
      return { matched: false, skippedReason: `文本过长(${textLen} > ${filters.maxLength})`, matchedRule: null };
    }

    if (filters.ignoreService && !msgRecord.content.text && !msgRecord.content.mediaType) {
      return { matched: false, skippedReason: '服务消息', matchedRule: null };
    }

    if (filters.mediaTypes && filters.mediaTypes.length > 0) {
      const allowedMedia = ['text', ...(filters.mediaTypes || [])];
      if (msgRecord.content.mediaType && !allowedMedia.includes(msgRecord.content.mediaType)) {
        return { matched: false, skippedReason: `媒体类型 ${msgRecord.content.mediaType} 不在允许列表中`, matchedRule: null };
      }
    }

    if (filters.excludeKeywords && filters.excludeKeywords.length > 0) {
      for (const keyword of filters.excludeKeywords) {
        const kw = filters.caseSensitive ? keyword : keyword.toLowerCase();
        if (text.includes(kw)) {
          return { matched: false, skippedReason: `匹配排除关键词 "${keyword}"`, matchedRule: `exclude: ${keyword}` };
        }
      }
    }

    const keywords = filters.keywords || [];
    if (keywords.length > 0) {
      for (const keyword of keywords) {
        const kw = filters.caseSensitive ? keyword : keyword.toLowerCase();
        if (text.includes(kw)) {
          return { matched: true, skippedReason: null, matchedRule: `include: ${keyword}` };
        }
      }
    }

    const regexList = filters.regex || [];
    if (regexList.length > 0) {
      for (const patternStr of regexList) {
        try {
          const re = new RegExp(patternStr, filters.caseSensitive ? '' : 'i');
          if (re.test(text)) {
            return { matched: true, skippedReason: null, matchedRule: `regex: ${patternStr}` };
          }
        } catch (e) {
          console.warn(`[Filter] 无效正则: ${patternStr}`);
        }
      }
    }

    if (keywords.length === 0 && regexList.length === 0) {
      return { matched: true, skippedReason: null, matchedRule: '无限制规则（全部放行）' };
    }

    return { matched: false, skippedReason: '无匹配关键词/正则', matchedRule: null };
  }

  _formatMessageForPush(msgRecord) {
    const src = msgRecord.source;
    const content = msgRecord.content;
    const time = new Date(msgRecord.timestamp).toLocaleString('zh-CN');

    const lines = [
      `【${src.type === 'channel' ? '频道' : src.type === 'group' ? '群聊' : src.type === 'bot' ? 'Bot' : '私聊'}】${src.name}`,
      `├ 账户: ${msgRecord.accountName || msgRecord.accountId}`,
      `├ 发送者: ${src.senderName || '未知'}`,
      `├ 时间: ${time}`,
      `├ 类型: ${content.mediaType || '文本'}`
    ];

    if (content.hasForward) lines.push('├ ↩ 转发消息');
    if (content.hasReply) lines.push('├ ↩ 回复消息');

    lines.push('└ 内容:');
    lines.push(content.text || '(无文本内容)');

    if (content.mediaType) {
      lines.push(`\n📎 附件类型: ${content.mediaType}`);
    }

    return lines.join('\n');
  }

  _setState(state) {
    this.state = state;
    this._emitStatus({});
  }

  _buildProxyOptions(proxyConfig) {
    return {
      ip: proxyConfig.host,
      port: parseInt(proxyConfig.port, 10),
      socksType: 5,
      userId: proxyConfig.username || undefined,
      password: proxyConfig.password || undefined
    };
  }

  _detectEntityType(entity) {
    if (entity.className === 'Channel') return entity.broadcast ? 'channel' : 'supergroup';
    if (entity.className === 'Chat') return 'group';
    if (entity.className === 'User') return entity.bot ? 'bot' : 'private';
    return 'unknown';
  }

  _detectPeerType(peerId) {
    if (!peerId) return 'unknown';
    const className = peerId.className || '';
    if (className.includes('Channel')) return 'channel';
    if (className.includes('Chat')) return 'group';
    if (className.includes('User')) return 'private';
    return 'unknown';
  }

  _normalizeChatId(raw) {
    if (!raw) return '';
    let s;
    try { s = String(raw).trim(); } catch (e) { s = String(raw); }
    const stripped = s.replace(/^-100/, '');
    const numStr = stripped.replace(/^-/, '');
    return numStr;
  }

  async _getSourceName(event, listeners) {
    const eventChatId = this._normalizeChatId(event.chatId);
    if (eventChatId) {
      const matched = listeners.find(l => this._normalizeChatId(l.chatId || l.id) === eventChatId);
      if (matched && matched.name) return matched.name;
    }

    try {
      if (event.isPrivate) {
        if (event.message.getSender) {
          const sender = await event.message.getSender();
          if (sender) return sender.firstName || sender.username || sender.id.toString();
        }
        return '私聊';
      }
      if (event.isGroup) return event.chat?.title || '群聊';
      if (event.isChannel) return event.chat?.title || '频道';
    } catch (e) { /* ignore */ }

    return `未知(${eventChatId || '?'})`;
  }

  _getMessageType(message) {
    if (message.photo) return 'photo';
    if (message.document) {
      const mime = (message.document.mimeType || '').toLowerCase();
      if (mime.startsWith('video/') || message.video) return 'video';
      if (mime.startsWith('audio/')) return 'audio';
      if (mime.includes('pdf')) return 'document';
      if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return 'archive';
      return 'document';
    }
    if (message.sticker) return 'sticker';
    if (message.contact) return 'contact';
    if (message.geo || message.geoLive) return 'location';
    if (message.poll) return 'poll';
    if (message.webPage) return 'link_preview';
    return 'text';
  }

  _formatUser(user) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName || '',
      username: user.username || '',
      phone: user.phone || ''
    };
  }
}

module.exports = { TGClient, ConnectionState };