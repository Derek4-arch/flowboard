/* Flowboard: small HTTP toolkit on top of node:http: router, JSON/form bodies, cookies, static files,
   security headers and a rate limiter. No external packages. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

function send(res, status, body, headers) {
  if (res.headersSent) return;
  const h = Object.assign({}, SECURITY_HEADERS, headers || {});
  if (typeof body === 'object' && !Buffer.isBuffer(body)) { body = JSON.stringify(body); h['Content-Type'] = h['Content-Type'] || 'application/json; charset=utf-8'; h['Cache-Control'] = h['Cache-Control'] || 'no-store'; }
  res.writeHead(status, h);
  res.end(body);
}
const json = (res, status, obj, headers) => send(res, status, obj, headers);
function html(res, status, markup, headers) {
  send(res, status, markup, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP.replace("style-src 'self'", "style-src 'self'") }, headers || {}));
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* ignore bad cookie */ } }
  });
  return out;
}
function cookie(name, value, opts) {
  opts = opts || {};
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path || '/'}`, 'HttpOnly', `SameSite=${opts.sameSite || 'Lax'}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > (limit || 262144)) { const e = new Error('Request body too large'); e.status = 413; reject(e); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function parseBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) {
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch (e) { const err = new Error('Malformed JSON'); err.status = 400; throw err; }
  }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return {};
}

function createRouter() {
  const routes = [];
  const add = (method, pattern, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^\\/]+)'; }) + '\\/?$');
    routes.push({ method, re, keys, opts, handler });
  };
  return {
    get: (p, o, h) => add('GET', p, o, h),
    post: (p, o, h) => add('POST', p, o, h),
    put: (p, o, h) => add('PUT', p, o, h),
    patch: (p, o, h) => add('PATCH', p, o, h),
    del: (p, o, h) => add('DELETE', p, o, h),
    match(method, pathname) {
      let allowed = false;
      for (const r of routes) {
        const m = pathname.match(r.re);
        if (!m) continue;
        if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) { allowed = true; continue; }
        const params = {};
        r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch (e) { params[k] = m[i + 1]; } });
        return { route: r, params };
      }
      return allowed ? { notAllowed: true } : null;
    }
  };
}

// Static files from public/ with path traversal protection.
function serveStatic(root, req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return false; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = Object.assign({}, SECURITY_HEADERS, {
    'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag
  });
  if (ext === '.html') headers['Content-Security-Policy'] = CSP;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

// Fixed-window limiter: at most `max` hits per `windowMs` per key.
function rateLimiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (t - v.start > windowMs) hits.delete(k); }, windowMs).unref();
  return {
    hit(key) {
      const t = Date.now();
      let v = hits.get(key);
      if (!v || t - v.start > windowMs) { v = { start: t, n: 0 }; hits.set(key, v); }
      v.n++;
      return v.n <= max;
    },
    reset(key) { hits.delete(key); }
  };
}

const clientIp = req => (req.socket && req.socket.remoteAddress) || 'unknown';
const sameOrigin = req => {
  const o = req.headers.origin;
  if (!o) return true;
  const hosts = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
  return hosts.some(h => o === `http://${h}` || o === `https://${h}`);
};
// True when the request arrived over HTTPS (directly or via a proxy such as Render).
const isHttps = req => !!(req.socket && req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

module.exports = { send, json, html, parseCookies, cookie, parseBody, createRouter, serveStatic, rateLimiter, clientIp, sameOrigin, isHttps, CSP, SECURITY_HEADERS };
