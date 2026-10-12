/* Flowboard browser tests (Playwright + node --test). Run with: npm run test:e2e */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer, Client } = require('../helpers');
const { launch, watch, signedIn, listEl, titles, openBoard, mouseDrag, noHorizontalScroll } = require('./lib');

let srv, browser;
test.before(async () => { srv = await startServer({ seed: true }); browser = await launch(); });
test.after(async () => { if (browser) await browser.close(); if (srv) await srv.stop(); });
const T = { timeout: 90000 };

test('sign up with inline validation, sign out, sign in', T, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const w = watch(page);
  w.allow(/status of 401/); // the deliberate wrong-password attempt below
  await page.goto(srv.base);
  await page.waitForSelector('[data-form="signin"]');
  assert.match(page.url(), /#\/signin$/);
  await page.click('text=Create an account');
  await page.waitForSelector('[data-form="signup"]');
  await page.click('button:has-text("Create account")');
  assert.equal(await page.locator('.field.invalid').count(), 3);
  assert.equal(await page.locator('[data-field="name"] .field-error').textContent(), 'Enter your name.');
  await page.fill('[name=name]', 'Test Person');
  await page.fill('[name=email]', 'not-an-email');
  await page.fill('[name=password]', 'short');
  await page.click('button:has-text("Create account")');
  assert.match(await page.locator('[data-field="email"] .field-error').textContent(), /valid email/);
  assert.equal(await page.locator('[data-field="password"] .field-error').textContent(), 'Use at least 8 characters.');
  await page.fill('[name=email]', 'test.person@example.com');
  await page.fill('[name=password]', 'a-good-password');
  await page.click('button:has-text("Create account")');
  await page.waitForSelector('text=No boards yet');
  assert.match(page.url(), /#\/boards$/);

  await page.click('[data-account-btn]');
  await page.click('[data-m="signout"]');
  await page.waitForSelector('[data-form="signin"]');
  await page.click('button:has-text("Sign in")');
  assert.equal(await page.locator('.field.invalid').count(), 2);
  await page.fill('[name=email]', 'test.person@example.com');
  await page.fill('[name=password]', 'wrong-password');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('.form-error:has-text("incorrect")');
  await page.fill('[name=password]', 'a-good-password');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('h1:has-text("Your boards")');
  w.check();
  await ctx.close();
});

test('board create, rename, star, colour and delete', T, async () => {
  const { ctx, page, watch: w } = await signedIn(browser, srv.base, 'crud@example.com', { signup: 'Crud Owner' });
  await page.goto(srv.base + '/#/boards');
  await page.click('.home-head [data-action="new-board"]');
  await page.click('.modal button:has-text("Create board")');
  assert.equal(await page.locator('.modal [data-field="name"] .field-error').textContent(), 'Enter a board name.');
  await page.fill('.modal [name=name]', 'Product launch');
  await page.click('.modal [data-swatch="teal"]');
  await page.click('.modal button:has-text("Create board")');
  await page.waitForSelector('.canvas > .list');
  assert.equal(await page.locator('.board-page').getAttribute('data-color'), 'teal');
  assert.deepEqual(await page.locator('.list-name').allTextContents(), ['To do', 'In progress', 'Done']);

  await page.click('.board-name');
  await page.fill('.board-name-input', 'Launch plan');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.board-name:has-text("Launch plan")');
  await page.click('[data-action="star"]');
  await page.waitForSelector('[data-action="star"][aria-pressed="true"]');
  await page.click('[data-action="board-menu"]');
  await page.click('.popover [data-swatch="violet"]');
  await page.waitForFunction(() => document.querySelector('.board-page').dataset.color === 'violet');
  await page.keyboard.press('Escape');

  await page.goto(srv.base + '/#/boards');
  await page.waitForSelector('.section-title:has-text("Starred")');
  assert.equal(await page.locator('.board-tile[data-color="violet"]', { hasText: 'Launch plan' }).count(), 2, 'shown under Starred and All boards');
  await page.reload();
  await page.waitForSelector('.section-title:has-text("Starred")');

  await page.locator('.board-tile', { hasText: 'Launch plan' }).first().click();
  await page.waitForSelector('.canvas > .list');
  await page.click('[data-action="board-menu"]');
  await page.click('[data-m="delete"]');
  await page.click('.modal-foot button:has-text("Delete board")');
  await page.waitForSelector('text=No boards yet');
  w.check();
  await ctx.close();
});

test('lists and cards: create, rename, drag and drop with persisted order', T, async () => {
  const { ctx, page, client, watch: w } = await signedIn(browser, srv.base, 'dnd@example.com', { signup: 'Drag Person' });
  const created = (await client.post('/api/boards', { name: 'DnD board' })).body;
  await openBoard(page, srv.base, 'DnD board');

  // Add a list and cards through the UI.
  await page.click('[data-action="add-list"]');
  await page.click('.add-list button:has-text("Add list")');
  await page.waitForSelector('.add-list .field.invalid');
  await page.fill('.add-list input', 'QA');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.list-name:text-is("QA")');
  await page.keyboard.press('Escape');

  await listEl(page, 'To do').locator('[data-action="add-card"]').click();
  for (const t of ['Alpha', 'Bravo', 'Charlie']) {
    await page.fill('.composer textarea', t);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`.card-title:text-is("${t}")`);
  }
  await page.keyboard.press('Escape');
  assert.deepEqual(await titles(page, 'To do'), ['Alpha', 'Bravo', 'Charlie']);

  // Rename a list inline.
  await listEl(page, 'QA').locator('.list-name').click();
  await page.fill('.list-name-input', 'Testing');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.list-name:text-is("Testing")');

  // Drag Alpha to "In progress".
  const target = await listEl(page, 'In progress').locator('.cards').boundingBox();
  await mouseDrag(page, page.locator('.card', { hasText: 'Alpha' }), { x: target.x + target.width / 2, y: target.y + 20 });
  await page.waitForFunction(() => !document.body.classList.contains('is-dragging'));
  assert.deepEqual(await titles(page, 'In progress'), ['Alpha']);
  assert.deepEqual(await titles(page, 'To do'), ['Bravo', 'Charlie']);

  // Reorder within a list: Charlie above Bravo.
  const bravo = await page.locator('.card', { hasText: 'Bravo' }).boundingBox();
  await mouseDrag(page, page.locator('.card', { hasText: 'Charlie' }), { x: bravo.x + bravo.width / 2, y: bravo.y + 5 });
  assert.deepEqual(await titles(page, 'To do'), ['Charlie', 'Bravo']);

  // Drag the "Testing" list to the front by its header.
  const first = await page.locator('.canvas > .list').first().boundingBox();
  await mouseDrag(page, listEl(page, 'Testing').locator('.list-count'), { x: first.x + 10, y: first.y + 20 });
  assert.deepEqual(await page.locator('.list-name').allTextContents(), ['Testing', 'To do', 'In progress', 'Done']);

  // Order is persisted on the server and survives a reload.
  await page.waitForTimeout(400);
  const b = (await client.get(`/api/boards/${created.board.id}`)).body;
  const byList = name => { const l = b.lists.find(x => x.name === name); return b.cards.filter(c => c.listId === l.id).sort((p, q) => p.position - q.position).map(c => c.title); };
  assert.deepEqual(b.lists.map(l => l.name), ['Testing', 'To do', 'In progress', 'Done']);
  assert.deepEqual(byList('To do'), ['Charlie', 'Bravo']);
  assert.deepEqual(byList('In progress'), ['Alpha']);
  await page.reload();
  await page.waitForSelector('.canvas > .list');
  assert.deepEqual(await titles(page, 'To do'), ['Charlie', 'Bravo']);

  // Clicking a card (no drag) opens it; a drag never does.
  await page.click('.card:has-text("Bravo")');
  await page.waitForSelector('.card-modal');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.card-modal', { state: 'detached' });

  // Delete a list via its menu.
  await listEl(page, 'Testing').locator('[data-action="list-menu"]').click();
  await page.click('[data-m="delete"]');
  await page.click('.modal-foot button:has-text("Delete list")');
  await page.waitForSelector('.list-name:text-is("Testing")', { state: 'detached' });
  w.check();
  await ctx.close();
});

