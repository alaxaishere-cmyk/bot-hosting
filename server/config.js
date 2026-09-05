'use strict';
/**
 * Central config. The resource limits below are LOCKED by host policy:
 * every user gets exactly 308 MiB RAM, 719 MiB disk and 25% CPU.
 * There is intentionally no API/UI to raise them and no second server.
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.BOT_DATA_DIR || path.join(ROOT, 'data');

const LIMITS = Object.freeze({
  ramMiB: 308,
  diskMiB: 719,
  cpuPercent: 25,
});

const SERVER = Object.freeze({
  id: 'node-01',
  name: 'Node 01',
  location: 'Shared Host',
  runtime: 'Node.js',
});

module.exports = {
  ROOT,
  DATA,
  USERS_DIR: path.join(DATA, 'users'),
  LOGS_DIR: path.join(DATA, 'logs'),
  DB_PATH: path.join(DATA, 'panel.db'),
  TEMPLATES_DIR: path.join(__dirname, 'templates'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || '0.0.0.0',
  LIMITS,
  SERVER,
  COOKIE: 'bhp_sid',
  SESSION_TTL_MS: 1000 * 60 * 60 * 24 * 30,
  CONSOLE_COLS: Number(process.env.CONSOLE_COLS || 140),
  CONSOLE_ROWS: Number(process.env.CONSOLE_ROWS || 38),
};
