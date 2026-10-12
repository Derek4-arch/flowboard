/* Flowboard activity side panel: live feed of everything that happens on the board, with "Load more". */
(function (FB) {
  'use strict';
  const { esc } = FB.util;
  const V = FB.views = FB.views || {};
  let panel = null, boardId = null, items = [], more = false, off = null, opener = null;

  function itemHtml(a, isNew) {
    const card = a.cardId && FB.store.card(a.cardId);
    return `<div class="feed-item${isNew ? ' is-new' : ''}" data-id="${a.id}">
      ${FB.util.avatar({ name: a.userName || 'Someone', color: a.userColor }, 'avatar-sm')}
      <div class="txt"><b>${esc(a.userName || 'Someone')}</b> ${esc(a.text)}
        ${a.excerpt ? `<span class="quote">${esc(a.excerpt)}</span>` : ''}
        <span class="when"><span title="${esc(FB.util.fullTime(a.at))}">${esc(FB.util.relTime(a.at))}</span>${card ? ` · <a href="#/b/${esc(boardId)}/c/${esc(card.id)}">Open card</a>` : ''}</span></div>
    </div>`;
  }
  function render(newIds) {
    if (!panel) return;
    const body = panel.querySelector('.panel-body');
    body.innerHTML = items.length
      ? items.map(a => itemHtml(a, newIds && newIds.has(a.id))).join('') + (more ? '<div style="text-align:center;padding-top:12px"><button type="button" class="btn btn-sm" data-more>Load more</button></div>' : '')
      : '<p class="muted" style="padding:20px 0">No activity yet.</p>';
  }
  async function load() {
    const res = await FB.api.get(`/api/boards/${boardId}/activity?limit=30`);
    if (!panel) return;
    if (!res.ok) { panel.querySelector('.panel-body').innerHTML = `<p class="form-error" style="margin-top:12px">${esc(res.error || 'Couldn’t load activity.')}</p>`; return; }
    items = res.activity; more = res.more;
    render();
  }
  async function refreshTop() {
    if (!panel) return;
    const res = await FB.api.get(`/api/boards/${boardId}/activity?limit=30`);
    if (!panel || !res.ok) return;
    const known = new Set(items.map(a => a.id));
    const fresh = res.activity.filter(a => !known.has(a.id));
    if (!fresh.length) return;
    items = fresh.concat(items);
    render(new Set(fresh.map(a => a.id)));
  }
  async function loadMore(btn) {
    const last = items[items.length - 1];
    const res = await FB.forms.busy(btn, () => FB.api.get(`/api/boards/${boardId}/activity?limit=30&before=${last.id}`));
    if (!panel || !res.ok) return;
    items = items.concat(res.activity); more = res.more;
    const body = panel.querySelector('.panel-body'), top = body.scrollTop;
    render(); body.scrollTop = top;
  }

  function open(page, id) {
    if (V.standup) V.standup.close(true);
    boardId = id; items = []; more = false;
    opener = page.querySelector('[data-action="activity"]');
    panel = document.createElement('aside');
    panel.className = 'panel';
    panel.setAttribute('aria-label', 'Board activity');
    panel.innerHTML = `<div class="panel-head">${FB.icon('activity')}<h2>Activity</h2><button type="button" class="icon-btn" data-close-panel aria-label="Close activity">${FB.icon('x')}</button></div>
      <div class="panel-body"><div class="su-loading"><div class="spinner"></div></div></div>`;
    page.appendChild(panel);
    if (opener) opener.setAttribute('aria-pressed', 'true');
    requestAnimationFrame(() => panel && panel.classList.add('is-open'));
    panel.addEventListener('click', e => {
      if (e.target.closest('[data-close-panel]')) close();
      const m = e.target.closest('[data-more]');
      if (m) loadMore(m);
    });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape' && !FB.modal.top()) { e.preventDefault(); close(); } });
    off = FB.on('board-change', () => refreshTop());
    panel.querySelector('[data-close-panel]').focus({ preventScroll: true });
    load();
  }
  function close(immediate) {
    if (!panel) return;
    const p = panel; panel = null;
    if (off) { off(); off = null; }
    if (opener) { opener.setAttribute('aria-pressed', 'false'); if (!immediate && opener.isConnected) opener.focus({ preventScroll: true }); }
    p.classList.remove('is-open');
    if (immediate || FB.util.reducedMotion()) p.remove(); else setTimeout(() => p.remove(), 280);
  }
  V.activity = { toggle: (page, id) => (panel ? close() : open(page, id)), open, close, isOpen: () => !!panel };
})(window.FB = window.FB || {});
