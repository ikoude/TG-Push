/**
 * src/services/forwarder.js — 统一转发引擎 v2
 */

const http = require('http');
const https = require('https');

class Forwarder {
  constructor(serverConfig = {}) {
    this.id = serverConfig.id || '';
    this.name = serverConfig.name || '未命名';
    this.type = serverConfig.type || 'magicpush';
    this.url = (serverConfig.url || '').replace(/\/+$/, '');
    this.token = serverConfig.token || '';
    this.method = serverConfig.method || 'POST';
    this.headers = serverConfig.headers || {};
    this.bodyTemplate = serverConfig.bodyTemplate || '';

    this.rateLimit = serverConfig.rateLimit || 2;
    this.retryMax = serverConfig.retryMax || 3;
    this.retryDelays = serverConfig.retryDelays || [5000, 15000, 60000];
    this.enabled = serverConfig.enabled !== false;

    this._queue = [];
    this._processing = false;
    this._lastSendTime = 0;

    this.stats = {
      totalReceived: 0,
      totalForwarded: 0,
      totalSkipped: 0,
      totalFailed: 0
    };
  }

  updateConfig(serverConfig) {
    if (serverConfig.id) this.id = serverConfig.id;
    if (serverConfig.name) this.name = serverConfig.name;
    if (serverConfig.type) this.type = serverConfig.type;
    if (serverConfig.url !== undefined) this.url = (serverConfig.url || '').replace(/\/+$/, '');
    if (serverConfig.token !== undefined) this.token = serverConfig.token;
    if (serverConfig.method) this.method = serverConfig.method;
    if (serverConfig.headers) this.headers = serverConfig.headers;
    if (serverConfig.bodyTemplate !== undefined) this.bodyTemplate = serverConfig.bodyTemplate;
    if (serverConfig.rateLimit) this.rateLimit = serverConfig.rateLimit;
    if (serverConfig.retryMax) this.retryMax = serverConfig.retryMax;
    if (serverConfig.retryDelays) this.retryDelays = serverConfig.retryDelays;
    if (serverConfig.enabled !== undefined) this.enabled = serverConfig.enabled;
  }

  async send(title, content) {
    if (!this.enabled) {
      return { success: false, error: `转发服务器「${this.name}」已禁用`, retryable: false };
    }

    if (!this._validateConfig()) {
      return { success: false, error: `转发服务器「${this.name}」缺少必要配置`, retryable: false };
    }

    this.stats.totalReceived++;

    for (let attempt = 0; attempt < this.retryMax; attempt++) {
      try {
        await this._rateLimitWait();
        let result;

        switch (this.type) {
          case 'magicpush':
            result = await this._sendMagicPush(title, content);
            break;
          case 'webhook':
            result = await this._sendWebhook(title, content);
            break;
          case 'custom':
            result = await this._sendCustom(title, content);
            break;
          default:
            result = { success: false, error: `未知转发类型: ${this.type}`, retryable: false };
        }

        if (result.success) {
          this.stats.totalForwarded++;
          return result;
        }

        if (!result.retryable) {
          this.stats.totalFailed++;
          return result;
        }
      } catch (err) {
        console.error(`[Forwarder:${this.name}] 发送失败 (尝试 ${attempt + 1}/${this.retryMax}):`, err.message);
      }

      if (attempt < this.retryMax - 1) {
        const delay = this.retryDelays[attempt] || this.retryDelays[this.retryDelays.length - 1];
        await this._sleep(delay);
      }
    }

    this.stats.totalFailed++;
    return { success: false, error: `重试 ${this.retryMax} 次后仍然失败` };
  }

  async test() {
    const testTitle = 'TG·Push 测试';
    const testContent = `测试时间: ${new Date().toLocaleString('zh-CN')}\n如果你收到这条消息，说明「${this.name}」配置正确！`;
    return this.send(testTitle, testContent);
  }

  getStats() {
    return { ...this.stats };
  }

  resetStats() {
    this.stats = { totalReceived: 0, totalForwarded: 0, totalSkipped: 0, totalFailed: 0 };
  }

  _validateConfig() {
    switch (this.type) {
      case 'magicpush':
        return !!(this.token && this.url);
      case 'webhook':
        return !!this.url;
      case 'custom':
        return !!(this.url && this.method);
      default:
        return false;
    }
  }

  _sendMagicPush(title, content) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        title: title.slice(0, 120),
        content: content.slice(0, 4000),
        type: 'text'
      });

      const urlObj = new URL(`${this.url}/api/push/${this.token}`);
      this._httpRequest(urlObj, postData, resolve, reject);
    });
  }

  _sendWebhook(title, content) {
    return new Promise((resolve, reject) => {
      const body = this.bodyTemplate
        ? this._renderTemplate(this.bodyTemplate, { title, content })
        : JSON.stringify({
            title: title.slice(0, 120),
            text: content.slice(0, 4000),
            timestamp: new Date().toISOString()
          });

      const urlObj = new URL(this.url);

      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'TG-Push/2.0',
        ...this.headers
      };

      this._httpRequest(urlObj, body, resolve, reject, { method: this.method, headers });
    });
  }

  _sendCustom(title, content) {
    return new Promise((resolve, reject) => {
      const body = this.bodyTemplate
        ? this._renderTemplate(this.bodyTemplate, { title, content })
        : JSON.stringify({ title, content });

      const urlObj = new URL(this.url);
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'TG-Push/2.0',
        ...this.headers,
        ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
      };

      this._httpRequest(urlObj, body, resolve, reject, { method: this.method, headers });
    });
  }

  _httpRequest(urlObj, postData, resolve, reject, extraOpts = {}) {
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: extraOpts.method || 'POST',
      headers: extraOpts.headers || {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true });
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({ success: false, error: `认证失败 (${res.statusCode})`, retryable: false });
        } else if (res.statusCode === 429) {
          resolve({ success: false, error: `频率限制 (429 Too Many Requests)`, retryable: true });
        } else {
          resolve({ success: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}`, retryable: true });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  }

  _renderTemplate(template, vars) {
    return template
      .replace(/\{\{title\}\}/g, vars.title?.slice(0, 120) || '')
      .replace(/\{\{content\}\}/g, vars.content?.slice(0, 4000) || '')
      .replace(/\{\{timestamp\}\}/g, new Date().toISOString())
      .replace(/\{\{date\}\}/g, new Date().toLocaleDateString('zh-CN'));
  }

  async _rateLimitWait() {
    const now = Date.now();
    const elapsed = now - this._lastSendTime;
    const minInterval = 1000 / this.rateLimit;

    if (elapsed < minInterval) {
      await this._sleep(minInterval - elapsed);
    }
    this._lastSendTime = Date.now();
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Forwarder;