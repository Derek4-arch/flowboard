/* Health check and public client configuration. */
'use strict';
module.exports = function (r, { config, realtime, db }) {
  r.get('/api/health', () => ({ status: 'up', node: process.version, sqlite: process.versions.sqlite || null, liveConnections: realtime.count(), schema: (db.get("SELECT value FROM meta WHERE key = 'schema_version'") || {}).value }));
  r.get('/api/config', () => ({
    ai: { enabled: !!config.ai.key, model: config.ai.key ? config.ai.model : null },
    demo: !!config.seed && !!db.get("SELECT 1 FROM users WHERE email = 'maya@example.com'")
  }));
};
