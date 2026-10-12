/* Demo data created on first run (only when the database has no users). Disable with SEED=0.
   Demo accounts (password for all three: flowboard123):
     maya@example.com   Maya Chen    owner of both demo boards
     sam@example.com    Sam Rivera
     priya@example.com  Priya Patel
   Activity is back-dated over the last few days so Standup Mode has something to summarise. */
'use strict';
const { hashPassword, rid, AVATAR_COLORS } = require('./engine');

const DEMO_PASSWORD = 'flowboard123';
const USERS = [
  { key: 'maya', name: 'Maya Chen', email: 'maya@example.com' },
  { key: 'sam', name: 'Sam Rivera', email: 'sam@example.com' },
  { key: 'priya', name: 'Priya Patel', email: 'priya@example.com' }
];
const pad = n => String(n).padStart(2, '0');
const dayOffset = (n, base) => { const d = new Date(base); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const H = 3600e3, D = 864e5;

function seed(db, log) {
  if (db.get('SELECT COUNT(*) AS n FROM users').n > 0) return false;
  const T = Date.now();
  const U = {};
  db.tx(() => {
    USERS.forEach((u, i) => {
      U[u.key] = rid('u');
      db.run('INSERT INTO users (id, email, name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)', U[u.key], u.email, u.name, hashPassword(DEMO_PASSWORD), AVATAR_COLORS[i], T - 9 * D);
    });
    buildLaunchBoard(db, U, T);
    buildPlanningBoard(db, U, T);
  });
  if (log) log.info(`Created demo data: users ${USERS.map(u => u.email).join(', ')} (password: ${DEMO_PASSWORD}).`);
  return true;
}

function boardKit(db, boardId, T) {
  const act = (userId, type, data, at, cardId) => db.run('INSERT INTO activity (board_id, card_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)', boardId, cardId || null, userId, type, JSON.stringify(data || {}), at);
  const lists = {}, labels = {};
  const list = (name, pos, by, at) => { const id = rid('L'); lists[name] = id; db.run('INSERT INTO lists (id, board_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)', id, boardId, name, pos, at); act(by, 'list.create', { list: name }, at); return id; };
  const label = (name, color) => { const id = rid('l'); labels[name] = id; db.run('INSERT INTO labels (id, board_id, name, color) VALUES (?, ?, ?, ?)', id, boardId, name, color); };
  const pos = {};
  const card = (c) => {
    const id = rid('c');
    const listName = c.list;
    pos[listName] = (pos[listName] || 0);
    const created = c.created || T - 6 * D;
    db.run('INSERT INTO cards (id, board_id, list_id, title, description, position, due_date, blocked, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, boardId, lists[listName], c.title, c.desc || '', pos[listName]++, c.due == null ? null : dayOffset(c.due, T), c.blocked ? 1 : 0, c.by, created, c.updated || created);
    act(c.by, 'card.create', { card: c.title, list: c.createdIn || listName }, created, id);
    (c.labels || []).forEach(l => db.run('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)', id, labels[l]));
    (c.assignees || []).forEach(u => db.run('INSERT INTO card_assignees (card_id, user_id) VALUES (?, ?)', id, u));
    (c.checklist || []).forEach(([text, done], i) => db.run('INSERT INTO checklist_items (id, card_id, text, done, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', rid('i'), id, text, done ? 1 : 0, i, created + 60e3));
    (c.comments || []).forEach(([u, body, ago]) => {
      db.run('INSERT INTO comments (id, card_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', rid('m'), id, u, body, T - ago);
      act(u, 'comment.add', { card: c.title, excerpt: body.slice(0, 140) }, T - ago, id);
    });
    (c.links || []).forEach(([title, url, u]) => db.run('INSERT INTO attachments (id, card_id, user_id, title, url, created_at) VALUES (?, ?, ?, ?, ?, ?)', rid('a'), id, u, title, url, created + 120e3));
    (c.events || []).forEach(([u, type, data, ago]) => act(u, type, Object.assign({ card: c.title }, data), T - ago, id));
    return id;
  };
  return { act, list, label, card, lists, labels };
}

function buildLaunchBoard(db, U, T) {
  const id = rid('b');
  const created = T - 8 * D;
  db.run("INSERT INTO boards (id, name, color, owner_id, version, created_at, updated_at) VALUES (?, 'Website relaunch', 'indigo', ?, 1, ?, ?)", id, U.maya, created, T - 20 * 60e3);
  db.run("INSERT INTO board_members (board_id, user_id, role, starred, joined_at) VALUES (?, ?, 'owner', 1, ?)", id, U.maya, created);
  db.run("INSERT INTO board_members (board_id, user_id, role, starred, joined_at) VALUES (?, ?, 'member', 1, ?)", id, U.sam, created + 60e3);
  db.run("INSERT INTO board_members (board_id, user_id, role, starred, joined_at) VALUES (?, ?, 'member', 0, ?)", id, U.priya, created + 120e3);
  const k = boardKit(db, id, T);
  k.act(U.maya, 'board.create', {}, created);
  k.act(U.maya, 'member.add', { member: 'Sam Rivera' }, created + 60e3);
  k.act(U.maya, 'member.add', { member: 'Priya Patel' }, created + 120e3);
  ['Backlog', 'To do', 'In progress', 'Review', 'Done'].forEach((n, i) => k.list(n, i, U.maya, created + 180e3 + i * 1000));
  [['Blocked', 'red'], ['Bug', 'orange'], ['Feature', 'green'], ['Design', 'purple'], ['Research', 'sky'], ['Content', 'yellow']].forEach(([n, c]) => k.label(n, c));
  const mv = (from, to) => ({ from, to });

  // Backlog
  k.card({ list: 'Backlog', title: 'Explore dark mode for marketing pages', labels: ['Research'], assignees: [U.priya], by: U.priya,
    desc: 'Check whether a dark variant of the marketing site is worth it.\n\n- Usage data from the app (how many people use dark mode?)\n- Brand colours in dark\n- Effort estimate' });
  k.card({ list: 'Backlog', title: 'Localise pricing page (DE, FR)', labels: ['Content', 'Feature'], due: 14, by: U.maya, desc: 'Translations come from the agency. We need **currency formatting** and a language switcher.' });
  k.card({ list: 'Backlog', title: 'Audit third-party scripts for page weight', labels: ['Research'], assignees: [U.sam], by: U.sam,
    events: [[U.sam, 'card.desc', {}, 9 * H]], desc: 'List every tag in GTM and its transfer size. Remove anything unused.' });

  // To do
  k.card({ list: 'To do', title: 'Write launch announcement blog post', labels: ['Content'], assignees: [U.maya], due: 3, by: U.maya,
    checklist: [['Outline and key messages', true], ['First draft', false], ['Review with Sam', false], ['Pick hero image', false]],
    desc: '## Goal\nAnnounce the new site and explain **why** we rebuilt it.\n\n## Audience\nExisting customers and newsletter subscribers.\n\n> Keep it under 800 words.' });
  k.card({ list: 'To do', title: 'Set up 301 redirects from old URLs', labels: ['Feature'], assignees: [U.sam], due: -2, by: U.sam,
    checklist: [['Export old sitemap', true], ['Map old → new URLs', true], ['Add redirect rules', false], ['Test top 50 pages', false], ['Monitor 404s for a week', false]],
    desc: 'Every old URL needs a permanent redirect so we keep search rankings.\n\nSitemap export: see attachment.',
    links: [['Old sitemap (sheet)', 'https://docs.google.com/spreadsheets/', U.sam]],
    comments: [[U.maya, 'This is past due. Anything blocking you, Sam?', 6 * H], [U.sam, 'Mapping is done; rules go in tomorrow morning.', 5.5 * H]],
    events: [[U.sam, 'checklist.check', { item: 'Map old → new URLs' }, 11 * H]] });
  k.card({ list: 'To do', title: 'Cookie consent banner copy', labels: ['Content', 'Blocked'], assignees: [U.priya], due: 1, by: U.priya,
    desc: 'Banner text and the settings dialog. Needs sign-off from legal before we ship.',
    comments: [[U.priya, 'Waiting on legal to approve the wording. Pinged them again today.', 7 * H]],
    events: [[U.priya, 'card.label', { label: 'Blocked' }, 7.2 * H]] });
  k.card({ list: 'To do', title: 'Accessibility pass on navigation', labels: ['Bug'], assignees: [U.priya, U.maya], due: 6, by: U.maya,
    checklist: [['Keyboard order', false], ['Visible focus states', false], ['Screen reader labels', false]] });

  // In progress
  k.card({ list: 'In progress', createdIn: 'To do', title: 'New homepage hero and illustrations', labels: ['Design'], assignees: [U.priya], due: 2, by: U.priya,
    checklist: [['Moodboard', true], ['Three hero concepts', true], ['Final illustration set', true], ['Export SVGs for dev', false]],
    desc: '### Brief\nA calm, confident hero. One headline, one supporting line, one **primary** call to action.\n\n- Illustration style: soft shapes, two accent colours\n- Must work at 390px wide\n\nFigma: https://www.figma.com/',
    links: [['Hero concepts (Figma)', 'https://www.figma.com/', U.priya], ['Illustration licence', 'https://www.example.com/licence', U.priya]],
    comments: [[U.maya, 'Concept B is the one. Love the soft shapes.', 15 * H], [U.priya, 'Final set is done, exporting SVGs tomorrow.', 3 * H]],
    events: [[U.priya, 'card.move', mv('To do', 'In progress'), 16 * H], [U.priya, 'checklist.check', { item: 'Final illustration set' }, 3.2 * H]] });
  k.card({ list: 'In progress', createdIn: 'To do', title: 'Pricing page: annual billing toggle', labels: ['Feature'], assignees: [U.sam], due: -1, by: U.maya,
    desc: 'Monthly / annual switch. Annual shows **2 months free**. Prices come from the billing API.',
    comments: [[U.sam, 'Toggle works; waiting for final annual prices from finance.', 4 * H]],
    events: [[U.sam, 'card.move', mv('To do', 'In progress'), 18 * H], [U.sam, 'card.due', { due: dayOffset(-1, T) }, 17 * H]] });
  k.card({ list: 'In progress', createdIn: 'To do', title: 'Contact form spam protection', labels: ['Bug', 'Blocked'], assignees: [U.sam], due: 1, blocked: true, by: U.sam,
    desc: 'Add a honeypot field and rate limiting. Captcha only as a last resort.',
    comments: [[U.sam, 'Blocked: need the API key for the spam-check service from ops.', 5 * H]],
    events: [[U.sam, 'card.move', mv('To do', 'In progress'), 20 * H], [U.sam, 'card.block', {}, 5 * H]] });
  k.card({ list: 'In progress', title: 'Performance budget: LCP under 2.5s', labels: ['Research'], assignees: [U.maya], by: U.maya,
    checklist: [['Baseline with Lighthouse', true], ['Image formats (AVIF/WebP)', false], ['Font loading strategy', false]],
    events: [[U.maya, 'checklist.check', { item: 'Baseline with Lighthouse' }, 8 * H]] });

  // Review
  k.card({ list: 'Review', createdIn: 'To do', title: 'Customer stories page', labels: ['Content', 'Design'], assignees: [U.maya], due: 0, by: U.maya,
    desc: 'Three stories with quotes and logos (permission confirmed for all three).',
    events: [[U.maya, 'card.move', mv('In progress', 'Review'), 2 * H]] });
  k.card({ list: 'Review', createdIn: 'In progress', title: 'Fix mobile menu focus trap', labels: ['Bug'], assignees: [U.priya], by: U.sam,
    desc: 'Focus escapes the open menu on iOS VoiceOver. Repro: open menu, swipe right past the last link.',
    events: [[U.priya, 'card.assign', { member: 'Priya Patel', self: true }, 10 * H], [U.priya, 'card.move', mv('In progress', 'Review'), 1 * H]] });

  // Done
  k.card({ list: 'Done', createdIn: 'Review', title: 'Choose analytics provider', labels: ['Research'], assignees: [U.maya], by: U.maya,
    desc: 'Decision: privacy-friendly, cookie-less analytics. Notes in the doc.',
    links: [['Comparison doc', 'https://docs.google.com/document/', U.maya]],
    events: [[U.maya, 'card.move', mv('Review', 'Done'), 3 * H]] });
  k.card({ list: 'Done', createdIn: 'Review', title: 'Design system tokens v2', labels: ['Design'], assignees: [U.priya], by: U.priya,
    events: [[U.priya, 'card.move', mv('Review', 'Done'), 20 * H]] });
  k.card({ list: 'Done', createdIn: 'In progress', title: 'Migrate blog to new CMS', labels: ['Feature'], assignees: [U.sam], by: U.sam,
    events: [[U.sam, 'card.move', mv('In progress', 'Done'), 2 * D + 3 * H]] });
  db.run('UPDATE boards SET version = 2 WHERE id = ?', id);
}

function buildPlanningBoard(db, U, T) {
  const id = rid('b');
  const created = T - 5 * D;
  db.run("INSERT INTO boards (id, name, color, owner_id, version, created_at, updated_at) VALUES (?, 'Q4 planning', 'teal', ?, 1, ?, ?)", id, U.maya, created, T - 2 * D);
  db.run("INSERT INTO board_members (board_id, user_id, role, starred, joined_at) VALUES (?, ?, 'owner', 0, ?)", id, U.maya, created);
  db.run("INSERT INTO board_members (board_id, user_id, role, starred, joined_at) VALUES (?, ?, 'member', 0, ?)", id, U.sam, created);
  const k = boardKit(db, id, T);
  k.act(U.maya, 'board.create', {}, created);
  ['Ideas', 'This quarter', 'Done'].forEach((n, i) => k.list(n, i, U.maya, created + i * 1000));
  [['Blocked', 'red'], ['Goal', 'green'], ['Hiring', 'blue']].forEach(([n, c]) => k.label(n, c));
  k.card({ list: 'Ideas', title: 'Customer advisory board', by: U.maya, created: created + 3600e3 });
  k.card({ list: 'This quarter', title: 'Hire a second product designer', labels: ['Hiring'], assignees: [U.maya], due: 30, by: U.maya, created: created + 3600e3,
    checklist: [['Job description', true], ['Portfolio review rubric', false]] });
  k.card({ list: 'This quarter', title: 'Ship the new website', labels: ['Goal'], assignees: [U.maya, U.sam], due: 21, by: U.maya, created: created + 3600e3 });
  k.card({ list: 'Done', title: 'Set Q4 OKRs', labels: ['Goal'], assignees: [U.maya], by: U.maya, created: created + 3600e3 });
}

module.exports = { seed, DEMO_PASSWORD, USERS };
