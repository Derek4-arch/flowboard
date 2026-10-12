/* Browser tests for persistence across a server restart and starting from a fresh copy of the project. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, tempDir, ROOT } = require('../helpers');
const { launch, watch, listEl, titles } = require('./lib');

let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); });
const T = { timeout: 90000 };

test('cards and sessions persist across a server restart; the page reconnects by itself', T, async () => {
  const dataDir = tempDir();
  let srv = await startServer({ dataDir });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const w = watch(page);
  // While the server is down the browser logs failed requests; those are expected here.
  w.allow(/ERR_CONNECTION_REFUSED|Failed to load resource|net::ERR/);
  await page.goto(srv.base);
  await page.click('[data-action="use-demo"]');
  await page.click('button:has-text("Sign in")');
  await page.locator('.board-tile', { hasText: 'Website relaunch' }).first().click();
  await page.waitForSelector('.live.on', { state: 'attached' });
  await listEl(page, 'Backlog').locator('[data-action="add-card"]').click();
  await page.fill('.composer textarea', 'Persist me');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.card-title:text-is("Persist me")');
  await page.keyboard.press('Escape');

  await srv.stop();
  await page.waitForSelector('.live.off', { state: 'attached', timeout: 10000 });
  srv = await startServer({ dataDir, port: srv.port });
  await page.waitForSelector('.live.on', { state: 'attached', timeout: 15000 });
  await page.reload();
  await page.waitForSelector('.canvas > .list');
  assert.ok((await titles(page, 'Backlog')).includes('Persist me'));
  assert.ok(await page.locator('[data-account-btn]').count(), 'still signed in');
  w.check();
  await ctx.close();
  await srv.stop();
});

test('a fresh copy (no data folder) starts and shows the demo board', T, async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'flowboard-fresh-'));
  const skip = new Set(['data', '.git', 'node_modules', 'test-results']);
  fs.cpSync(ROOT, copy, { recursive: true, filter: src => !(skip.has(path.basename(src)) && path.dirname(src) === ROOT) });
  const srv = await startServer({ root: copy, cwd: copy, env: { DATA_DIR: '' } });
  try {
    assert.ok(fs.existsSync(path.join(copy, 'data', 'flowboard.db')));
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(srv.base);
    await page.click('[data-action="use-demo"]');
    await page.click('button:has-text("Sign in")');
    await page.locator('.board-tile', { hasText: 'Website relaunch' }).first().click();
    await page.waitForSelector('.canvas > .list');
    assert.equal(await page.locator('.canvas > .list').count(), 5);
    assert.equal(await page.locator('.canvas .card').count(), 16);
    w.check();
    await ctx.close();
  } finally {
    await srv.stop();
    fs.rmSync(copy, { recursive: true, force: true });
  }
});