test('touch drag and drop (long-press) on a phone-sized screen', T, async () => {
  const { ctx, page, client, watch: w } = await signedIn(browser, srv.base, 'touch@example.com', { signup: 'Touch Person', context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } });
  const board = (await client.post('/api/boards', { name: 'Touch board' })).body;
  for (const t of ['Tap one', 'Tap two', 'Tap three']) await client.post(`/api/lists/${board.lists[0].id}/cards`, { title: t });
  await openBoard(page, srv.base, 'Touch board');
  const cdp = await ctx.newCDPSession(page);
  const from = await page.locator('.card', { hasText: 'Tap three' }).boundingBox();
  const to = await page.locator('.card', { hasText: 'Tap one' }).boundingBox();
  const sx = from.x + from.width / 2, sy = from.y + from.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  await page.waitForTimeout(400); // long-press
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy + (to.y + 4 - sy) * i / steps }] });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  assert.deepEqual(await titles(page, 'To do'), ['Tap three', 'Tap one', 'Tap two']);
  const b = (await client.get(`/api/boards/${board.board.id}`)).body;
  assert.deepEqual(b.cards.sort((p, q) => p.position - q.position).map(c => c.title), ['Tap three', 'Tap one', 'Tap two']);
  w.check();
  await ctx.close();
});

