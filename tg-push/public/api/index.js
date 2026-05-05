/**
 * public/api/index.js — API 客户端
 */

const API_BASE = '/api';

async function api(url, options = {}) {
  const { method = 'GET', body = null, headers = {} } = options;

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${url}`, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `请求失败: ${response.status}`);
  }

  return data;
}

window.api = api;