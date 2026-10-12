/* Flowboard server configuration.
   Precedence: environment variables > .env file in the project root > defaults below.
   See .env.example for every option. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadDotEnv(file) {
  const out = {};
  try {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
      if (/^\s*#/.test(line)) return;
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    });
  } catch (e) { /* no .env file: defaults apply */ }
  return out;
}
const env = Object.assign({}, loadDotEnv(path.join(ROOT, '.env')), process.env);
const bool = (v, dflt) => (v == null || v === '' ? dflt : /^(1|true|yes|on)$/i.test(String(v)));

module.exports = {
  ROOT,
  publicDir: path.join(ROOT, 'public'),
  // Port for http://localhost:PORT. If PORT is not set and 3000 is busy, the next free port is used.
  port: parseInt(env.PORT || '3000', 10),
  portExplicit: !!env.PORT,
  // 127.0.0.1 keeps Flowboard private to this computer. Use 0.0.0.0 on a server (render.yaml does).
  host: env.HOST || ((env.RENDER || env.PORT) ? '0.0.0.0' : '127.0.0.1'),
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  sessionDays: parseInt(env.SESSION_DAYS || '30', 10),
  // Create the demo users and demo board on first run (empty database only).
  seed: bool(env.SEED, true),
  // Optional AI write-ups for Standup Mode: any OpenAI-compatible /chat/completions endpoint.
  ai: {
    key: env.AI_API_KEY || '',
    baseUrl: (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: env.AI_MODEL || 'gpt-4o-mini',
    timeoutMs: parseInt(env.AI_TIMEOUT_MS || '25000', 10)
  },
  // Secure cookies: "auto" marks cookies Secure when the request arrived over HTTPS (e.g. behind Render).
  cookieSecure: (env.COOKIE_SECURE || 'auto').toLowerCase(),
  quiet: bool(env.QUIET, false)
};