test('card details: markdown (XSS-safe), due date, labels, members, checklist, comments, links, blocked, move, delete', T, async () => {
  const { ctx, page, client, watch: w } = await signedIn(browser, srv.base, 'cards@example.com', { signup: 'Card Person' });
  const board = (await client.post('/api/boards', { name: 'Detail board' })).body;
  await client.post(`/api/lists/${board.lists[0].id}/cards`, { title: 'Write the spec' });
  await openBoard(page, srv.base, 'Detail board');
  await page.click('.card:has-text("Write the spec")');
  await page.waitForSelector('.cm-grid');
  assert.match(page.url(), /#\/b\/[^/]+\/c\/[^/]+$/);

  // Title
  await page.fill('[data-title]', 'Write the product spec');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.card-title:text-is("Write the product spec")');

  // Description with Markdown and hostile HTML
  await page.click('.desc-empty');
  await page.fill('[data-desc] textarea', '# Goals\n**Bold move** and _style_\n\n- one\n- [x] done\n\n<img src=x onerror="window.__xss=1"> [bad](javascript:window.__xss=2) [good](https://example.com)');
  await page.click('[data-desc] button:has-text("Save")');
  await page.waitForSelector('.desc-view strong:has-text("Bold move")');
  assert.equal(await page.locator('.desc-view img').count(), 0);
  assert.equal(await page.locator('.desc-view a[href^="javascript"]').count(), 0);
  assert.equal(await page.locator('.desc-view a[href="https://example.com"]').getAttribute('rel'), 'noopener noreferrer nofollow');
  assert.equal(await page.evaluate(() => window.__xss), undefined);

  // Due date (quick pick) and invalid input handling
  await page.click('.cm-side [data-act="due"]');
  await page.click('.popover button:has-text("Tomorrow")');
  await page.click('.popover button:has-text("Save")');
  await page.waitForSelector('.due-chip');

  // Labels and members
  await page.click('.cm-side [data-act="labels"]');
  await page.click('.popover [data-label] >> text=Bug');
  await page.waitForSelector('.cm-meta .lbl-chip:has-text("Bug")');
  await page.fill('.popover [name=name]', 'Docs');
  await page.click('.popover button:has-text("Create")');
  await page.waitForSelector('.cm-meta .lbl-chip:has-text("Docs")');
  await page.keyboard.press('Escape');
  await page.click('.cm-side [data-act="members"]');
  await page.click('.popover [data-user]');
  await page.waitForSelector('.cm-meta .avatar[title="Card Person"]');
  await page.keyboard.press('Escape');

  // Checklist with progress
  await page.click('.cm-side [data-act="add-item"]');
  await page.click('[data-check-add] button:has-text("Add")');
  await page.waitForSelector('[data-check-add] .field.invalid');
  for (const t of ['Outline', 'Draft']) {
    await page.fill('[data-check-add] input', t);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`.check-item .txt:text-is("${t}")`);
  }
  await page.locator('.check-item', { hasText: 'Outline' }).locator('input[type=checkbox]').check();
  await page.waitForSelector('.progress .pct:text-is("50%")');

  // Comment and link attachment (with validation)
  await page.click('[data-comment-form] button:has-text("Save comment")');
  await page.waitForSelector('[data-comment-form] .field.invalid');
  await page.fill('[data-comment-form] textarea', 'Looks **great** <b>raw</b>');
  await page.click('[data-comment-form] button:has-text("Save comment")');
  await page.waitForSelector('.comment .bubble strong:has-text("great")');
  assert.equal(await page.locator('.comment .bubble b').count(), 0);
  await page.click('.cm-side [data-act="add-link"]');
  await page.fill('[data-attach-form] [name=url]', 'javascript:alert(1)');
  await page.click('[data-attach-form] button:has-text("Attach")');
  await page.waitForSelector('[data-attach-form] [data-field="url"].invalid');
  await page.fill('[data-attach-form] [name=url]', 'https://www.figma.com/file/demo');
  await page.fill('[data-attach-form] [name=title]', 'Mockups');
  await page.click('[data-attach-form] button:has-text("Attach")');
  await page.waitForSelector('.attach a:has-text("Mockups")');

  // Blocked flag
  await page.click('.cm-side [data-act="blocked"]');
  await page.waitForSelector('.cm-side [data-act="blocked"].is-on');

  // The board card shows everything at a glance
  await page.keyboard.press('Escape');
  await page.waitForSelector('.card-modal', { state: 'detached' });
  const card = page.locator('.card', { hasText: 'Write the product spec' });
  await card.locator('.badge.blocked').waitFor();
  assert.deepEqual(await card.locator('.lbl-chip').allTextContents(), ['Bug', 'Docs']);
  assert.equal((await card.locator('.badge:has(svg)').allTextContents()).map(s => s.trim()).filter(s => s === '1/2').length, 1);
  assert.equal(await card.locator('.avatar').count(), 1);
  assert.match(await card.locator('.card-meta').textContent(), /Tomorrow/);

  // Move via the modal (keyboard-friendly alternative to drag and drop), then delete
  await card.click();
  await page.click('.cm-side [data-act="move"]');
  await page.selectOption('#mv-list', { label: 'Done' });
  await page.click('.popover button:has-text("Move")');
  await page.waitForSelector('.cm-sub:has-text("Done")');
  await page.click('.cm-side [data-act="delete"]');
  await page.click('.modal-foot button:has-text("Delete card")');
  await page.waitForSelector('.card-modal', { state: 'detached' });
  assert.equal(await page.locator('.card', { hasText: 'Write the product spec' }).count(), 0);
  w.check();
  await ctx.close();
});

