/* Shared Playwright helpers for the Flowboard browser tests. */
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { Client } = require('../helpers');

// Collects console errors/warnings and page errors. Expected network failures can be allowed per page.
function watch(page) {
  const problems = [];
  const allowed = [];
  page.on('console', m => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    if (allowed.some(re => re.test(text))) return;
    problems.push(`${m.type()}: ${text}`);
  });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  return {
    allow: re => allowed.push(re),
    check: () => assert.deepEqual(problems, [], 'no console errors or warnings')
  };
}

async function launch() { return chromium.launch(); }

// A browser context signed in as `email` (password flowboard123 unless given), via the API.
async function signedIn(browser, base, email, opts = {}) {
  const c = new Client(base);
  if (opts.signup) await c.signup(opts.signup, email, opts.password || 'flowboard123'); else await c.signin(email, opts.password);
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opts.context || {}));
  await ctx.addCookies([{ name: 'fb_sid', value: c.cookie.split('=')[1], url: base }]);
  const page = await ctx.newPage();
  const w = watch(page);
  return { ctx, page, client: c, watch: w };
}

const listEl = (page, name) => page.locator('.canvas > .list').filter({ has: page.locator('.list-name', { hasText: new RegExp(`^${name}$`) }) });
const titles = (page, name) => listEl(page, name).locator('.cards > .card .card-title').allTextContents();

async function openBoard(page, base, name) {
  await page.goto(base + '/#/boards');
  await page.locator('.board-tile', { hasText: name }).first().click();
  await page.waitForSelector('.canvas > .list');
  await page.waitForSelector('.live.on', { state: 'attached' });
}

// Mouse drag from the centre of `from` to point {x, y}.
async function mouseDrag(page, from, to) {
  const b = await from.boundingBox();
  const sx = b.x + b.width / 2, sy = b.y + Math.min(b.height / 2, 20);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.waitForTimeout(150);
  await page.mouse.move(to.x, to.y + 1);
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function noHorizontalScroll(page, label) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(sw <= iw, `${label}: page scrollWidth ${sw} > viewport ${iw}`);
}

module.exports = { launch, watch, signedIn, listEl, titles, openBoard, mouseDrag, noHorizontalScroll };
