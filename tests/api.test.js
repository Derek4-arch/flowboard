/* API tests: accounts, boards, lists, cards, card details, members & access control, activity, standup, CSRF. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer({ seed: true }); });
test.after(async () => { if (srv) await srv.stop(); });

const fresh = async (name) => {
  const c = new Client(srv.base);
  const email = `${name.toLowerCase()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await c.signup(name + ' Tester', email);
  c.email = email;
  return c;
};

test('health and public config', async () => {
  const c = new Client(srv.base);
  const h = await c.get('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.status, 'up');
  const cfg = await c.get('/api/config');
  assert.deepEqual(cfg.body.ai, { enabled: false, model: null });
  assert.equal(cfg.body.demo, true);
  assert.equal((await c.get('/api/me')).body.user, null);
});

test('security headers and static files', async () => {
  const c = new Client(srv.base);
  const r = await c.get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.text, /<title>Flowboard<\/title>/);
  assert.equal((await c.get('/js/app.js')).status, 200);
  assert.equal((await c.get('/../server/db.js')).status === 200 && (await c.get('/../server/db.js')).text.includes('DatabaseSync'), false);
});

test('sign up validates input and rejects duplicates', async () => {
  const c = new Client(srv.base);
  let r = await c.post('/api/auth/signup', { name: '', email: 'bad', password: 'short' });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.field, 'name');
  r = await c.post('/api/auth/signup', { name: 'Ok Name', email: 'bad', password: 'longenough' });
  assert.equal(r.body.field, 'email');
  r = await c.post('/api/auth/signup', { name: 'Ok Name', email: 'ok@example.com', password: 'short' });
  assert.equal(r.body.field, 'password');
  r = await c.post('/api/auth/signup', { name: 'Maya Again', email: 'MAYA@example.com', password: 'longenough' });
  assert.equal(r.status, 409);
  assert.equal(r.body.field, 'email');
});

test('sign in, session cookie, sign out', async () => {
  const c = new Client(srv.base);
  const bad = await c.post('/api/auth/signin', { email: 'maya@example.com', password: 'nope-nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'bad_credentials');
  const ok = await c.post('/api/auth/signin', { email: 'Maya@Example.com', password: 'flowboard123' });
  assert.equal(ok.status, 200);
  const sc = ok.headers.getSetCookie().join(';');
  assert.match(sc, /fb_sid=/);
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
  assert.equal((await c.get('/api/me')).body.user.email, 'maya@example.com');
  assert.equal((await c.post('/api/auth/signout')).status, 200);
  assert.equal((await c.get('/api/me')).body.user, null);
  const after = await c.get('/api/boards');
  assert.equal(after.status, 401);
});

test('mutations require same-origin JSON (CSRF protection)', async () => {
  const c = await fresh('Csrf');
  const cross = await c.post('/api/boards', { name: 'X' }, { origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  const form = await c.req('POST', '/api/boards', 'name=X', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  const same = await c.post('/api/boards', { name: 'Fine' }, { origin: srv.base.replace('127.0.0.1', '127.0.0.1') });
  assert.equal(same.status, 200);
});

test('board CRUD, star and colour', async () => {
  const c = await fresh('Owner');
  let r = await c.post('/api/boards', { name: '' });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'name');
  r = await c.post('/api/boards', { name: 'Launch', color: 'teal' });
  assert.equal(r.status, 200);
  const id = r.body.board.id;
  assert.equal(r.body.board.color, 'teal');
  assert.deepEqual(r.body.lists.map(l => l.name), ['To do', 'In progress', 'Done']);
  assert.deepEqual(r.body.lists.map(l => l.isDone), [false, false, true]);
  assert.ok(r.body.labels.some(l => l.name === 'Blocked'));
  const empty = await c.post('/api/boards', { name: 'Blank', template: false });
  assert.equal(empty.body.lists.length, 0);

  r = await c.patch(`/api/boards/${id}`, { name: 'Launch v2', color: 'rose' });
  assert.equal(r.body.board.name, 'Launch v2');
  assert.equal(r.body.board.color, 'rose');
  assert.equal((await c.patch(`/api/boards/${id}`, { color: 'neon' })).status, 400);

  assert.equal((await c.put(`/api/boards/${id}/star`, { starred: true })).body.starred, true);
  let list = (await c.get('/api/boards')).body.boards;
  assert.equal(list.find(b => b.id === id).starred, true);
  await c.put(`/api/boards/${id}/star`, { starred: false });
  list = (await c.get('/api/boards')).body.boards;
  assert.equal(list.find(b => b.id === id).starred, false);
  assert.equal(list.length, 2);

  assert.equal((await c.del(`/api/boards/${id}`)).body.deleted, true);
  assert.equal((await c.get(`/api/boards/${id}`)).status, 404);
});

test('lists: create, rename, reorder, delete', async () => {
  const c = await fresh('Lister');
  const b = (await c.post('/api/boards', { name: 'Lists', template: false })).body.board;
  assert.equal((await c.post(`/api/boards/${b.id}/lists`, { name: '  ' })).status, 400);
  const ids = [];
  for (const n of ['A', 'B', 'C']) ids.push((await c.post(`/api/boards/${b.id}/lists`, { name: n })).body.list.id);
  await c.patch(`/api/lists/${ids[0]}`, { name: 'Alpha' });
  await c.post(`/api/lists/${ids[2]}/move`, { index: 0 });
  let board = (await c.get(`/api/boards/${b.id}`)).body;
  assert.deepEqual(board.lists.map(l => l.name), ['C', 'Alpha', 'B']);
  await c.post(`/api/lists/${ids[1]}/cards`, { title: 'in B' });
  await c.del(`/api/lists/${ids[1]}`);
  board = (await c.get(`/api/boards/${b.id}`)).body;
  assert.deepEqual(board.lists.map(l => l.name), ['C', 'Alpha']);
  assert.equal(board.cards.length, 0);
});

test('cards: create, edit, move, reorder and delete with persisted order', async () => {
  const c = await fresh('Carder');
  const board = (await c.post('/api/boards', { name: 'Cards' })).body;
  const [todo, doing, done] = board.lists.map(l => l.id);
  assert.equal((await c.post(`/api/lists/${todo}/cards`, { title: '' })).body.field, 'title');
  const ids = [];
  for (const t of ['one', 'two', 'three']) ids.push((await c.post(`/api/lists/${todo}/cards`, { title: t })).body.card.id);

  let r = await c.patch(`/api/cards/${ids[0]}`, { title: 'one!', description: '**hi**', due: '2030-01-31', blocked: true });
  assert.equal(r.status, 200);
  assert.equal((await c.patch(`/api/cards/${ids[0]}`, { due: '2030-02-31' })).body.field, 'due');
  let card = (await c.get(`/api/cards/${ids[0]}`)).body.card;
  assert.equal(card.title, 'one!');
  assert.equal(card.description, '**hi**');
  assert.equal(card.due, '2030-01-31');
  assert.equal(card.blocked, true);

  await c.post(`/api/cards/${ids[2]}/move`, { listId: todo, index: 0 });
  await c.post(`/api/cards/${ids[0]}/move`, { listId: doing, index: 0 });
  await c.post(`/api/cards/${ids[1]}/move`, { listId: done, index: 5 });
  const b = (await c.get(`/api/boards/${board.board.id}`)).body;
  const inList = id => b.cards.filter(x => x.listId === id).sort((p, q) => p.position - q.position).map(x => x.title);
  assert.deepEqual(inList(todo), ['three']);
  assert.deepEqual(inList(doing), ['one!']);
  assert.deepEqual(inList(done), ['two']);

  assert.equal((await c.del(`/api/cards/${ids[2]}`)).body.deleted, true);
  assert.equal((await c.get(`/api/cards/${ids[2]}`)).status, 404);
});

test('card details: labels, assignees, checklist, comments, attachments', async () => {
  const c = await fresh('Detail');
  const other = await fresh('Other');
  const board = (await c.post('/api/boards', { name: 'Details' })).body;
  const bid = board.board.id;
  const cid = (await c.post(`/api/lists/${board.lists[0].id}/cards`, { title: 'Rich card' })).body.card.id;
  const label = board.labels.find(l => l.name === 'Bug');

  assert.equal((await c.put(`/api/cards/${cid}/labels/${label.id}`)).status, 200);
  const created = await c.post(`/api/boards/${bid}/labels`, { name: 'Urgent', color: 'red' });
  assert.equal(created.status, 200);
  assert.equal((await c.post(`/api/boards/${bid}/labels`, { name: 'urgent', color: 'red' })).status, 409);
  assert.equal((await c.post(`/api/boards/${bid}/labels`, { name: 'X', color: 'chartreuse' })).body.field, 'color');
  await c.put(`/api/cards/${cid}/labels/${created.body.label.id}`);
  await c.del(`/api/cards/${cid}/labels/${label.id}`);

  assert.equal((await c.put(`/api/cards/${cid}/assignees/${c.user.id}`)).status, 200);
  assert.equal((await c.put(`/api/cards/${cid}/assignees/${other.user.id}`)).status, 400, 'non-members cannot be assigned');

  await c.post(`/api/cards/${cid}/checklist`, { text: 'First' });
  await c.post(`/api/cards/${cid}/checklist`, { text: 'Second' });
  assert.equal((await c.post(`/api/cards/${cid}/checklist`, { text: '' })).status, 400);
  let card = (await c.get(`/api/cards/${cid}`)).body.card;
  await c.patch(`/api/checklist/${card.checklist[0].id}`, { done: true });
  await c.patch(`/api/checklist/${card.checklist[1].id}`, { text: 'Second (edited)' });

  await c.post(`/api/cards/${cid}/comments`, { body: 'Looks **good** <script>x</script>' });
  assert.equal((await c.post(`/api/cards/${cid}/comments`, { body: '   ' })).status, 400);
  assert.equal((await c.post(`/api/cards/${cid}/attachments`, { url: 'javascript:alert(1)' })).body.field, 'url');
  assert.equal((await c.post(`/api/cards/${cid}/attachments`, { url: 'https://www.figma.com/file/abc' })).status, 200);

  card = (await c.get(`/api/cards/${cid}`)).body.card;
  assert.deepEqual(card.labelIds, [created.body.label.id]);
  assert.deepEqual(card.assigneeIds, [c.user.id]);
  assert.deepEqual(card.checklist.map(i => [i.text, i.done]), [['First', true], ['Second (edited)', false]]);
  assert.equal(card.comments[0].body, 'Looks **good** <script>x</script>', 'stored raw; rendered safely in the browser');
  assert.equal(card.attachments[0].title, 'figma.com');
  assert.ok(card.activity.length >= 6);

  const summary = (await c.get(`/api/boards/${bid}`)).body.cards.find(x => x.id === cid);
  assert.deepEqual(summary.checklist, { done: 1, total: 2 });
  assert.equal(summary.comments, 1);
  assert.equal(summary.attachments, 1);

  await c.del(`/api/checklist/${card.checklist[1].id}`);
  await c.del(`/api/attachments/${card.attachments[0].id}`);
  await c.del(`/api/comments/${card.comments[0].id}`);
  card = (await c.get(`/api/cards/${cid}`)).body.card;
  assert.equal(card.checklist.length, 1);
  assert.equal(card.attachments.length, 0);
  assert.equal(card.comments.length, 0);
});

test('members and access control', async () => {
  const owner = await fresh('Boss');
  const mate = await fresh('Mate');
  const outsider = await fresh('Outsider');
  const board = (await owner.post('/api/boards', { name: 'Private' })).body;
  const bid = board.board.id;
  const cid = (await owner.post(`/api/lists/${board.lists[0].id}/cards`, { title: 'Secret' })).body.card.id;

  assert.equal((await outsider.get(`/api/boards/${bid}`)).status, 404);
  assert.equal((await outsider.get(`/api/cards/${cid}`)).status, 404);
  assert.equal((await outsider.patch(`/api/cards/${cid}`, { title: 'pwned' })).status, 404);
  assert.equal((await outsider.post(`/api/boards/${bid}/members`, { email: outsider.email })).status, 404);

  let r = await owner.post(`/api/boards/${bid}/members`, { email: 'nobody@nowhere.example' });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /No Flowboard account/);
  r = await owner.post(`/api/boards/${bid}/members`, { email: mate.email.toUpperCase() });
  assert.equal(r.status, 200);
  assert.equal((await owner.post(`/api/boards/${bid}/members`, { email: mate.email })).status, 409);

  assert.equal((await mate.get(`/api/boards/${bid}`)).status, 200);
  assert.equal((await mate.patch(`/api/cards/${cid}`, { title: 'Shared' })).status, 200);
  await owner.put(`/api/cards/${cid}/assignees/${mate.user.id}`);
  assert.equal((await mate.del(`/api/boards/${bid}`)).status, 403);
  assert.equal((await mate.del(`/api/boards/${bid}/members/${owner.user.id}`)).status, 403);
  assert.equal((await owner.del(`/api/boards/${bid}/members/${owner.user.id}`)).status, 403, 'the owner cannot leave their own board');

  r = await owner.del(`/api/boards/${bid}/members/${mate.user.id}`);
  assert.equal(r.status, 200);
  assert.equal((await mate.get(`/api/boards/${bid}`)).status, 404);
  const card = (await owner.get(`/api/cards/${cid}`)).body.card;
  assert.deepEqual(card.assigneeIds, [], 'removed members are unassigned');

  await owner.post(`/api/boards/${bid}/members`, { email: mate.email });
  assert.equal((await mate.del(`/api/boards/${bid}/members/${mate.user.id}`)).status, 200, 'members can leave');
  assert.equal((await mate.get(`/api/boards/${bid}`)).status, 404);
});

test('activity log with pagination', async () => {
  const c = await fresh('Logger');
  const board = (await c.post('/api/boards', { name: 'Log' })).body;
  const bid = board.board.id;
  for (let i = 0; i < 7; i++) await c.post(`/api/lists/${board.lists[0].id}/cards`, { title: `Card ${i}` });
  const first = (await c.get(`/api/boards/${bid}/activity?limit=5`)).body;
  assert.equal(first.activity.length, 5);
  assert.equal(first.more, true);
  assert.equal(first.activity[0].text, 'added “Card 6” to To do');
  assert.equal(first.activity[0].userName, 'Logger Tester');
  const next = (await c.get(`/api/boards/${bid}/activity?limit=5&before=${first.activity[4].id}`)).body;
  assert.equal(next.activity.length, 3);
  assert.equal(next.more, false);
  assert.equal(next.activity[2].text, 'created this board');
});

test('standup: rule-based report on the demo board', async () => {
  const c = new Client(srv.base);
  await c.signin('maya@example.com');
  const boards = (await c.get('/api/boards')).body.boards;
  const demo = boards.find(b => b.name === 'Website relaunch');
  const board = (await c.get(`/api/boards/${demo.id}`)).body;
  assert.equal(Object.keys(board.focus).length, 3);
  for (const f of Object.values(board.focus)) { assert.ok(f.score >= 0 && f.score <= 100); assert.ok(['focused', 'stretched', 'overloaded'].includes(f.level)); }

  const rep = (await c.get(`/api/boards/${demo.id}/standup`)).body.report;
  assert.equal(rep.mode, 'rules');
  assert.equal(rep.hours, 24);
  assert.ok(rep.stats.updates > 5);
  assert.ok(rep.done.length >= 1, 'something was finished in the last 24h');
  assert.ok(rep.blocked.some(r => r.title === 'Contact form spam protection'), 'blocked flag');
  assert.ok(rep.blocked.some(r => r.title === 'Cookie consent banner copy'), 'Blocked label');
  assert.ok(rep.overdue.length >= 1 && rep.overdue.every(r => r.overdueDays > 0));
  assert.equal(rep.people.length, 3);
  rep.people.forEach(p => assert.equal(p.focus.score, board.focus[p.id].score));
  assert.match(rep.markdown, /^# Standup: Website relaunch/);
  assert.match(rep.markdown, /## By person/);
  assert.match(rep.slack, /\*Focus scores\*/);
  const week = (await c.get(`/api/boards/${demo.id}/standup?hours=168`)).body.report;
  assert.equal(week.hours, 168);
  assert.ok(week.stats.updates >= rep.stats.updates);

  // The rules react to new activity: finishing a card shows up as done.
  const review = board.lists.find(l => l.name === 'Review');
  const doneList = board.lists.find(l => l.name === 'Done');
  const target = board.cards.find(x => x.listId === review.id);
  await c.post(`/api/cards/${target.id}/move`, { listId: doneList.id, index: 0 });
  const after = (await c.get(`/api/boards/${demo.id}/standup`)).body.report;
  assert.ok(after.done.some(r => r.id === target.id));
  assert.equal(after.stats.done, rep.stats.done + 1);
});

test('unknown API routes return JSON 404', async () => {
  const c = new Client(srv.base);
  const r = await c.get('/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
});
