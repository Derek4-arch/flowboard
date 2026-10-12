/* AI Standup Mode against a mock OpenAI-compatible server: success, privacy of what is sent, and fallbacks. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, Client, freePort } = require('./helpers');

function mockAI(behaviour) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      behaviour(req, res);
    });
  });
  return { calls, server };
}
async function demoBoard(base) {
  const c = new Client(base);
  await c.signin('maya@example.com');
  const b = (await c.get('/api/boards')).body.boards.find(x => x.name === 'Website relaunch');
  return { c, id: b.id };
}

test('uses the configured OpenAI-compatible model and only sends board facts', async () => {
  const ai = mockAI((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '## Summary\nGood momentum, **team**. <script>alert(1)</script>\n\n## Done\n- Choose analytics provider' } }] }));
  });
  const port = await freePort();
  await new Promise(r => ai.server.listen(port, '127.0.0.1', r));
  const srv = await startServer({ env: { AI_API_KEY: 'test-key-123', AI_BASE_URL: `http://127.0.0.1:${port}/v1/`, AI_MODEL: 'mock-model-1' } });
  try {
    const { c, id } = await demoBoard(srv.base);
    const cfg = (await c.get('/api/config')).body;
    assert.deepEqual(cfg.ai, { enabled: true, model: 'mock-model-1' });
    const rep = (await c.get(`/api/boards/${id}/standup`)).body.report;
    assert.equal(rep.mode, 'ai');
    assert.equal(rep.ai.model, 'mock-model-1');
    assert.match(rep.html, /<strong>team<\/strong>/);
    assert.ok(!rep.html.includes('<script>'), 'AI output is rendered through the safe Markdown renderer');
    assert.match(rep.markdown, /Good momentum/);
    assert.match(rep.slack, /\*Summary\*/);
    assert.match(rep.markdown, /## By person/, 'focus scores are always appended');

    assert.equal(ai.calls.length, 1);
    const call = ai.calls[0];
    assert.equal(call.url, '/v1/chat/completions');
    assert.equal(call.auth, 'Bearer test-key-123');
    assert.equal(call.body.model, 'mock-model-1');
    const sent = JSON.stringify(call.body);
    assert.match(sent, /Contact form spam protection/);
    assert.ok(!sent.includes('maya@example.com'), 'no emails are sent');
    assert.ok(!sent.includes('Announce the new site'), 'card descriptions are not sent');
  } finally {
    await srv.stop();
    ai.server.close();
  }
});

test('falls back to the rule-based summary when the AI fails or times out', async () => {
  let mode = 'error';
  const ai = mockAI((req, res) => {
    if (mode === 'error') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"message":"boom"}}'); }
    else setTimeout(() => { try { res.writeHead(200); res.end('{}'); } catch (e) { /* client gone */ } }, 3000);
  });
  const port = await freePort();
  await new Promise(r => ai.server.listen(port, '127.0.0.1', r));
  const srv = await startServer({ env: { AI_API_KEY: 'k', AI_BASE_URL: `http://127.0.0.1:${port}/v1`, AI_TIMEOUT_MS: '500' } });
  try {
    const { c, id } = await demoBoard(srv.base);
    let rep = (await c.get(`/api/boards/${id}/standup`)).body.report;
    assert.equal(rep.mode, 'rules');
    assert.ok(rep.ai.configured);
    assert.match(rep.ai.error, /500|boom/);
    assert.match(rep.markdown, /## Blocked/);
    mode = 'slow';
    const t = Date.now();
    rep = (await c.get(`/api/boards/${id}/standup`)).body.report;
    assert.equal(rep.mode, 'rules');
    assert.ok(rep.ai.error);
    assert.ok(Date.now() - t < 2800, 'the timeout is honoured');
  } finally {
    await srv.stop();
    ai.server.closeAllConnections();
    ai.server.close();
  }
});
