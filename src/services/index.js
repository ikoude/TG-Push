/**
 * src/services/index.js — 核心服务导出
 */

const { TGClient, ConnectionState } = require('./telegram-client');
const Forwarder = require('./forwarder');
const initManager = require('./init-manager');

module.exports = {
  TGClient,
  ConnectionState,
  Forwarder,
  initManager
};