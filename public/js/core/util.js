/* Flowboard: small DOM, formatting and event helpers (window.FB.util and FB.on/FB.emit). */
(function (FB) {
  'use strict';
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const U = {};
  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  U.debounce = (fn, ms) => { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
  U.reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  U.clientId = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // Tiny event bus.
  const handlers = {};
  FB.on = (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); return () => { handlers[evt] = handlers[evt].filter(f => f !== fn); }; };
  FB.emit = (evt, data) => (handlers[evt] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

  U.initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  U.avatar = (user, cls, extra) => user
    ? `<span class="avatar ${cls || ''}" style="--av:${U.esc(user.color || '#667085')}" title="${U.esc(user.name)}" aria-label="${U.esc(user.name)}">${U.esc(U.initials(user.name))}${extra || ''}</span>`
    : '';

  const pad = n => String(n).padStart(2, '0');
  U.todayStr = (d) => { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  U.addDays = (dateStr, n) => { const [y, m, d] = dateStr.split('-').map(Number); const t = new Date(y, m - 1, d + n); return U.todayStr(t); };
  U.fmtDate = d => FB.activityText.fmtDate(d);
  U.shortDate = d => { if (!d) return ''; const [y, m, day] = d.split('-').map(Number); const s = `${day} ${FB.activityText.MONTHS[m - 1]}`; return y === new Date().getFullYear() ? s : `${s} ${y}`; };
  // Due-date presentation relative to today: { text, cls } where cls is overdue | today | done | ''.
  U.dueInfo = (due, isDone) => {
    if (!due) return null;
    const today = U.todayStr();
    if (isDone) return { text: U.shortDate(due), cls: 'done' };
    if (due < today) return { text: U.shortDate(due), cls: 'overdue', label: 'Overdue' };
    if (due === today) return { text: 'Today', cls: 'today', label: 'Due today' };
    if (due === U.addDays(today, 1)) return { text: 'Tomorrow', cls: '' };
    return { text: U.shortDate(due), cls: '' };
  };
  U.relTime = ts => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
    if (s < 172800) return 'yesterday';
    const d = new Date(ts);
    return `${d.getDate()} ${FB.activityText.MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
  };
  U.fullTime = ts => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  U.autosize = ta => { if (!ta) return; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };

  U.copyText = async text => {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  };
  U.download = (filename, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  U.slug = s => String(s || 'board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'board';
  U.host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

  FB.util = U;
})(window.FB = window.FB || {});
