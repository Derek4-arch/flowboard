/* Flowboard AI Standup Mode: daily summary of a board's last N hours plus per-person focus scores.
   Works without any AI: the rule-based report below is always produced. When AI_API_KEY is configured,
   an OpenAI-compatible model rewrites the same facts into a richer narrative (see ai.js); on any AI
   failure the rule-based write-up is used and the reason is reported. */
'use strict';
const { activityText, markdown } = require('./shared');

const DONE_LIST = /^\s*(done|complete|completed|shipped|finished|closed|released)\b/i;
const ACTIVE_LIST = /(progress|doing|review|testing|\bqa\b|active|wip|develop)/i;
const BLOCKED_LABEL = /^\s*blocked\s*$/i;

/* Focus score (0–100). Starts at 100 and subtracts:
     8 points for every open assigned card beyond 3       (work in progress)
    15 points for every overdue open card                 (deadline pressure)
     5 points for every distinct card touched in the last
       24 h beyond 3                                      (context switching)
   Clamped to 0–100. ≥ 75 = Focused, 50–74 = Stretched, < 50 = Overloaded. */
const FOCUS = { freeOpen: 3, perOpen: 8, perOverdue: 15, freeSwitches: 3, perSwitch: 5 };
function focusScore({ open = 0, overdue = 0, switches = 0 }) {
  const raw = 100 - FOCUS.perOpen * Math.max(0, open - FOCUS.freeOpen) - FOCUS.perOverdue * overdue - FOCUS.perSwitch * Math.max(0, switches - FOCUS.freeSwitches);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, level: score >= 75 ? 'focused' : score >= 50 ? 'stretched' : 'overloaded', open, overdue, switches };
}
const LEVEL_TEXT = { focused: 'Focused', stretched: 'Stretched', overloaded: 'Overloaded' };

