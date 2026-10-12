/* Flowboard AI Standup panel: last-24h summary (done / in progress / blocked / overdue / due today), per-person
   sections with focus-score gauges, AI or rule-based write-up, "Copy as Slack message" and "Export as Markdown". */
(function (FB) {
  'use strict';
  const { esc } = FB.util;
  const V = FB.views = FB.views || {};
  const LEVEL = { focused: 'Focused', stretched: 'Stretched', overloaded: 'Overloaded' };
  const C = 2 * Math.PI * 20;
  let panel = null, boardId = null, report = null, hours = 24, off = null, opener = null, stale = false, seq = 0;

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const names = r => (r.assignees.length ? r.assignees.join(', ') : 'Unassigned');
  const dueLine = r => r.overdueDays ? `<span class="d bad">${plural(r.overdueDays, 'day')} overdue</span>` : r.dueToday ? '<span class="d bad">Due today</span>' : r.due ? `<span class="d">Due ${esc(FB.util.shortDate(r.due))}</span>` : '';

  function gauge(f) {
    return `<div class="gauge ${f.level}" role="img" aria-label="Focus score ${f.score} out of 100, ${LEVEL[f.level]}"><svg viewBox="0 0 46 46" aria-hidden="true"><circle class="track" cx="23" cy="23" r="20"/><circle class="val" cx="23" cy="23" r="20" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - f.score / 100)).toFixed(2)}"/></svg><b>${f.score}</b></div>`;
  }
  function section(title, rows, extra, key) {
    return `<div class="su-section" data-su="${key}"><h3>${esc(title)} <span class="n">${rows.length}</span></h3>${rows.length
      ? rows.map(r => `<button type="button" class="su-item" data-card="${esc(r.id)}"><span class="t">${esc(r.title)}</span>${extra(r)}</button>`).join('')
      : '<div class="su-none">Nothing to report.</div>'}</div>`;
  }
  function summary(rep) {
    const s = rep.stats;
    const span = rep.hours === 24 ? 'the last 24 hours' : rep.hours === 168 ? 'the last 7 days' : `the last ${rep.hours} hours`;
    const parts = [`In ${span} the team made <b>${plural(s.updates, 'update')}</b>`];
    const bits = [`${s.done} card${s.done === 1 ? '' : 's'} finished`, `${s.inProgress} in progress`, `${s.blocked} blocked`, `${s.overdue} overdue`];
    let txt = `${parts[0]}: ${bits.join(', ')}.`;
    const risks = rep.blocked.slice(0, 2).map(r => `“${esc(r.title)}” is blocked`).concat(rep.overdue.slice(0, 2).map(r => `“${esc(r.title)}” is ${plural(r.overdueDays, 'day')} overdue`));
    if (risks.length) txt += ` Watch out: ${risks.join('; ')}.`;
    if (rep.needsOwner.length) txt += ` ${plural(rep.needsOwner.length, 'card')} at risk ${rep.needsOwner.length === 1 ? 'has' : 'have'} no owner.`;
    if (!s.updates) txt = `Quiet ${rep.hours <= 24 ? 'day' : 'stretch'}: no updates in ${span}.` + (risks.length ? ` Still open: ${risks.join('; ')}.` : '');
    const busiest = rep.people.slice().sort((a, b) => a.focus.score - b.focus.score)[0];
    if (busiest && busiest.focus.level !== 'focused') txt += ` ${esc(busiest.name.split(' ')[0])} looks ${busiest.focus.level} (focus ${busiest.focus.score}/100) and may need help.`;
    return `<p>${txt}</p>`;
  }
  function personHtml(p) {
    const rows = [];
    const add = (label, list) => { if (list.length) rows.push(`<li><b>${label}:</b> ${list.map(r => esc(r.title)).join('; ')}</li>`); };
    add('Done', p.done); add('Working on', p.inProgress); add('Blocked', p.blocked); add('Overdue', p.overdue);
    if (!rows.length) rows.push('<li class="muted">No assigned work in progress.</li>');
    return `<div class="person" data-person="${esc(p.id)}">
      <div class="person-head">${gauge(p.focus)}<div class="nm">${esc(p.name)}<div class="lv">${LEVEL[p.focus.level]} · ${plural(p.updates, 'update')}</div></div>${FB.util.avatar(p, 'avatar-sm')}</div>
      <div class="person-nums"><span><b>${p.focus.open}</b> open</span><span><b>${p.focus.overdue}</b> overdue</span><span><b>${p.focus.switches}</b> touched in 24 h</span></div>
      <ul>${rows.join('')}</ul></div>`;
  }

  function render() {
    if (!panel || !report) return;
    const rep = report, s = rep.stats;
    const mode = panel.querySelector('[data-mode]');
    mode.className = `su-mode${rep.mode === 'ai' ? ' ai' : ''}`;
    mode.innerHTML = rep.mode === 'ai' ? `${FB.icon('sparkles')} AI summary · ${esc(rep.ai.model)}` : 'Rule-based summary';
    mode.title = rep.mode === 'ai' ? 'Written by your configured AI model from the board facts' : rep.ai.configured ? 'AI is configured but failed; see the note below' : 'Set AI_API_KEY (and optionally AI_BASE_URL, AI_MODEL) to get an AI write-up';
    const body = panel.querySelector('.panel-body');
    const top = body.scrollTop;
    body.innerHTML = `
      <p class="muted small" style="margin-top:10px">${esc(rep.board.name)} · generated ${esc(new Date(rep.generatedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p>
      ${rep.ai.error ? `<div class="su-note" role="status">The AI summary failed (${esc(rep.ai.error)}). Showing the rule-based summary instead.</div>` : ''}
      ${stale ? '<div class="su-note" role="status" data-stale>The board changed since this report. <button type="button" class="link-btn" data-action="su-regen">Regenerate</button></div>' : ''}
      <div class="su-stats">
        <div class="su-stat done"><b>${s.done}</b><span>Done</span></div>
        <div class="su-stat inprog"><b>${s.inProgress}</b><span>In progress</span></div>
        <div class="su-stat blocked"><b>${s.blocked}</b><span>Blocked</span></div>
        <div class="su-stat overdue"><b>${s.overdue}</b><span>Overdue</span></div>
      </div>
      <div class="su-narrative ${rep.html ? 'md' : ''}" data-narrative>${rep.html || summary(rep)}</div>
      ${section('Done', rep.done, r => `<span class="d">${esc(names(r))}</span>`, 'done')}
      ${section('In progress', rep.inProgress, r => `<span class="d">${esc(r.list)} · ${esc(names(r))}</span>${dueLine(r)}`, 'progress')}
      ${section('Blocked', rep.blocked, r => `<span class="d">${esc(names(r))}</span>${dueLine(r)}`, 'blocked')}
      ${section('Overdue', rep.overdue, r => `<span class="d">${esc(names(r))}</span>${dueLine(r)}`, 'overdue')}
      ${rep.dueToday && rep.dueToday.length ? section('Due today', rep.dueToday, r => `<span class="d">${esc(r.list)} · ${esc(names(r))}</span>`, 'today') : ''}
      ${rep.needsOwner.length ? section('Needs an owner', rep.needsOwner, r => dueLine(r) || '<span class="d bad">Blocked</span>', 'owner') : ''}
      <div class="su-section"><h3>By person <span class="n">${rep.people.length}</span></h3><div class="people">${rep.people.map(personHtml).join('')}</div></div>
      <details class="formula"><summary>How is the focus score calculated?</summary>
        <p style="margin-top:8px"><code>score = 100 − 8 × max(0, open − 3) − 15 × overdue − 5 × max(0, touched − 3)</code>, clamped to 0–100.</p>
        <p style="margin-top:6px"><b>open</b>: cards assigned to the person that aren’t in a Done list. <b>overdue</b>: those open cards past their due date. <b>touched</b>: different cards the person changed on this board in the last 24 hours (context switching).</p>
        <p style="margin-top:6px">75–100 Focused · 50–74 Stretched · 0–49 Overloaded.</p>
      </details>`;
    body.scrollTop = top;
  }

  async function load(quiet) {
    if (!panel) return;
    const my = ++seq;
    const body = panel.querySelector('.panel-body');
    const regen = panel.querySelector('[data-action="su-regen-top"]');
    if (!quiet) { body.innerHTML = `<div class="su-loading"><div class="spinner"></div><span>${FB.config && FB.config.ai && FB.config.ai.enabled ? 'Writing your standup…' : 'Building your standup…'}</span></div>`; }
    if (regen) regen.disabled = true;
    const res = await FB.api.get(`/api/boards/${boardId}/standup?hours=${hours}`);
    if (!panel || my !== seq) return;
    if (regen) regen.disabled = false;
    if (!res.ok) { body.innerHTML = `<p class="form-error" style="margin-top:12px">${esc(res.error || 'Couldn’t build the standup.')}</p>`; return; }
    report = res.report; stale = false;
    render();
  }

  const autoRefresh = FB.util.debounce(() => { if (panel && report && report.mode !== 'ai') load(true); }, 1200);

  function open(page, id) {
    if (V.activity) V.activity.close(true);
    boardId = id; report = null; stale = false;
    opener = page.querySelector('[data-action="standup"]');
    panel = document.createElement('aside');
    panel.className = 'panel standup';
    panel.setAttribute('aria-label', 'Daily standup');
    panel.innerHTML = `<div class="panel-head">${FB.icon('sparkles')}<h2>Daily standup</h2><button type="button" class="icon-btn" data-close-panel aria-label="Close standup">${FB.icon('x')}</button></div>
      <div class="su-toolbar"><span class="su-mode" data-mode>…</span><span class="grow"></span>
        <select class="select" data-hours aria-label="Time window" style="width:auto;min-height:32px;height:32px;padding:4px 8px">
          <option value="24" ${hours === 24 ? 'selected' : ''}>Last 24 hours</option><option value="48" ${hours === 48 ? 'selected' : ''}>Last 48 hours</option><option value="168" ${hours === 168 ? 'selected' : ''}>Last 7 days</option></select>
        <button type="button" class="btn btn-sm" data-action="su-regen-top">${FB.icon('refresh')} Regenerate</button></div>
      <div class="panel-body"></div>
      <div class="panel-foot">
        <button type="button" class="btn btn-primary" data-action="su-slack">${FB.icon('copy')} Copy as Slack message</button>
        <button type="button" class="btn" data-action="su-md">${FB.icon('download')} Export as Markdown</button>
      </div>`;
    page.appendChild(panel);
    if (opener) opener.setAttribute('aria-pressed', 'true');
    requestAnimationFrame(() => panel && panel.classList.add('is-open'));
    panel.addEventListener('change', e => { if (e.target.matches('[data-hours]')) { hours = Number(e.target.value); load(); } });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape' && !FB.modal.top() && !FB.popover.current()) { e.preventDefault(); close(); } });
    panel.addEventListener('click', async e => {
      if (e.target.closest('[data-close-panel]')) return close();
      const item = e.target.closest('[data-card]');
      if (item) { location.hash = `#/b/${boardId}/c/${item.dataset.card}`; return; }
      const a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'su-regen' || a.dataset.action === 'su-regen-top') return load();
      if (!report) return FB.toast('The standup is still loading.');
      if (a.dataset.action === 'su-slack') {
        const ok = await FB.util.copyText(report.slack);
        FB.toast(ok ? 'Copied: paste it into Slack' : 'Couldn’t access the clipboard. Use Export as Markdown instead.', ok ? {} : { type: 'error' });
      }
      if (a.dataset.action === 'su-md') {
        FB.util.download(`standup-${FB.util.slug(report.board.name)}-${report.today}.md`, report.markdown);
        FB.toast('Markdown file downloaded');
      }
    });
    off = FB.on('board-change', d => {
      if (!panel || !report) return;
      if (report.mode === 'ai') { if (!stale) { stale = true; render(); } }
      else autoRefresh();
      return d;
    });
    panel.querySelector('[data-close-panel]').focus({ preventScroll: true });
    load();
  }
  function close(immediate) {
    if (!panel) return;
    const p = panel; panel = null; seq++;
    if (off) { off(); off = null; }
    if (opener) { opener.setAttribute('aria-pressed', 'false'); if (!immediate && opener.isConnected) opener.focus({ preventScroll: true }); }
    p.classList.remove('is-open');
    if (immediate || FB.util.reducedMotion()) p.remove(); else setTimeout(() => p.remove(), 280);
  }
  V.standup = { toggle: (page, id) => (panel ? close() : open(page, id)), open, close, isOpen: () => !!panel, report: () => report };
})(window.FB = window.FB || {});