test('search and filters by text, label, member, due date and blocked', T, async () => {
  const { ctx, page, watch: w } = await signedIn(browser, srv.base, 'maya@example.com');
  await openBoard(page, srv.base, 'Website relaunch');
  const visible = () => page.locator('.canvas .card:not(.filtered-out)').count();
  const total = await page.locator('.canvas .card').count();
  await page.fill('[data-search]', 'pricing');
  await page.waitForSelector('[data-filter-bar]:not([hidden])');
  assert.equal(await visible(), 2);
  assert.equal(await page.locator('[data-filter-text]').textContent(), `Showing 2 of ${total} cards`);
  await page.fill('[data-search]', '');
  await page.click('[data-action="clear-filters"]');

  await page.click('[data-action="filter"]');
  await page.locator('.popover .pop-row', { hasText: 'Blocked cards only' }).click();
  assert.equal(await visible(), 2);
  await page.locator('.popover .pop-row', { hasText: 'Blocked cards only' }).click();
  await page.locator('.popover .pop-row', { hasText: 'Overdue' }).first().click();
  const overdue = await visible();
  assert.ok(overdue >= 2 && overdue < total);
  assert.equal(await page.locator('.canvas .card:not(.filtered-out) .badge.overdue').count(), overdue);
  await page.locator('.popover .pop-row', { hasText: 'Any due date' }).click();
  await page.locator('.popover .pop-row', { hasText: 'Sam Rivera' }).click();
  const sams = await visible();
  assert.ok(sams > 0 && sams < total);
  assert.equal(await page.locator('[data-filter-count]').textContent(), '1');
  await page.locator('.popover .pop-row .lbl-bar', { hasText: 'Bug' }).click();
  assert.ok(await visible() <= sams);
  await page.click('.popover [data-f-clear]');
  assert.equal(await visible(), total);
  await page.keyboard.press('Escape');
  w.check();
  await ctx.close();
});