const pad = n => String(n).padStart(2, '0');
const localDate = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function createStandup({ db, config, ai, log }) {
  const S = { focusScore, FOCUS };
  S.isDoneList = name => DONE_LIST.test(String(name || ''));
  S.today = (t) => localDate(t || Date.now());

  // Loads everything the report and focus scores need for one board.
  function snapshot(boardId, since) {
    const board = db.get('SELECT id, name, color FROM boards WHERE id = ?', boardId);
    const lists = db.all('SELECT id, name, position FROM lists WHERE board_id = ? ORDER BY position', boardId);
    const listById = Object.fromEntries(lists.map(l => [l.id, l]));
    const labels = db.all('SELECT id, name, color FROM labels WHERE board_id = ?', boardId);
    const blockedLabels = new Set(labels.filter(l => BLOCKED_LABEL.test(l.name)).map(l => l.id));
    const members = db.all('SELECT u.id, u.name, u.color, m.role FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY m.joined_at', boardId);
    const today = S.today();
    const cl = db.all('SELECT cl.card_id, cl.label_id FROM card_labels cl JOIN cards c ON c.id = cl.card_id WHERE c.board_id = ?', boardId);
    const ca = db.all('SELECT ca.card_id, ca.user_id FROM card_assignees ca JOIN cards c ON c.id = ca.card_id WHERE c.board_id = ?', boardId);
    const cards = db.all('SELECT id, list_id, title, due_date, blocked, created_at FROM cards WHERE board_id = ? ORDER BY position', boardId).map(c => {
      const labelIds = cl.filter(x => x.card_id === c.id).map(x => x.label_id);
      const list = listById[c.list_id];
      const done = S.isDoneList(list && list.name);
      const overdueDays = c.due_date && !done && c.due_date < today ? daysBetween(c.due_date, today) : 0;
      return {
        id: c.id, title: c.title, listId: c.list_id, list: list ? list.name : '', due: c.due_date, done,
        blocked: !done && (!!c.blocked || labelIds.some(id => blockedLabels.has(id))),
        overdue: overdueDays > 0, overdueDays, dueToday: !done && c.due_date === today, active: !done && ACTIVE_LIST.test(list ? list.name : ''),
        labels: labelIds.map(id => (labels.find(l => l.id === id) || {}).name).filter(Boolean),
        assigneeIds: ca.filter(x => x.card_id === c.id).map(x => x.user_id)
      };
    });
    const activity = since == null ? [] : db.all(`SELECT a.id, a.card_id, a.user_id, a.type, a.data, a.created_at, u.name AS user_name
      FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.board_id = ? AND a.created_at >= ? ORDER BY a.created_at, a.id`, boardId, since)
      .map(a => Object.assign(a, { data: JSON.parse(a.data || '{}') }));
    return { board, lists, members, cards, activity, today };
  }

  // Focus score per board member, from their assigned open cards and the cards they touched in 24 h.
  S.focus = function (boardId, at) {
    const t = at || Date.now();
    const snap = snapshot(boardId, null);
    const touched = db.all('SELECT user_id, COUNT(DISTINCT card_id) AS n FROM activity WHERE board_id = ? AND created_at >= ? AND card_id IS NOT NULL GROUP BY user_id', boardId, t - 864e5);
    const sw = Object.fromEntries(touched.map(r => [r.user_id, r.n]));
    const out = {};
    snap.members.forEach(m => {
      const mine = snap.cards.filter(c => !c.done && c.assigneeIds.includes(m.id));
      out[m.id] = focusScore({ open: mine.length, overdue: mine.filter(c => c.overdue).length, switches: sw[m.id] || 0 });
    });
    return out;
  };

  // Builds the full standup report. Always succeeds; AI is optional on top.
  S.report = async function (boardId, opts) {
    const hours = (opts && opts.hours) || 24;
    const generatedAt = Date.now();
    const since = generatedAt - hours * 3600e3;
    const snap = snapshot(boardId, since);
    const nameOf = Object.fromEntries(snap.members.map(m => [m.id, m.name]));
    const cardById = Object.fromEntries(snap.cards.map(c => [c.id, c]));
    const ref = c => ({ id: c.id, title: c.title, list: c.list, due: c.due, overdueDays: c.overdueDays, dueToday: !!c.dueToday, labels: c.labels, assignees: c.assigneeIds.map(id => nameOf[id]).filter(Boolean), assigneeIds: c.assigneeIds });

    const acts = snap.activity;
    const touched = new Set(acts.filter(a => a.card_id).map(a => a.card_id));
    const moves = acts.filter(a => a.type === 'card.move' && a.data.from !== a.data.to)
      .map(a => ({ cardId: a.card_id, card: a.data.card, from: a.data.from, to: a.data.to, by: a.user_name || 'Someone', byId: a.user_id, at: a.created_at }));
    const finishedBy = {};
    acts.forEach(a => {
      if ((a.type === 'card.move' && S.isDoneList(a.data.to) && !S.isDoneList(a.data.from)) || (a.type === 'card.create' && S.isDoneList(a.data.list))) finishedBy[a.card_id] = a.user_id;
    });
    const done = snap.cards.filter(c => c.done && finishedBy[c.id] !== undefined);
    const blocked = snap.cards.filter(c => c.blocked);
    const overdue = snap.cards.filter(c => c.overdue).sort((a, b) => b.overdueDays - a.overdueDays);
    const dueToday = snap.cards.filter(c => c.dueToday);
    const inProgress = snap.cards.filter(c => !c.done && !c.blocked && (c.active || touched.has(c.id)));

    const focus = S.focus(boardId, generatedAt);
    const people = snap.members.map(m => {
      const mine = c => c.assigneeIds.includes(m.id);
      const highlights = acts.filter(a => a.user_id === m.id).slice(-6).reverse().map(a => activityText.describe(a.type, a.data));
      return {
        id: m.id, name: m.name, color: m.color, focus: focus[m.id],
        done: done.filter(c => mine(c) || finishedBy[c.id] === m.id).map(ref),
        inProgress: inProgress.filter(mine).map(ref), blocked: blocked.filter(mine).map(ref), overdue: overdue.filter(mine).map(ref),
        updates: acts.filter(a => a.user_id === m.id).length, highlights
      };
    });
    const needsOwner = snap.cards.filter(c => (c.blocked || c.overdue) && !c.assigneeIds.length).map(ref);
    const stats = {
      updates: acts.length, moved: moves.length, done: done.length, inProgress: inProgress.length, blocked: blocked.length, overdue: overdue.length, dueToday: dueToday.length,
      created: acts.filter(a => a.type === 'card.create').length, comments: acts.filter(a => a.type === 'comment.add').length,
      checklist: acts.filter(a => a.type === 'checklist.check').length
    };
    const report = {
      board: { id: snap.board.id, name: snap.board.name }, generatedAt, hours, today: snap.today,
      mode: 'rules', ai: { configured: !!(ai && ai.configured()), model: ai && ai.configured() ? config.ai.model : null, error: null },
      stats, done: done.map(ref), inProgress: inProgress.map(ref), blocked: blocked.map(ref), overdue: overdue.map(ref), dueToday: dueToday.map(ref), moves, people, needsOwner,
      narrative: null, focusFormula: 'Score = 100 − 8 × (open cards beyond 3) − 15 × overdue cards − 5 × (cards touched in 24 h beyond 3), clamped to 0–100.'
    };
    if (ai && ai.configured()) {
      try {
        report.narrative = await ai.writeStandup(report);
        report.mode = 'ai';
      } catch (e) {
        report.ai.error = e.message || String(e);
        if (log) log.warn(`AI standup failed (${report.ai.error}); using the rule-based summary.`);
      }
    }
    report.markdown = toMarkdown(report);
    report.slack = toSlack(report);
    report.html = report.narrative ? markdown.render(report.narrative) : null;
    return report;
  };
  return S;
}

