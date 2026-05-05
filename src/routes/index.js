/**
 * src/routes/index.js — 路由统一注册
 */

const express = require('express');
const accountsRouter = require('./accounts');
const connectionRouter = require('./connection');
const listenersRouter = require('./listeners');
const filtersRouter = require('./filters');
const forwardServersRouter = require('./forward-servers');
const forwardRouter = require('./forward');
const webhooksRouter = require('./webhooks');
const statusRouter = require('./status');
const logsRouter = require('./logs');
const initRouter = require('./init');
const sseRouter = require('./sse');

function registerRoutes(app) {
  const router = express.Router();

  app.use('/api/accounts', accountsRouter);
  app.use('/api', connectionRouter);
  app.use('/api/listeners', listenersRouter);
  app.use('/api/filters', filtersRouter);
  app.use('/api/forward-servers', forwardServersRouter);
  app.use('/api/forward', forwardRouter);
  app.use('/api/webhook', webhooksRouter);
  app.use('/api', statusRouter);
  app.use('/api/logs', logsRouter);
  app.use('/api/messages', logsRouter);
  app.use('/api/operation-logs', logsRouter);
  app.use('/api/init', initRouter);
  app.use('/api', sseRouter);

  app.use('/api/accounts/:aid/connect', async (req, res, next) => {
    req.body.accountId = req.params.aid;
    req.url = '/api/connect';
    connectionRouter(req, res, next);
  });

  app.use('/api/accounts/:aid/disconnect', async (req, res, next) => {
    req.body.accountId = req.params.aid;
    connectionRouter(req, res, next);
  });

  app.use('/api/accounts/:aid/dialogs', async (req, res, next) => {
    req.query.account = req.params.aid;
    connectionRouter(req, res, next);
  });

  app.use('/api/accounts/:aid/listeners', listenersRouter);
  app.use('/api/accounts/:aid/auth/send-code', async (req, res, next) => {
    req.body.accountId = req.params.aid;
    connectionRouter(req, res, next);
  });
  app.use('/api/accounts/:aid/auth/verify', async (req, res, next) => {
    req.body.accountId = req.params.aid;
    connectionRouter(req, res, next);
  });
  app.use('/api/accounts/:aid/auth/password', async (req, res, next) => {
    req.body.accountId = req.params.aid;
    connectionRouter(req, res, next);
  });
}

module.exports = { registerRoutes };