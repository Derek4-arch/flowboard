/* Flowboard shared validation rules and constants.
   Loaded by the browser (window.FB.validate) and by the server (require). Each rule returns '' when the
   value is valid, otherwise a human-readable message suitable for inline form errors. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.FB = root.FB || {}; root.FB.validate = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BOARD_COLORS = ['indigo', 'blue', 'teal', 'green', 'amber', 'rose', 'violet', 'slate'];
  const LABEL_COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'pink', 'slate'];
  const str = v => (v == null ? '' : String(v));
  const len = (v, min, max, what) => {
    const s = str(v).trim();
    if (s.length < min) return min === 1 ? `Enter ${what}.` : `${cap(what)} must be at least ${min} characters.`;
    if (s.length > max) return `${cap(what)} must be ${max} characters or fewer.`;
    return '';
  };
  const cap = s => s.replace(/^(a |an |the )/, '').replace(/^./, c => c.toUpperCase());
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function isDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(v))) return false;
    const [y, m, d] = str(v).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
  }
  function safeUrl(v) {
    const s = str(v).trim();
    if (!/^https?:\/\//i.test(s)) return false;
    try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname; } catch (e) { return false; }
  }

  const rules = {
    name: v => len(v, 1, 60, 'your name'),
    email: v => { const s = str(v).trim(); if (!s) return 'Enter your email address.'; if (s.length > 254 || !EMAIL.test(s)) return 'Enter a valid email address, like name@example.com.'; return ''; },
    password: v => { const s = str(v); if (!s) return 'Enter a password.'; if (s.length < 8) return 'Use at least 8 characters.'; if (s.length > 200) return 'Use 200 characters or fewer.'; return ''; },
    signinPassword: v => (str(v) ? '' : 'Enter your password.'),
    boardName: v => len(v, 1, 80, 'a board name'),
    boardColor: v => (BOARD_COLORS.includes(v) ? '' : 'Choose a background colour.'),
    listName: v => len(v, 1, 60, 'a list name'),
    cardTitle: v => len(v, 1, 200, 'a card title'),
    description: v => (str(v).length > 20000 ? 'The description must be 20,000 characters or fewer.' : ''),
    comment: v => len(v, 1, 5000, 'a comment'),
    checklistText: v => len(v, 1, 300, 'an item'),
    labelName: v => len(v, 1, 30, 'a label name'),
    labelColor: v => (LABEL_COLORS.includes(v) ? '' : 'Choose a label colour.'),
    due: v => (v == null || v === '' || isDate(v) ? '' : 'Enter a valid date.'),
    attachmentTitle: v => (str(v).trim().length > 120 ? 'The title must be 120 characters or fewer.' : ''),
    attachmentUrl: v => { const s = str(v).trim(); if (!s) return 'Enter a link.'; if (s.length > 2000) return 'The link is too long.'; return safeUrl(s) ? '' : 'Enter a full http:// or https:// link.'; }
  };

  // Validate several fields at once: returns { field: message } for the failures (empty object = valid).
  function check(values, map) {
    const out = {};
    Object.keys(map).forEach(field => { const msg = rules[map[field]](values[field]); if (msg) out[field] = msg; });
    return out;
  }

  return { rules, check, isDate, safeUrl, BOARD_COLORS, LABEL_COLORS };
});
