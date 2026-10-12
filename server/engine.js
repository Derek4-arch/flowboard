/* Flowboard domain logic: accounts, sessions, boards, members, lists, cards and card details.
   Every change runs in a transaction, bumps the board version, writes activity rows and is then
   published to live subscribers (realtime.js). All checks happen here, never only in the browser. */
'use strict';
const crypto = require('node:crypto');
const { validate: V, activityText } = require('./shared');

class UserError extends Error {
  constructor(message, field, status, code) { super(message); this.field = field; this.status = status || 400; this.code = code; }
}
const notFound = what => new UserError(`${what} not found.`, undefined, 404, 'not_found');
const forbidden = msg => new UserError(msg, undefined, 403, 'forbidden');

const AVATAR_COLORS = ['#4F6BED', '#0F9D8A', '#D9480F', '#9C36B5', '#2B8A3E', '#C2255C', '#1C7ED6', '#E67700'];
const rid = p => p + crypto.randomBytes(9).toString('base64url');
const now = () => Date.now();
const str = v => (v == null ? '' : String(v)).trim();

// ——— Passwords (scrypt) ———
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}
function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64url'), expected.length, { N: +N, r: +r, p: +p });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
const DUMMY_HASH = hashPassword('timing-equaliser');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function createEngine({ db, config, realtime, standup }) {
  const E = { UserError };
  const fail = (errors) => { const k = Object.keys(errors)[0]; if (k) throw new UserError(errors[k], k); };
  const publicUser = u => u && { id: u.id, name: u.name, email: u.email, color: u.color };

  // ——— Accounts & sessions ———
  E.register = function (body) {
    body = body || {};
    fail(V.check(body, { name: 'name', email: 'email', password: 'password' }));
    const email = str(body.email).toLowerCase();
    return db.tx(() => {
      if (db.get('SELECT 1 FROM users WHERE email = ?', email)) throw new UserError('An account with this email already exists. Try signing in.', 'email', 409);
      const count = db.get('SELECT COUNT(*) AS n FROM users').n;
      const id = rid('u');
      db.run('INSERT INTO users (id, email, name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id, email, str(body.name), hashPassword(body.password), AVATAR_COLORS[count % AVATAR_COLORS.length], now());
      return publicUser(db.get('SELECT * FROM users WHERE id = ?', id));
    });
  };
  E.authenticate = function (email, password) {
    const u = db.get('SELECT * FROM users WHERE email = ?', str(email).toLowerCase());
    const ok = verifyPassword(password || '', u ? u.password_hash : DUMMY_HASH);
    return u && ok ? publicUser(u) : null;
  };
  E.createSession = function (uid) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = now();
    db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), uid, t, t + config.sessionDays * 864e5);
    return token;
  };
  E.userForToken = function (token) {
    if (!token || token.length > 200) return null;
    const row = db.get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?', sha256(token), now());
    return publicUser(row);
  };
  E.deleteSession = token => { if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token)); };
  E.purgeSessions = () => db.run('DELETE FROM sessions WHERE expires_at <= ?', now());

  // ——— Access helpers ———
  function membership(boardId, uid) {
    const m = db.get('SELECT b.*, m.role, m.starred FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ? WHERE b.id = ?', uid, String(boardId || ''));
    if (!m) throw notFound('Board');
    return m;
  }
  function listFor(listId, uid) {
    const l = db.get('SELECT * FROM lists WHERE id = ?', String(listId || ''));
    if (!l) throw notFound('List');
    membership(l.board_id, uid);
    return l;
  }
  function cardFor(cardId, uid) {
    const c = db.get('SELECT c.*, l.name AS list_name FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?', String(cardId || ''));
    if (!c) throw notFound('Card');
    membership(c.board_id, uid);
    return c;
  }
  E.canView = (boardId, uid) => { try { membership(boardId, uid); return true; } catch (e) { return false; } };

  // Runs fn inside a transaction, bumps the board version, records activity and notifies live viewers.
  function change(actor, boardId, fn) {
    const acts = [];
    const log = (type, data, cardId) => acts.push({ type, data: data || {}, cardId: cardId || null });
    let t;
    const result = db.tx(() => {
      const r = fn(log);
      t = now();
      db.run('UPDATE boards SET version = version + 1, updated_at = ? WHERE id = ?', t, boardId);
      acts.forEach(a => db.run('INSERT INTO activity (board_id, card_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        boardId, a.cardId, actor.uid, a.type, JSON.stringify(a.data), t));
      return r;
    });
    const b = db.get('SELECT version FROM boards WHERE id = ?', boardId);
    if (b && realtime) {
      const user = db.get('SELECT name, color FROM users WHERE id = ?', actor.uid) || {};
      realtime.publish(boardId, {
        type: 'change', version: b.version, clientId: actor.clientId || null, actor: actor.uid,
        cardIds: [...new Set(acts.map(a => a.cardId).filter(Boolean))],
        activity: acts.map(a => ({ type: a.type, cardId: a.cardId, userName: user.name, text: activityText.describe(a.type, a.data), at: t }))
      });
    }
    return result;
  }
  const renumber = (table, col, parentId) => {
    db.all(`SELECT id FROM ${table} WHERE ${col} = ? ORDER BY position, rowid`, parentId)
      .forEach((r, i) => db.run(`UPDATE ${table} SET position = ? WHERE id = ?`, i, r.id));
  };
  const clampIndex = (i, n) => { i = Number.isFinite(+i) ? Math.floor(+i) : n; return Math.max(0, Math.min(n, i)); };

  // ——— Boards ———
  E.listBoards = function (uid) {
    return db.all(`SELECT b.id, b.name, b.color, b.updated_at AS updatedAt, m.role, m.starred,
        (SELECT COUNT(*) FROM board_members x WHERE x.board_id = b.id) AS memberCount,
        (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id) AS cardCount
      FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ? ORDER BY b.updated_at DESC`, uid)
      .map(b => Object.assign(b, { starred: !!b.starred }));
  };

  E.createBoard = function (actor, body) {
    body = body || {};
    fail(V.check(body, { name: 'boardName' }));
    const color = V.BOARD_COLORS.includes(body.color) ? body.color : 'indigo';
    const id = rid('b'), t = now();
    db.tx(() => {
      db.run('INSERT INTO boards (id, name, color, owner_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', id, str(body.name), color, actor.uid, t, t);
      db.run("INSERT INTO board_members (board_id, user_id, role, starred, joined_at) VALUES (?, ?, 'owner', 0, ?)", id, actor.uid, t);
      [['Blocked', 'red'], ['Bug', 'orange'], ['Feature', 'green'], ['Design', 'purple'], ['Research', 'sky']]
        .forEach(([n, c]) => db.run('INSERT INTO labels (id, board_id, name, color) VALUES (?, ?, ?, ?)', rid('l'), id, n, c));
      if (body.template !== false) ['To do', 'In progress', 'Done'].forEach((n, i) => db.run('INSERT INTO lists (id, board_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)', rid('L'), id, n, i, t));
      db.run("INSERT INTO activity (board_id, user_id, type, data, created_at) VALUES (?, ?, 'board.create', '{}', ?)", id, actor.uid, t);
    });
    return E.board(actor.uid, id);
  };

  E.board = function (uid, boardId) {
    const b = membership(boardId, uid);
    const members = db.all(`SELECT u.id, u.name, u.email, u.color, m.role FROM board_members m JOIN users u ON u.id = m.user_id
      WHERE m.board_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.joined_at`, b.id);
    const labels = db.all('SELECT id, name, color FROM labels WHERE board_id = ? ORDER BY rowid', b.id);
    const lists = db.all('SELECT id, name, position FROM lists WHERE board_id = ? ORDER BY position', b.id)
      .map(l => Object.assign(l, { isDone: standup.isDoneList(l.name) }));
    const by = (rows, key, val) => rows.reduce((m, r) => { (m[r[key]] = m[r[key]] || []).push(r[val]); return m; }, {});
    const cl = by(db.all('SELECT cl.card_id, cl.label_id FROM card_labels cl JOIN cards c ON c.id = cl.card_id JOIN labels l ON l.id = cl.label_id WHERE c.board_id = ? ORDER BY l.rowid', b.id), 'card_id', 'label_id');
    const ca = by(db.all('SELECT ca.card_id, ca.user_id FROM card_assignees ca JOIN cards c ON c.id = ca.card_id WHERE c.board_id = ?', b.id), 'card_id', 'user_id');
    const counts = (sql) => Object.fromEntries(db.all(sql, b.id).map(r => [r.card_id, r]));
    const chk = counts('SELECT i.card_id, COUNT(*) AS total, SUM(i.done) AS done FROM checklist_items i JOIN cards c ON c.id = i.card_id WHERE c.board_id = ? GROUP BY i.card_id');
    const com = counts('SELECT x.card_id, COUNT(*) AS n FROM comments x JOIN cards c ON c.id = x.card_id WHERE c.board_id = ? GROUP BY x.card_id');
    const att = counts('SELECT x.card_id, COUNT(*) AS n FROM attachments x JOIN cards c ON c.id = x.card_id WHERE c.board_id = ? GROUP BY x.card_id');
    const cards = db.all('SELECT id, list_id, title, description, position, due_date, blocked, created_at, updated_at FROM cards WHERE board_id = ? ORDER BY position', b.id)
      .map(c => ({
        id: c.id, listId: c.list_id, title: c.title, description: c.description, position: c.position, due: c.due_date, blocked: !!c.blocked,
        labelIds: cl[c.id] || [], assigneeIds: ca[c.id] || [],
        checklist: chk[c.id] ? { done: chk[c.id].done || 0, total: chk[c.id].total } : { done: 0, total: 0 },
        comments: com[c.id] ? com[c.id].n : 0, attachments: att[c.id] ? att[c.id].n : 0, createdAt: c.created_at, updatedAt: c.updated_at
      }));
    return {
      board: { id: b.id, name: b.name, color: b.color, ownerId: b.owner_id, role: b.role, starred: !!b.starred, version: b.version, updatedAt: b.updated_at },
      members, labels, lists, cards, focus: standup.focus(b.id), today: standup.today()
    };
  };

  E.updateBoard = function (actor, boardId, body) {
    const b = membership(boardId, actor.uid);
    body = body || {};
    const errs = {};
    if (body.name !== undefined) Object.assign(errs, V.check(body, { name: 'boardName' }));
    if (body.color !== undefined) Object.assign(errs, V.check(body, { color: 'boardColor' }));
    fail(errs);
    change(actor, b.id, log => {
      if (body.name !== undefined && str(body.name) !== b.name) { db.run('UPDATE boards SET name = ? WHERE id = ?', str(body.name), b.id); log('board.rename', { from: b.name, to: str(body.name) }); }
      if (body.color !== undefined && body.color !== b.color) { db.run('UPDATE boards SET color = ? WHERE id = ?', body.color, b.id); log('board.color', { color: body.color }); }
    });
    return E.board(actor.uid, b.id);
  };
  E.starBoard = function (uid, boardId, starred) {
    const b = membership(boardId, uid);
    db.run('UPDATE board_members SET starred = ? WHERE board_id = ? AND user_id = ?', starred ? 1 : 0, b.id, uid);
    return { starred: !!starred };
  };
  E.deleteBoard = function (actor, boardId) {
    const b = membership(boardId, actor.uid);
    if (b.role !== 'owner') throw forbidden('Only the board owner can delete this board.');
    db.run('DELETE FROM boards WHERE id = ?', b.id);
    if (realtime) realtime.publish(b.id, { type: 'deleted', clientId: actor.clientId || null, actor: actor.uid });
    return { deleted: true };
  };

  // ——— Members ———
  E.addMember = function (actor, boardId, body) {
    const b = membership(boardId, actor.uid);
    fail(V.check(body || {}, { email: 'email' }));
    const u = db.get('SELECT * FROM users WHERE email = ?', str(body.email).toLowerCase());
    if (!u) throw new UserError('No Flowboard account uses that email. Ask them to sign up first, then invite them.', 'email', 404);
    if (db.get('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?', b.id, u.id)) throw new UserError(`${u.name} is already a member of this board.`, 'email', 409);
    change(actor, b.id, log => {
      db.run("INSERT INTO board_members (board_id, user_id, role, starred, joined_at) VALUES (?, ?, 'member', 0, ?)", b.id, u.id, now());
      log('member.add', { member: u.name });
    });
    return { member: publicUser(u) };
  };
  E.removeMember = function (actor, boardId, userId) {
    const b = membership(boardId, actor.uid);
    const target = db.get('SELECT u.*, m.role FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND m.user_id = ?', b.id, String(userId));
    if (!target) throw notFound('Member');
    const self = target.id === actor.uid;
    if (target.role === 'owner') throw forbidden(self ? 'The owner cannot leave their own board. Delete it instead.' : 'The board owner cannot be removed.');
    if (!self && b.role !== 'owner') throw forbidden('Only the board owner can remove members.');
    change(actor, b.id, log => {
      db.run('DELETE FROM board_members WHERE board_id = ? AND user_id = ?', b.id, target.id);
      db.run('DELETE FROM card_assignees WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE board_id = ?)', target.id, b.id);
      log(self ? 'member.leave' : 'member.remove', { member: target.name });
    });
    if (realtime) realtime.kick(b.id, target.id);
    return { removed: true };
  };

  // ——— Labels ———
  E.createLabel = function (actor, boardId, body) {
    const b = membership(boardId, actor.uid);
    body = body || {};
    fail(V.check(body, { name: 'labelName', color: 'labelColor' }));
    if (db.get('SELECT 1 FROM labels WHERE board_id = ? AND lower(name) = lower(?)', b.id, str(body.name))) throw new UserError('A label with this name already exists.', 'name', 409);
    const id = rid('l');
    change(actor, b.id, log => {
      db.run('INSERT INTO labels (id, board_id, name, color) VALUES (?, ?, ?, ?)', id, b.id, str(body.name), body.color);
      log('label.create', { label: str(body.name) });
    });
    return { label: db.get('SELECT id, name, color FROM labels WHERE id = ?', id) };
  };
  function labelFor(labelId, uid) {
    const l = db.get('SELECT * FROM labels WHERE id = ?', String(labelId || ''));
    if (!l) throw notFound('Label');
    membership(l.board_id, uid);
    return l;
  }
  E.updateLabel = function (actor, labelId, body) {
    const l = labelFor(labelId, actor.uid);
    body = body || {};
    const next = { name: body.name !== undefined ? body.name : l.name, color: body.color !== undefined ? body.color : l.color };
    fail(V.check(next, { name: 'labelName', color: 'labelColor' }));
    if (db.get('SELECT 1 FROM labels WHERE board_id = ? AND lower(name) = lower(?) AND id != ?', l.board_id, str(next.name), l.id)) throw new UserError('A label with this name already exists.', 'name', 409);
    change(actor, l.board_id, log => { db.run('UPDATE labels SET name = ?, color = ? WHERE id = ?', str(next.name), next.color, l.id); log('label.update', { label: str(next.name) }); });
    return { label: db.get('SELECT id, name, color FROM labels WHERE id = ?', l.id) };
  };
  E.deleteLabel = function (actor, labelId) {
    const l = labelFor(labelId, actor.uid);
    change(actor, l.board_id, log => { db.run('DELETE FROM labels WHERE id = ?', l.id); log('label.delete', { label: l.name }); });
    return { deleted: true };
  };

  // ——— Lists ———
  E.createList = function (actor, boardId, body) {
    const b = membership(boardId, actor.uid);
    fail(V.check(body || {}, { name: 'listName' }));
    const id = rid('L');
    change(actor, b.id, log => {
      const pos = db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM lists WHERE board_id = ?', b.id).p;
      db.run('INSERT INTO lists (id, board_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)', id, b.id, str(body.name), pos, now());
      log('list.create', { list: str(body.name) });
    });
    return { list: db.get('SELECT id, name, position FROM lists WHERE id = ?', id) };
  };
  E.renameList = function (actor, listId, body) {
    const l = listFor(listId, actor.uid);
    fail(V.check(body || {}, { name: 'listName' }));
    const name = str(body.name);
    if (name !== l.name) change(actor, l.board_id, log => { db.run('UPDATE lists SET name = ? WHERE id = ?', name, l.id); log('list.rename', { from: l.name, to: name }); });
    return { list: { id: l.id, name } };
  };
  E.moveList = function (actor, listId, body) {
    const l = listFor(listId, actor.uid);
    change(actor, l.board_id, log => {
      const ids = db.all('SELECT id FROM lists WHERE board_id = ? AND id != ? ORDER BY position', l.board_id, l.id).map(r => r.id);
      const index = clampIndex((body || {}).index, ids.length);
      ids.splice(index, 0, l.id);
      ids.forEach((id, i) => db.run('UPDATE lists SET position = ? WHERE id = ?', i, id));
      log('list.move', { list: l.name, index });
    });
    return { moved: true };
  };
  E.deleteList = function (actor, listId) {
    const l = listFor(listId, actor.uid);
    change(actor, l.board_id, log => {
      const count = db.get('SELECT COUNT(*) AS n FROM cards WHERE list_id = ?', l.id).n;
      db.run('DELETE FROM lists WHERE id = ?', l.id);
      renumber('lists', 'board_id', l.board_id);
      log('list.delete', { list: l.name, count });
    });
    return { deleted: true };
  };

  // ——— Cards ———
  E.createCard = function (actor, listId, body) {
    const l = listFor(listId, actor.uid);
    fail(V.check(body || {}, { title: 'cardTitle' }));
    const id = rid('c'), t = now();
    change(actor, l.board_id, log => {
      const pos = db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM cards WHERE list_id = ?', l.id).p;
      db.run('INSERT INTO cards (id, board_id, list_id, title, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, l.board_id, l.id, str(body.title), pos, actor.uid, t, t);
      log('card.create', { card: str(body.title), list: l.name }, id);
    });
    return { card: { id, listId: l.id, title: str(body.title) } };
  };

  E.card = function (uid, cardId) {
    const c = cardFor(cardId, uid);
    const userCols = 'u.name AS userName, u.color AS userColor';
    return {
      card: {
        id: c.id, boardId: c.board_id, listId: c.list_id, listName: c.list_name, title: c.title, description: c.description, due: c.due_date,
        blocked: !!c.blocked, createdAt: c.created_at, updatedAt: c.updated_at,
        labelIds: db.all('SELECT label_id FROM card_labels WHERE card_id = ?', c.id).map(r => r.label_id),
        assigneeIds: db.all('SELECT user_id FROM card_assignees WHERE card_id = ?', c.id).map(r => r.user_id),
        checklist: db.all('SELECT id, text, done, position FROM checklist_items WHERE card_id = ? ORDER BY position', c.id).map(i => Object.assign(i, { done: !!i.done })),
        comments: db.all(`SELECT x.id, x.body, x.created_at AS createdAt, x.user_id AS userId, ${userCols} FROM comments x LEFT JOIN users u ON u.id = x.user_id WHERE x.card_id = ? ORDER BY x.created_at DESC`, c.id),
        attachments: db.all(`SELECT x.id, x.title, x.url, x.created_at AS createdAt, x.user_id AS userId, ${userCols} FROM attachments x LEFT JOIN users u ON u.id = x.user_id WHERE x.card_id = ? ORDER BY x.created_at`, c.id),
        activity: activityRows('a.card_id = ?', [c.id], 40)
      }
    };
  };

  E.updateCard = function (actor, cardId, body) {
    const c = cardFor(cardId, actor.uid);
    body = body || {};
    const errs = {};
    if (body.title !== undefined) Object.assign(errs, V.check(body, { title: 'cardTitle' }));
    if (body.description !== undefined) Object.assign(errs, V.check(body, { description: 'description' }));
    if (body.due !== undefined) Object.assign(errs, V.check(body, { due: 'due' }));
    fail(errs);
    change(actor, c.board_id, log => {
      const t = now();
      if (body.title !== undefined && str(body.title) !== c.title) { db.run('UPDATE cards SET title = ?, updated_at = ? WHERE id = ?', str(body.title), t, c.id); log('card.rename', { from: c.title, to: str(body.title), card: str(body.title) }, c.id); }
      const title = body.title !== undefined ? str(body.title) : c.title;
      if (body.description !== undefined && String(body.description) !== c.description) { db.run('UPDATE cards SET description = ?, updated_at = ? WHERE id = ?', String(body.description), t, c.id); log('card.desc', { card: title }, c.id); }
      if (body.due !== undefined) {
        const due = body.due ? String(body.due) : null;
        if (due !== c.due_date) { db.run('UPDATE cards SET due_date = ?, updated_at = ? WHERE id = ?', due, t, c.id); log('card.due', { card: title, due }, c.id); }
      }
      if (body.blocked !== undefined && !!body.blocked !== !!c.blocked) { db.run('UPDATE cards SET blocked = ?, updated_at = ? WHERE id = ?', body.blocked ? 1 : 0, t, c.id); log(body.blocked ? 'card.block' : 'card.unblock', { card: title }, c.id); }
    });
    return E.card(actor.uid, c.id);
  };

  E.moveCard = function (actor, cardId, body) {
    const c = cardFor(cardId, actor.uid);
    body = body || {};
    const to = body.listId ? db.get('SELECT * FROM lists WHERE id = ?', String(body.listId)) : db.get('SELECT * FROM lists WHERE id = ?', c.list_id);
    if (!to || to.board_id !== c.board_id) throw new UserError('Choose a list on this board.', 'listId', 400);
    let changed = false;
    change(actor, c.board_id, log => {
      const ids = db.all('SELECT id FROM cards WHERE list_id = ? AND id != ? ORDER BY position', to.id, c.id).map(r => r.id);
      const index = clampIndex(body.index, ids.length);
      const before = db.all('SELECT id FROM cards WHERE list_id = ? ORDER BY position', to.id).map(r => r.id);
      ids.splice(index, 0, c.id);
      changed = to.id !== c.list_id || before.join() !== ids.join();
      if (!changed) return;
      db.run('UPDATE cards SET list_id = ?, updated_at = ? WHERE id = ?', to.id, now(), c.id);
      ids.forEach((id, i) => db.run('UPDATE cards SET position = ? WHERE id = ?', i, id));
      if (to.id !== c.list_id) renumber('cards', 'list_id', c.list_id);
      log('card.move', { card: c.title, from: c.list_name, to: to.name, fromId: c.list_id, toId: to.id }, c.id);
    });
    return { moved: changed };
  };

  E.deleteCard = function (actor, cardId) {
    const c = cardFor(cardId, actor.uid);
    change(actor, c.board_id, log => {
      db.run('DELETE FROM cards WHERE id = ?', c.id);
      renumber('cards', 'list_id', c.list_id);
      log('card.delete', { card: c.title, list: c.list_name }, c.id);
    });
    return { deleted: true };
  };

  E.setCardLabel = function (actor, cardId, labelId, on) {
    const c = cardFor(cardId, actor.uid);
    const l = db.get('SELECT * FROM labels WHERE id = ? AND board_id = ?', String(labelId), c.board_id);
    if (!l) throw notFound('Label');
    const has = !!db.get('SELECT 1 FROM card_labels WHERE card_id = ? AND label_id = ?', c.id, l.id);
    if (has !== !!on) change(actor, c.board_id, log => {
      if (on) db.run('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)', c.id, l.id);
      else db.run('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?', c.id, l.id);
      log(on ? 'card.label' : 'card.unlabel', { card: c.title, label: l.name }, c.id);
    });
    return E.card(actor.uid, c.id);
  };

  E.setAssignee = function (actor, cardId, userId, on) {
    const c = cardFor(cardId, actor.uid);
    const u = db.get('SELECT u.* FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND m.user_id = ?', c.board_id, String(userId));
    if (!u) throw new UserError('Only board members can be assigned.', 'userId', 400);
    const has = !!db.get('SELECT 1 FROM card_assignees WHERE card_id = ? AND user_id = ?', c.id, u.id);
    if (has !== !!on) change(actor, c.board_id, log => {
      if (on) db.run('INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)', c.id, u.id);
      else db.run('DELETE FROM card_assignees WHERE card_id = ? AND user_id = ?', c.id, u.id);
      log(on ? 'card.assign' : 'card.unassign', { card: c.title, member: u.name, self: u.id === actor.uid }, c.id);
    });
    return E.card(actor.uid, c.id);
  };

  // ——— Checklist ———
  E.addChecklistItem = function (actor, cardId, body) {
    const c = cardFor(cardId, actor.uid);
    fail(V.check(body || {}, { text: 'checklistText' }));
    change(actor, c.board_id, log => {
      const pos = db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM checklist_items WHERE card_id = ?', c.id).p;
      db.run('INSERT INTO checklist_items (id, card_id, text, done, position, created_at) VALUES (?, ?, ?, 0, ?, ?)', rid('i'), c.id, str(body.text), pos, now());
      log('checklist.add', { card: c.title, item: str(body.text) }, c.id);
    });
    return E.card(actor.uid, c.id);
  };
  function itemFor(itemId, uid) {
    const i = db.get('SELECT * FROM checklist_items WHERE id = ?', String(itemId || ''));
    if (!i) throw notFound('Checklist item');
    return { item: i, card: cardFor(i.card_id, uid) };
  }
  E.updateChecklistItem = function (actor, itemId, body) {
    const { item, card } = itemFor(itemId, actor.uid);
    body = body || {};
    if (body.text !== undefined) fail(V.check(body, { text: 'checklistText' }));
    change(actor, card.board_id, log => {
      if (body.text !== undefined && str(body.text) !== item.text) { db.run('UPDATE checklist_items SET text = ? WHERE id = ?', str(body.text), item.id); log('checklist.edit', { card: card.title, item: str(body.text) }, card.id); }
      if (body.done !== undefined && !!body.done !== !!item.done) { db.run('UPDATE checklist_items SET done = ? WHERE id = ?', body.done ? 1 : 0, item.id); log(body.done ? 'checklist.check' : 'checklist.uncheck', { card: card.title, item: body.text !== undefined ? str(body.text) : item.text }, card.id); }
    });
    return E.card(actor.uid, card.id);
  };
  E.deleteChecklistItem = function (actor, itemId) {
    const { item, card } = itemFor(itemId, actor.uid);
    change(actor, card.board_id, log => {
      db.run('DELETE FROM checklist_items WHERE id = ?', item.id);
      renumber('checklist_items', 'card_id', card.id);
      log('checklist.delete', { card: card.title, item: item.text }, card.id);
    });
    return E.card(actor.uid, card.id);
  };

  // ——— Comments & attachments ———
  E.addComment = function (actor, cardId, body) {
    const c = cardFor(cardId, actor.uid);
    fail(V.check(body || {}, { body: 'comment' }));
    change(actor, c.board_id, log => {
      db.run('INSERT INTO comments (id, card_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', rid('m'), c.id, actor.uid, str(body.body), now());
      log('comment.add', { card: c.title, excerpt: str(body.body).slice(0, 140) }, c.id);
    });
    return E.card(actor.uid, c.id);
  };
  E.deleteComment = function (actor, commentId) {
    const x = db.get('SELECT * FROM comments WHERE id = ?', String(commentId || ''));
    if (!x) throw notFound('Comment');
    const c = cardFor(x.card_id, actor.uid);
    const role = membership(c.board_id, actor.uid).role;
    if (x.user_id !== actor.uid && role !== 'owner') throw forbidden('You can only delete your own comments.');
    change(actor, c.board_id, log => { db.run('DELETE FROM comments WHERE id = ?', x.id); log('comment.delete', { card: c.title }, c.id); });
    return E.card(actor.uid, c.id);
  };
  E.addAttachment = function (actor, cardId, body) {
    const c = cardFor(cardId, actor.uid);
    body = body || {};
    fail(V.check(body, { url: 'attachmentUrl', title: 'attachmentTitle' }));
    const url = str(body.url);
    const title = str(body.title) || new URL(url).hostname.replace(/^www\./, '');
    change(actor, c.board_id, log => {
      db.run('INSERT INTO attachments (id, card_id, user_id, title, url, created_at) VALUES (?, ?, ?, ?, ?, ?)', rid('a'), c.id, actor.uid, title, url, now());
      log('attachment.add', { card: c.title, title }, c.id);
    });
    return E.card(actor.uid, c.id);
  };
  E.deleteAttachment = function (actor, attachmentId) {
    const x = db.get('SELECT * FROM attachments WHERE id = ?', String(attachmentId || ''));
    if (!x) throw notFound('Attachment');
    const c = cardFor(x.card_id, actor.uid);
    change(actor, c.board_id, log => { db.run('DELETE FROM attachments WHERE id = ?', x.id); log('attachment.delete', { card: c.title, title: x.title }, c.id); });
    return E.card(actor.uid, c.id);
  };

  // ——— Activity ———
  function activityRows(where, args, limit) {
    return db.all(`SELECT a.id, a.board_id AS boardId, a.card_id AS cardId, a.user_id AS userId, a.type, a.data, a.created_at AS at, u.name AS userName, u.color AS userColor
      FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`, ...args, limit)
      .map(r => { const d = JSON.parse(r.data || '{}'); return Object.assign(r, { data: undefined, excerpt: d.excerpt || undefined, text: activityText.describe(r.type, d) }); });
  }
  E.activity = function (uid, boardId, query) {
    const b = membership(boardId, uid);
    query = query || {};
    const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 30));
    const before = parseInt(query.before, 10);
    const rows = Number.isFinite(before) ? activityRows('a.board_id = ? AND a.id < ?', [b.id, before], limit + 1) : activityRows('a.board_id = ?', [b.id], limit + 1);
    return { activity: rows.slice(0, limit), more: rows.length > limit };
  };

  E.standup = async function (uid, boardId, query) {
    const b = membership(boardId, uid);
    const hours = Math.max(1, Math.min(168, parseInt((query || {}).hours, 10) || 24));
    return { report: await standup.report(b.id, { hours }) };
  };

  return E;
}

module.exports = { createEngine, UserError, hashPassword, verifyPassword, rid, AVATAR_COLORS };