test('AI Standup panel: summary, focus scores, Slack copy and Markdown export', T, async () => {
  const { ctx, page, watch: w } = await signedIn(browser, srv.base, 'maya@example.com');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.base });
  await openBoard(page, srv.base, 'Website relaunch');
  assert.equal(await page.locator('[data-members] .focus-badge').count(), 3);
  await page.click('[data-action="standup"]');
  await page.waitForSelector('.panel.standup.is-open .people');
  assert.equal(await page.locator('[data-mode]').textContent(), 'Rule-based summary');
  assert.equal(await page.locator('.su-stat').count(), 4);
  assert.match(await page.locator('[data-narrative]').textContent(), /In the last 24 hours the team made \d+ updates/);
  for (const s of ['done', 'progress', 'blocked', 'overdue']) assert.equal(await page.locator(`[data-su="${s}"]`).count(), 1);
  assert.ok(await page.locator('[data-su="blocked"] .su-item').count() >= 2);
  assert.equal(await page.locator('.person').count(), 3);
  const score = Number(await page.locator('.person .gauge b').first().textContent());
  assert.ok(score >= 0 && score <= 100);
  await page.click('.formula summary');
  await page.waitForSelector('.formula code:has-text("15 × overdue")');

  await page.click('[data-action="su-slack"]');
  await page.waitForSelector('.toast:has-text("Copied")');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /^\*Standup: Website relaunch\*/);
  assert.match(clip, /\*Focus scores\*/);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="su-md"]')]);
  assert.match(dl.suggestedFilename(), /^standup-website-relaunch-\d{4}-\d{2}-\d{2}\.md$/);
  const md = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(md, /^# Standup: Website relaunch/);
  assert.match(md, /## By person/);

  // Window selector and clicking through to a card
  await page.selectOption('[data-hours]', '168');
  await page.waitForSelector('.panel.standup .people');
  await page.locator('[data-su="blocked"] .su-item').first().click();
  await page.waitForSelector('.card-modal .cm-grid');
  await page.keyboard.press('Escape');
  await page.click('[data-close-panel]');

  // Activity panel
  await page.click('[data-action="activity"]');
  await page.waitForSelector('.panel.is-open .feed-item');
  const n = await page.locator('.feed-item').count();
  await page.click('[data-more]');
  await page.waitForFunction(k => document.querySelectorAll('.feed-item').length > k, n);
  w.check();
  await ctx.close();
});