// ——— Text output ———
const fmtDate = d => activityText.fmtDate(d);
function longDate(t) { const d = new Date(t); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${activityText.MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
const who = r => (r.assignees.length ? r.assignees.join(', ') : 'unassigned');
const dueText = r => (r.dueToday ? 'due today' : r.overdueDays ? `due ${fmtDate(r.due)}, ${r.overdueDays} day${r.overdueDays === 1 ? '' : 's'} overdue` : r.due ? `due ${fmtDate(r.due)}` : '');
const lineFor = (r, extra) => [r.title, extra].filter(Boolean).join(' — ');

function toMarkdown(rep) {
  const L = [];
  L.push(`# Standup: ${rep.board.name}`);
  L.push(`_${longDate(rep.generatedAt)} · last ${rep.hours} hours · ${rep.mode === 'ai' ? `AI write-up (${rep.ai.model})` : 'rule-based summary'} · Flowboard_`, '');
  L.push(`**At a glance:** ${rep.stats.done} done · ${rep.stats.inProgress} in progress · ${rep.stats.blocked} blocked · ${rep.stats.overdue} overdue · ${rep.stats.updates} updates`, '');
  if (rep.narrative) {
    L.push(rep.narrative.trim(), '');
  } else {
    const section = (title, rows, fmt) => { L.push(`## ${title}`); if (!rows.length) L.push('- Nothing to report.'); rows.forEach(r => L.push(`- ${fmt(r)}`)); L.push(''); };
    section('Done', rep.done, r => lineFor(r, who(r)));
    section('In progress', rep.inProgress, r => lineFor(r, [r.list, who(r), dueText(r)].filter(Boolean).join(' · ')));
    section('Blocked', rep.blocked, r => lineFor(r, [who(r), dueText(r)].filter(Boolean).join(' · ')));
    section('Overdue', rep.overdue, r => lineFor(r, [dueText(r), who(r)].join(' · ')));
    if (rep.dueToday.length) section('Due today', rep.dueToday, r => lineFor(r, [r.list, who(r)].join(' · ')));
    if (rep.moves.length) { L.push('## What moved'); rep.moves.slice(-12).forEach(m => L.push(`- ${m.card}: ${m.from} → ${m.to} (${m.by})`)); L.push(''); }
    if (rep.needsOwner.length) { L.push('## Needs an owner'); rep.needsOwner.forEach(r => L.push(`- ${lineFor(r, r.overdueDays ? dueText(r) : 'blocked')}`)); L.push(''); }
  }
  L.push('## By person');
  rep.people.forEach(p => {
    L.push(`### ${p.name} — focus ${p.focus.score}/100 (${LEVEL_TEXT[p.focus.level]})`);
    L.push(`_${p.focus.open} open card${p.focus.open === 1 ? '' : 's'} · ${p.focus.overdue} overdue · ${p.focus.switches} card${p.focus.switches === 1 ? '' : 's'} touched in 24 h_`);
    const part = (label, rows) => { if (rows.length) L.push(`- **${label}:** ${rows.map(r => r.title).join('; ')}`); };
    part('Done', p.done); part('Working on', p.inProgress); part('Blocked', p.blocked); part('Overdue', p.overdue);
    if (!p.done.length && !p.inProgress.length && !p.blocked.length && !p.overdue.length) L.push('- No assigned work in progress.');
    L.push('');
  });
  L.push(`_Focus score: ${rep.focusFormula}_`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Slack mrkdwn: *bold*, _italic_, • bullets. Markdown emphasis from the AI narrative is converted.
function toSlack(rep) {
  const L = [];
  L.push(`*Standup: ${rep.board.name}* (${longDate(rep.generatedAt)}, last ${rep.hours}h)`);
  L.push(`${rep.stats.done} done · ${rep.stats.inProgress} in progress · ${rep.stats.blocked} blocked · ${rep.stats.overdue} overdue`);
  L.push('');
  if (rep.narrative) {
    L.push(rep.narrative.trim()
      .replace(/^#{1,6}\s+(.*)$/gm, '*$1*')
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<$2|$1>'));
    L.push('');
  } else {
    const section = (emoji, title, rows, fmt) => { if (!rows.length) return; L.push(`${emoji} *${title}*`); rows.forEach(r => L.push(`• ${fmt(r)}`)); L.push(''); };
    section(':white_check_mark:', 'Done', rep.done, r => lineFor(r, who(r)));
    section(':arrows_counterclockwise:', 'In progress', rep.inProgress, r => lineFor(r, [who(r), dueText(r)].filter(Boolean).join(' · ')));
    section(':no_entry:', 'Blocked', rep.blocked, r => lineFor(r, who(r)));
    section(':alarm_clock:', 'Overdue', rep.overdue, r => lineFor(r, [dueText(r), who(r)].join(' · ')));
    section(':calendar:', 'Due today', rep.dueToday, r => lineFor(r, who(r)));
    if (!rep.done.length && !rep.inProgress.length && !rep.blocked.length && !rep.overdue.length) { L.push('Quiet day: nothing moved, nothing blocked.'); L.push(''); }
  }
  L.push('*Focus scores*');
  rep.people.forEach(p => L.push(`• ${p.name}: ${p.focus.score}/100 (${LEVEL_TEXT[p.focus.level]}) · ${p.focus.open} open, ${p.focus.overdue} overdue`));
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { createStandup, focusScore, FOCUS, DONE_LIST, ACTIVE_LIST, toMarkdown, toSlack };
