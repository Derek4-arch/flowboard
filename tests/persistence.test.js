/* Persistence across restarts, first-run seeding, SEED=false, port fallback and starting from a fresh copy. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { startServer, Client, tempDir, ROOT } = require('./helpers');

test('data and sessions survive a server restart; demo data is seeded once', async () => {
  const dataDir = tempDir();
  let srv = await startServer({ dataDir });
  const c = new Client(srv.base);
  await c.signin('maya@example.com');
  const boards = (await c.get('/api/boards')).body.boards;
  assert.deepEqual(boards.map(b => b.name).sort(), ['Q4 planning', 'Website relaunch']);
  const board = (await c.get(`/api/boards/${boards.find(b => b.name === 'Q4 planning').id}`)).body;
  const card = (await c.post(`/api/lists/${board.lists[0].id}/cards`, { title: 'Survives restarts' })).body.card;
  await c.post(`/api/cards/${card.id}/move`, { listId: board.lists[1].id, index: 0 });
  await srv.stop();
  assert.ok(fs.existsSync(path.join(dataDir, 'flowboard.db')));

  srv = await startServer({ dataDir, port: srv.port });
  try {
    assert.equal((await c.get('/api/me')).body.user.email, 'maya@example.com', 'session cookie still valid');
    const again = (await c.get(`/api/boards/${board.board.id}`)).body;
    const saved = again.cards.find(x => x.id === card.id);
    assert.equal(saved.title, 'Survives restarts');
    assert.equal(saved.listId, board.lists[1].id);
    assert.equal(saved.position, 0);
    assert.equal((await c.get('/api/boards')).body.boards.length, 2, 'seed does not run twice');
  } finally { await srv.stop(); }
});

test('SEED=false starts with an empty database', async () => {
  const srv = await startServer({ seed: false });
  try {
    const c = new Client(srv.base);
    assert.equal((await c.get('/api/config')).body.demo, false);
    assert.equal((await c.post('/api/auth/signin', { email: 'maya@example.com', password: 'flowboard123' })).status, 401);
  } finally { await srv.stop(); }
});

test('uses the next free port when 3000 is busy and PORT is not set', async () => {
  const blocker = net.createServer();
  const blocked = await new Promise(resolve => {
    blocker.once('error', () => resolve(false)); // already busy (e.g. Flowboard running): that's fine too
    blocker.listen(3000, '127.0.0.1', () => resolve(true));
  });
  const srv = await startServer({ unsetPort: true, noWait: true, env: { QUIET: 'false' } });
  try {
    const until = Date.now() + 15000;
    let m = null;
    while (!m && Date.now() < until) { m = srv.output().match(/Open:\s+http:\/\/localhost:(\d+)/); if (!m) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(m, srv.output());
    const port = Number(m[1]);
    assert.ok(port > 3000 && port <= 3020, `listening on ${port}`);
    assert.match(srv.output(), /port 3000 was busy/);
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(r.status, 200);
  } finally {
    await srv.stop();
    if (blocked) blocker.close();
  }
});

test('a fresh copy of the project starts and creates its own data folder', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'flowboard-copy-'));
  const skip = new Set(['data', '.git', 'node_modules', 'test-results']);
  fs.cpSync(ROOT, copy, { recursive: true, filter: src => !skip.has(path.basename(src)) || path.dirname(src) !== ROOT });
  assert.ok(!fs.existsSync(path.join(copy, 'data')));
  const env = { DATA_DIR: '' };
  const srv = await startServer({ root: copy, cwd: os.tmpdir(), env, dataDir: undefined });
  try {
    // DATA_DIR='' falls back to <project>/data even when started from another working directory.
    const c = new Client(srv.base);
    await c.signin('priya@example.com');
    assert.equal((await c.get('/api/boards')).body.boards.length, 1);
    assert.ok(fs.existsSync(path.join(copy, 'data', 'flowboard.db')));
    const html = await (await fetch(srv.base + '/')).text();
    assert.match(html, /js\/app\.js/);
  } finally {
    await srv.stop();
    fs.rmSync(copy, { recursive: true, force: true });
  }
});