test('real-time sync between two users in separate browser contexts', T, async () => {
  const A = await signedIn(browser, srv.base, 'maya@example.com');
  const B = await signedIn(browser, srv.base, 'sam@example.com');
  await openBoard(A.page, srv.base, 'Q4 planning');
  await openBoard(B.page, srv.base, 'Q4 planning');
  // Presence: each sees the other online.
  await A.page.waitForSelector('[data-members] [aria-label*="Sam Rivera"] .presence-dot');
  await B.page.waitForSelector('[data-members] [aria-label*="Maya Chen"] .presence-dot');

  // A adds a card → B sees it.
  await listEl(A.page, 'Ideas').locator('[data-action="add-card"]').click();
  await A.page.fill('.composer textarea', 'Realtime hello');
  await A.page.keyboard.press('Enter');
  await B.page.waitForSelector('.card-title:text-is("Realtime hello")', { timeout: 5000 });

  // B drags it to "This quarter" → A sees the move.
  const dest = await listEl(B.page, 'This quarter').locator('.cards').boundingBox();
  await mouseDrag(B.page, B.page.locator('.card', { hasText: 'Realtime hello' }), { x: dest.x + dest.width / 2, y: dest.y + 8 });
  await A.page.waitForFunction(() => {
    const l = [...document.querySelectorAll('.canvas > .list')].find(x => x.querySelector('.list-name').textContent === 'This quarter');
    return l && l.querySelector('.card-title').textContent === 'Realtime hello';
  }, null, { timeout: 5000 });

  // A has the card open; B comments → A's open modal updates live.
  await A.page.click('.card:has-text("Realtime hello")');
  await A.page.waitForSelector('.cm-grid');
  await B.page.click('.card:has-text("Realtime hello")');
  await B.page.fill('[data-comment-form] textarea', 'Seen it live!');
  await B.page.click('[data-comment-form] button:has-text("Save comment")');
  await A.page.waitForSelector('.comment .bubble:has-text("Seen it live!")', { timeout: 5000 });
  await B.page.keyboard.press('Escape');
  await A.page.keyboard.press('Escape');

  // B renames a list → A sees it; A's activity panel shows B's change.
  await A.page.click('[data-action="activity"]');
  await listEl(B.page, 'Ideas').locator('.list-name').click();
  await B.page.fill('.list-name-input', 'Idea pool');
  await B.page.keyboard.press('Enter');
  await A.page.waitForSelector('.list-name:text-is("Idea pool")', { timeout: 5000 });
  await A.page.waitForSelector('.feed-item:has-text("renamed the list “Ideas” to “Idea pool”")', { timeout: 5000 });
  A.watch.check(); B.watch.check();
  await A.ctx.close(); await B.ctx.close();
});

test('responsive at 390 px and 1280 px with no horizontal page scroll; dark mode', T, async () => {
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(srv.base);
    await page.waitForSelector('[data-form="signin"]');
    await noHorizontalScroll(page, `${width} sign-in`);
    await page.click('[data-action="use-demo"]');
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('.board-tile');
    await noHorizontalScroll(page, `${width} boards`);
    await page.locator('.board-tile', { hasText: 'Website relaunch' }).first().click();
    await page.waitForSelector('.canvas > .list');
    await noHorizontalScroll(page, `${width} board`);
    const tools = await page.locator('.board-tools').boundingBox();
    assert.ok(tools.x + tools.width <= width + 1, 'board toolbar fits');
    await page.locator('.card').first().click();
    await page.waitForSelector('.cm-grid');
    await noHorizontalScroll(page, `${width} card modal`);
    const modal = await page.locator('.card-modal').boundingBox();
    assert.ok(modal.width <= width, 'modal fits the screen');
    await page.keyboard.press('Escape');
    await page.click('[data-action="standup"]');
    await page.waitForSelector('.panel.standup.is-open .people');
    await page.waitForTimeout(350);
    const panel = await page.locator('.panel.standup').boundingBox();
    assert.ok(panel.x >= -1 && panel.x + panel.width <= width + 1, 'standup panel fits');
    await noHorizontalScroll(page, `${width} standup`);
    await page.click('[data-close-panel]');
    // Dark mode toggle persists across reloads.
    await page.click('[data-action="toggle-theme"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.reload();
    await page.waitForSelector('.canvas > .list');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await noHorizontalScroll(page, `${width} dark board`);
    w.check();
    await ctx.close();
  }
});

test('respects prefers-reduced-motion and keyboard access', T, async () => {
  const { ctx, page, watch: w } = await signedIn(browser, srv.base, 'priya@example.com', { context: { reducedMotion: 'reduce' } });
  await openBoard(page, srv.base, 'Website relaunch');
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.card')).transitionDuration);
  assert.ok(dur.split(',').every(d => parseFloat(d) < 0.01), dur);
  await page.locator('.card').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.card-modal .cm-grid');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.card-modal', { state: 'detached' });
  w.check();
  await ctx.close();
});
