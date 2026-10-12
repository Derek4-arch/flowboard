/* Unit tests: safe Markdown, shared validation, focus score, activity sentences and standup text output. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const md = require('../public/js/shared/markdown.js');
const V = require('../public/js/shared/validate.js');
const activityText = require('../public/js/shared/activity-text.js');
const { focusScore, FOCUS, toMarkdown, toSlack, DONE_LIST } = require('../server/standup.js');

test('markdown escapes raw HTML and drops dangerous links', () => {
  const out = md.render('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) [ok](https://example.com/a?b="c")');
  assert.ok(!out.includes('<script'), out);
  assert.ok(!out.includes('<img'), out);
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(!/href="javascript:/i.test(out), out);
  assert.ok(out.includes('href="https://example.com/a?b=&quot;c&quot;"'), out);
  assert.ok(/rel="noopener noreferrer nofollow"/.test(out) || /rel="noopener noreferrer"/.test(out), out);
});

test('markdown renders the supported subset', () => {
  const out = md.render('# Title\n\n**bold** _it_ `code`\n\n- a\n- b\n\n1. one\n\n> quote\n\n- [x] done task\n\n```\n<b>raw</b>\n```');
  assert.match(out, /<h3>Title<\/h3>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<em>it<\/em>/);
  assert.match(out, /<code>code<\/code>/);
  assert.match(out, /<ul>/);
  assert.match(out, /<ol>/);
  assert.match(out, /<blockquote>/);
  assert.match(out, /checked/);
  assert.match(out, /&lt;b&gt;raw&lt;\/b&gt;/);
});

test('markdown cannot break out of attributes or inject event handlers', () => {
  const evil = [
    '[x](https://a.com/" onmouseover="alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](  JaVaScRiPt:alert(1))',
    '<a href="javascript:alert(1)">x</a>',
    '**<svg/onload=alert(1)>**'
  ];
  evil.forEach(src => {
    const out = md.render(src);
    assert.ok(!/<a [^>]*on\w+=/i.test(out), out);
    assert.ok(!/<svg/i.test(out), out);
    assert.ok(!/href="(javascript|data):/i.test(out), out);
  });
});

test('validation rules give friendly inline messages', () => {
  assert.equal(V.rules.email('nope'), 'Enter a valid email address, like name@example.com.');
  assert.equal(V.rules.email('a@b.co'), '');
  assert.equal(V.rules.password('short'), 'Use at least 8 characters.');
  assert.equal(V.rules.cardTitle('   '), 'Enter a card title.');
  assert.equal(V.rules.due('2026-02-30'), 'Enter a valid date.');
  assert.equal(V.rules.due(''), '');
  assert.equal(V.rules.attachmentUrl('javascript:alert(1)'), 'Enter a full http:// or https:// link.');
  assert.equal(V.rules.attachmentUrl('https://figma.com/file/1'), '');
  assert.deepEqual(V.check({ name: '', email: 'x' }, { name: 'name', email: 'email' }), { name: 'Enter your name.', email: 'Enter a valid email address, like name@example.com.' });
});

test('focus score formula', () => {
  assert.deepEqual(FOCUS, { freeOpen: 3, perOpen: 8, perOverdue: 15, freeSwitches: 3, perSwitch: 5 });
  assert.equal(focusScore({ open: 0, overdue: 0, switches: 0 }).score, 100);
  assert.equal(focusScore({ open: 3, overdue: 0, switches: 3 }).score, 100);
  assert.equal(focusScore({ open: 5, overdue: 1, switches: 6 }).score, 100 - 16 - 15 - 15);
  assert.equal(focusScore({ open: 5, overdue: 1, switches: 6 }).level, 'stretched');
  assert.equal(focusScore({ open: 4, overdue: 0, switches: 4 }).level, 'focused');
  assert.equal(focusScore({ open: 12, overdue: 4, switches: 20 }).score, 0);
  assert.equal(focusScore({ open: 12, overdue: 4, switches: 20 }).level, 'overloaded');
});

test('done-list detection', () => {
  ['Done', 'done ✅', 'Completed', 'Shipped this week', 'Released'].forEach(n => assert.ok(DONE_LIST.test(n), n));
  ['To do', 'Undone', 'In progress', 'Not done'].forEach(n => assert.ok(!DONE_LIST.test(n), n));
});

test('activity sentences', () => {
  assert.equal(activityText.describe('card.move', { card: 'A', from: 'To do', to: 'Done' }), 'moved “A” from To do to Done');
  assert.equal(activityText.describe('card.due', { card: 'A', due: '2026-10-07' }), 'set the due date of “A” to 7 Oct 2026');
  assert.equal(activityText.describe('unknown.type', {}), 'made a change');
});

test('standup Markdown and Slack text', () => {
  const ref = (title, extra) => Object.assign({ id: title, title, list: 'In progress', due: null, overdueDays: 0, dueToday: false, labels: [], assignees: ['Ana'], assigneeIds: ['u1'] }, extra);
  const rep = {
    board: { id: 'b', name: 'Demo' }, generatedAt: Date.UTC(2026, 9, 7, 9), hours: 24, today: '2026-10-07', mode: 'rules', ai: { configured: false, model: null, error: null },
    stats: { updates: 3, moved: 1, done: 1, inProgress: 1, blocked: 1, overdue: 1, dueToday: 1, created: 0, comments: 0, checklist: 0 },
    done: [ref('Ship it')], inProgress: [ref('Build it')], blocked: [ref('Wait on legal', { assignees: [] })], overdue: [ref('Late thing', { due: '2026-10-05', overdueDays: 2 })],
    dueToday: [ref('Today thing', { due: '2026-10-07', dueToday: true })],
    moves: [{ card: 'Ship it', from: 'Review', to: 'Done', by: 'Ana' }], needsOwner: [ref('Wait on legal', { assignees: [] })],
    people: [{ id: 'u1', name: 'Ana', focus: focusScore({ open: 5, overdue: 1, switches: 2 }), done: [ref('Ship it')], inProgress: [ref('Build it')], blocked: [], overdue: [ref('Late thing')], updates: 3, highlights: [] }],
    narrative: null, focusFormula: 'formula'
  };
  const m = toMarkdown(rep);
  assert.match(m, /^# Standup: Demo/);
  assert.match(m, /## Done\n- Ship it — Ana/);
  assert.match(m, /## Blocked\n- Wait on legal — unassigned/);
  assert.match(m, /Late thing — due 5 Oct 2026, 2 days overdue · Ana/);
  assert.match(m, /## Due today\n- Today thing/);
  assert.match(m, /### Ana — focus 69\/100 \(Stretched\)/);
  const s = toSlack(rep);
  assert.match(s, /^\*Standup: Demo\*/);
  assert.match(s, /:no_entry: \*Blocked\*\n• Wait on legal — unassigned/);
  assert.match(s, /• Ana: 69\/100 \(Stretched\)/);
  assert.ok(!s.includes('**'));
});

test('passwords are stored as salted scrypt hashes', () => {
  const { hashPassword, verifyPassword } = require('../server/engine.js');
  const a = hashPassword('flowboard123'), b = hashPassword('flowboard123');
  assert.match(a, /^scrypt\$/);
  assert.notEqual(a, b, 'each hash has its own salt');
  assert.ok(!a.includes('flowboard123'));
  assert.equal(verifyPassword('flowboard123', a), true);
  assert.equal(verifyPassword('wrong-password', a), false);
});
