/* Live collaboration over Server-Sent Events: presence, change events, own-change tagging, removal, deletion. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client, openEvents } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer({ seed: false }); });
test.after(async () => { if (srv) await srv.stop(); });

test('changes and presence are pushed to other members in real time', async () => {
  const a = new Client(srv.base), b = new Client(srv.base);
  await a.signup('Ana Live', 'ana@live.example');
  await b.signup('Ben Live', 'ben@live.example');
  const board = (await a.post('/api/boards', { name: 'Live board' })).body;
  const bid = board.board.id;
  await a.post(`/api/boards/${bid}/members`, { email: 'ben@live.example' });

  const outsider = new Client(srv.base);
  await outsider.signup('Olly Out', 'olly@live.example');
  const denied = await fetch(`${srv.base}/api/boards/${bid}/events`, { headers: { cookie: outsider.cookie } });
  assert.equal(denied.status, 404);

  const sb = await openEvents(b, bid);
  assert.equal(sb.status, 200);
  await sb.waitFor(e => e.event === 'hello');
  const sa = await openEvents(a, bid);
  const pres = await sb.waitFor(e => e.event === 'presence' && e.data.users.length === 2);
  assert.deepEqual(pres.data.users.map(u => u.name).sort(), ['Ana Live', 'Ben Live']);

  const card = (await a.post(`/api/lists/${board.lists[0].id}/cards`, { title: 'Pushed card' })).body.card;
  const ev = await sb.waitFor(e => e.event === 'change' && e.data.cardIds.includes(card.id));
  assert.equal(ev.data.clientId, a.clientId, 'the sender tab can ignore its own echo');
  assert.equal(ev.data.actor, a.user.id);
  assert.equal(ev.data.activity[0].text, 'added “Pushed card” to To do');
  assert.equal(ev.data.activity[0].userName, 'Ana Live');
  const v1 = ev.data.version;

  await a.post(`/api/cards/${card.id}/move`, { listId: board.lists[2].id, index: 0 });
  const mv = await sb.waitFor(e => e.event === 'change' && e.data.version > v1);
  assert.equal(mv.data.activity[0].type, 'card.move');
  await sa.waitFor(e => e.event === 'change' && e.data.version === mv.data.version);

  sa.close();
  await sb.waitFor(e => e.event === 'presence' && e.data.users.length === 1);

  await a.del(`/api/boards/${bid}/members/${b.user.id}`);
  await sb.waitFor(e => e.event === 'removed');
  sb.close();
});

test('deleting a board notifies everyone watching it', async () => {
  const a = new Client(srv.base), b = new Client(srv.base);
  await a.signup('Del Owner', 'del-owner@live.example');
  await b.signup('Del Mate', 'del-mate@live.example');
  const bid = (await a.post('/api/boards', { name: 'Doomed' })).body.board.id;
  await a.post(`/api/boards/${bid}/members`, { email: 'del-mate@live.example' });
  const sb = await openEvents(b, bid);
  await sb.waitFor(e => e.event === 'hello');
  await a.del(`/api/boards/${bid}`);
  const ev = await sb.waitFor(e => e.event === 'deleted');
  assert.equal(ev.data.actor, a.user.id);
  sb.close();
  const health = (await a.get('/api/health')).body;
  assert.equal(typeof health.liveConnections, 'number');
});
