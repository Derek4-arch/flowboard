#!/usr/bin/env node
/* Flowboard: local web server.
   Usage:  node server/server.js [--open] [--port 3000]
   Zero npm dependencies. Requires Node.js 22.5+ (Node 24 LTS recommended). */
'use strict';

// ——— 1. Node version check ———
const [MAJOR, MINOR] = process.versions.node.split('.').map(Number);
if (MAJOR < 22 || (MAJOR === 22 && MINOR < 5)) {
  console.error(`\n  Flowboard needs Node.js 22.5 or newer (you have ${process.version}).\n  Install the current LTS from https://nodejs.org and run start.bat again.\n`);
  process.exit(1);
}

// ——— 2. Hide Node's "SQLite is an experimental feature" warning (printed by Node 22.x) ———
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  const type = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].type) || (warning && warning.name) || '';
  if (/sqlite/i.test(msg) && /experimental/i.test(type + ' ' + msg)) return;
  return emitWarning.call(process, warning, ...args);
};

// ——— 3. node:sqlite needs --experimental-sqlite on Node 22.5–22.12: re-launch with the flag ———
try {
  require('node:sqlite');
} catch (e) {
  if ((e.code === 'ERR_UNKNOWN_BUILTIN_MODULE' || /node:sqlite/.test(e.message)) && !process.execArgv.includes('--experimental-sqlite')) {
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
    ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => child.kill(sig)));
    child.on('exit', (code, signal) => process.exit(code == null ? (signal ? 1 : 0) : code));
    return;
  }
  console.error(`\n  This Node.js build (${process.version}) has no built-in SQLite. Install Node.js 24 LTS from https://nodejs.org.\n`);
  process.exit(1);
}

main();

