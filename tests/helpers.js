/* Shared helpers for the node --test suites: start a throwaway Flowboard server and talk to it like a browser. */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flowboard-test-'));

async function waitHealthy(base, proc, getOut, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`server exited early (${proc.exitCode}):\n${getOut()}`);
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy:\n' + getOut());
}

// Starts server/server.js on a free port with its own data folder. Options: dataDir, port, env, seed, args, cwd.
async function startServer(opts = {}) {
  const dataDir = opts.dataDir || tempDir();
  const port = opts.port || await freePort();
  const env = Object.assign({}, process.env, {
    PORT: String(port), DATA_DIR: dataDir, QUIET: 'true', SEED: opts.seed === false ? 'false' : 'true',
    AI_API_KEY: '', AI_BASE_URL: '', AI_MODEL: '', HOST: '127.0.0.1'
  }, opts.env || {});
  if (opts.unsetPort) delete env.PORT;
  const root = opts.root || ROOT;
  const proc = spawn(process.execPath, [path.join(root, 'server', 'server.js'), ...(opts.args || [])], { env, cwd: opts.cwd || root, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  if (!opts.noWait) await waitHealthy(base, proc, () => out);
  return {
    base, port, dataDir, proc, output: () => out,
    stop: () => new Promise(resolve => {
      if (proc.exitCode !== null) return resolve();
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } }, 4000).unref();
    })
  };
}

// Minimal cookie-keeping JSON client (acts like the Flowboard front end).
class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.clientId = 'test-' + Math.random().toString(36).slice(2, 10); }
  async req(method, url, body, headers) {
    const h = Object.assign({ 'x-client-id': this.clientId }, headers || {});
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (body !== undefined) { h['content-type'] = h['content-type'] || 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const m = c.match(/^fb_sid=([^;]*)/); if (m) this.cookie = m[1] ? `fb_sid=${m[1]}` : ''; }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  get(u, h) { return this.req('GET', u, undefined, h); }
  post(u, b, h) { return this.req('POST', u, b === undefined ? {} : b, h); }
  put(u, b, h) { return this.req('PUT', u, b === undefined ? {} : b, h); }
  patch(u, b, h) { return this.req('PATCH', u, b === undefined ? {} : b, h); }
  del(u, b, h) { return this.req('DELETE', u, b === undefined ? {} : b, h); }
  async signup(name, email, password = 'correct horse 1') { const r = await this.post('/api/auth/signup', { name, email, password }); if (r.status !== 200) throw new Error('signup failed: ' + r.text); this.user = r.body.user; return r.body.user; }
  async signin(email, password = 'flowboard123') { const r = await this.post('/api/auth/signin', { email, password }); if (r.status !== 200) throw new Error('signin failed: ' + r.text); this.user = r.body.user; return r.body.user; }
}

// Reads Server-Sent Events from a board stream. Returns { events, waitFor(pred), close() }.
async function openEvents(client, boardId, clientId) {
  const ctrl = new AbortController();
  const res = await fetch(`${client.base}/api/boards/${boardId}/events?clientId=${encodeURIComponent(clientId || client.clientId)}`, { headers: { cookie: client.cookie }, signal: ctrl.signal });
  const events = [];
  const waiters = [];
  const check = () => waiters.slice().forEach(w => { const hit = events.find(w.pred); if (hit) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(hit); } });
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let event = 'message', data = '';
          block.split('\n').forEach(line => { if (line.startsWith('event: ')) event = line.slice(7); else if (line.startsWith('data: ')) data += line.slice(6); });
          if (data) { events.push({ event, data: JSON.parse(data) }); check(); }
        }
      }
    } catch (e) { /* aborted */ }
  })();
  return {
    status: res.status, events,
    waitFor: (pred, ms = 4000) => new Promise((resolve, reject) => {
      const hit = events.find(pred);
      if (hit) return resolve(hit);
      const w = { pred, resolve, t: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timed out waiting for event; got ' + JSON.stringify(events.map(e => e.event)))); }, ms) };
      waiters.push(w);
    }),
    close: () => ctrl.abort()
  };
}

module.exports = { ROOT, startServer, Client, openEvents, freePort, tempDir };