function main() {
  const path = require('node:path');
  const nodeHttp = require('node:http');
  const config = require('./config');
  const http = require('./http');
  const { open } = require('./db');
  const { createEngine, UserError } = require('./engine');
  const { createStandup } = require('./standup');
  const { createAI } = require('./ai');
  const { createRealtime } = require('./realtime');
  const { seed } = require('./seed');

  const args = process.argv.slice(2);
  const portArg = args.indexOf('--port');
  if (portArg >= 0 && args[portArg + 1]) { config.port = parseInt(args[portArg + 1], 10); config.portExplicit = true; }
  const shouldOpen = args.includes('--open');

  const stamp = () => new Date().toTimeString().slice(0, 8);
  const log = {
    info: (...a) => { if (!config.quiet) console.log(`[${stamp()}]`, ...a); },
    warn: (...a) => console.warn(`[${stamp()}] warning:`, ...a),
    error: (...a) => console.error(`[${stamp()}] error:`, ...a)
  };

  const dbFile = path.join(config.dataDir, 'flowboard.db');
  const db = open(dbFile);
  const realtime = createRealtime({ log });
  const ai = createAI(config);
  const standup = createStandup({ db, config, ai, log });
  const engine = createEngine({ db, config, realtime, standup });
  if (config.seed) seed(db, log);

  const router = http.createRouter();
  const deps = { db, engine, realtime, config, http, log };
  for (const name of ['meta', 'auth', 'boards', 'lists', 'cards']) require('./routes/' + name)(router, deps);

  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return http.json(res, 400, { ok: false, error: 'Bad request.' }); }
    const pathname = url.pathname;
    const isApi = pathname.startsWith('/api/');
    const m = router.match(req.method, pathname);
    if (!m) {
      if ((req.method === 'GET' || req.method === 'HEAD') && !isApi && http.serveStatic(config.publicDir, req, res, pathname)) return;
      return isApi ? http.json(res, 404, { ok: false, error: 'Not found.' })
        : http.html(res, 404, '<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px system-ui;padding:40px"><h1>Page not found</h1><p><a href="/">Open Flowboard</a></p>');
    }
    if (m.notAllowed) return http.json(res, 405, { ok: false, error: 'Method not allowed.' });
    const cookiesIn = http.parseCookies(req);
    const ctx = { req, res, params: m.params, query: Object.fromEntries(url.searchParams), cookiesIn, cookies: [], ip: http.clientIp(req), body: {} };
    try {
      if (MUTATING.has(req.method)) {
        // CSRF protection: same-origin JSON only (cross-site HTML forms cannot send application/json).
        if (!http.sameOrigin(req)) return http.json(res, 403, { ok: false, error: 'Cross-origin request blocked.' });
        if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) return http.json(res, 415, { ok: false, error: 'Send requests as application/json.' });
        ctx.body = await http.parseBody(req);
      }
      ctx.token = cookiesIn.fb_sid || '';
      ctx.user = ctx.token ? engine.userForToken(ctx.token) : null;
      if (m.route.opts.auth && !ctx.user) {
        return http.json(res, 401, { ok: false, code: 'auth', error: 'Your session has ended. Please sign in again.' }, ctx.token ? { 'Set-Cookie': http.cookie('fb_sid', '', { maxAge: 0 }) } : null);
      }
      const out = await m.route.handler(ctx);
      if (res.headersSent || res.writableEnded) return;
      http.json(res, 200, Object.assign({ ok: true }, out || {}), ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : null);
    } catch (e) {
      if (e instanceof UserError || (e && e.status && e.status < 500)) {
        return http.json(res, e.status || 400, { ok: false, error: e.message, field: e.field || undefined, code: e.code || undefined });
      }
      log.error(`${req.method} ${pathname} failed:`, e);
      http.json(res, 500, { ok: false, error: 'Something went wrong on the server. Please try again.' });
    }
  }

  const timers = [setInterval(() => engine.purgeSessions(), 3600e3)];
  engine.purgeSessions();

  const server = nodeHttp.createServer((req, res) => { handle(req, res).catch(e => { log.error(e); try { http.json(res, 500, { ok: false, error: 'Server error.' }); } catch (e2) { /* ignore */ } }); });
  server.keepAliveTimeout = 5000;
  server.requestTimeout = 0; // SSE streams stay open

  // Listen on the configured port; if it's taken and PORT wasn't set explicitly, try the next 20 ports.
  let port = config.port;
  const lastPort = config.portExplicit ? port : port + 20;
  server.on('error', e => {
    if (e.code === 'EADDRINUSE' && port < lastPort) { port++; setImmediate(() => server.listen(port, config.host)); return; }
    if (e.code === 'EADDRINUSE') console.error(`\n  Port ${port} is already in use. Flowboard may already be running: open http://localhost:${port}\n  Or choose another port: set PORT=3001 in .env (or run: node server/server.js --port 3001)\n`);
    else console.error('\n  Could not start the server:', e.message, '\n');
    process.exit(1);
  });
  server.on('listening', () => {
    const url = `http://localhost:${port}`;
    if (!config.quiet) {
      console.log(`\n  Flowboard is running (Node ${process.version}, SQLite ${process.versions.sqlite || ''})`);
      console.log(`  Open:      ${url}${port !== config.port ? `   (port ${config.port} was busy)` : ''}`);
      console.log(`  Database:  ${dbFile}`);
      console.log(`  Standup:   ${config.ai.key ? `AI write-ups via ${config.ai.baseUrl} (${config.ai.model})` : 'rule-based summaries (set AI_API_KEY in .env for AI write-ups)'}`);
      if (config.seed) console.log('  Demo login: maya@example.com / flowboard123  (also sam@ and priya@example.com)');
      console.log('\n  Press Ctrl+C to stop.\n');
    }
    if (shouldOpen) openBrowser(url);
  });
  server.listen(port, config.host);

  function openBrowser(url) {
    const { spawn } = require('node:child_process');
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).on('error', () => {}).unref(); } catch (e) { /* no browser */ }
  }

  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    log.info('Shutting down…');
    timers.forEach(clearInterval);
    realtime.closeAll();
    server.close(() => { db.close(); process.exit(0); });
    if (server.closeAllConnections) server.closeAllConnections();
    setTimeout(() => { db.close(); process.exit(0); }, 2000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
