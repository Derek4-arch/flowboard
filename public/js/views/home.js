/* Flowboard home: board tiles (starred first), create-board dialog. */
(function (FB) {
  'use strict';
  const { esc } = FB.util;
  const V = FB.views = FB.views || {};
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function tile(b) {
    return `<a class="board-tile" href="#/b/${esc(b.id)}" data-color="${esc(b.color)}" data-board-id="${esc(b.id)}">
      <span class="stripe"></span>
      <span class="body"><span class="name">${esc(b.name)}</span><span class="meta">${plural(b.cardCount, 'card')} · ${plural(b.memberCount, 'member')}${b.role === 'owner' ? '' : ' · shared with you'}</span></span>
      <button type="button" class="icon-btn star ${b.starred ? 'is-on' : ''}" data-star="${esc(b.id)}" aria-pressed="${b.starred}" aria-label="${b.starred ? 'Unstar' : 'Star'} ${esc(b.name)}" title="${b.starred ? 'Unstar' : 'Star'} board">${FB.starIcon(b.starred)}</button>
    </a>`;
  }

  V.home = function (main) {
    document.title = 'Boards · Flowboard';
    let boards = [];
    main.innerHTML = `<div class="home"><div class="home-head"><div><h1>Your boards</h1><p class="muted">Hi ${esc(FB.me.name.split(' ')[0])}, pick up where the team left off.</p></div>
      <button type="button" class="btn btn-primary" data-action="new-board">${FB.icon('plus')} Create board</button></div>
      <div data-boards><div class="su-loading"><div class="spinner"></div></div></div></div>`;
    const box = main.querySelector('[data-boards]');

    function render() {
      if (!boards.length) {
        box.innerHTML = `<div class="empty"><h2>No boards yet</h2><p>Create your first board to start planning.</p><p style="margin-top:14px"><button type="button" class="btn btn-primary" data-action="new-board">${FB.icon('plus')} Create board</button></p></div>`;
        return;
      }
      const starred = boards.filter(b => b.starred);
      box.innerHTML = (starred.length ? `<h2 class="section-title">${FB.starIcon(true)} Starred</h2><div class="board-grid">${starred.map(tile).join('')}</div>` : '') +
        `<h2 class="section-title">${FB.icon('board')} All boards</h2><div class="board-grid">${boards.map(tile).join('')}
        <button type="button" class="board-tile new" data-action="new-board">${FB.icon('plus')} Create new board</button></div>`;
    }
    async function load() {
      const res = await FB.api.get('/api/boards');
      if (!res.ok) { box.innerHTML = `<div class="empty"><h2>Couldn’t load your boards</h2><p>${esc(res.error || '')}</p><p style="margin-top:14px"><button type="button" class="btn" data-action="retry">Try again</button></p></div>`; return; }
      boards = res.boards;
      render();
    }
    main.addEventListener('click', async e => {
      const star = e.target.closest('[data-star]');
      if (star) {
        e.preventDefault(); e.stopPropagation();
        const b = boards.find(x => x.id === star.dataset.star);
        if (!b) return;
        b.starred = !b.starred; render();
        const res = await FB.api.put(`/api/boards/${b.id}/star`, { starred: b.starred });
        if (!res.ok) { b.starred = !b.starred; render(); FB.toast(res.error, { type: 'error' }); }
        return;
      }
      const act = e.target.closest('[data-action]');
      if (!act) return;
      if (act.dataset.action === 'new-board') V.createBoardDialog();
      if (act.dataset.action === 'retry') load();
    });
    load();
  };

  V.createBoardDialog = function () {
    let color = 'indigo';
    const m = FB.modal.open({
      title: 'Create board',
      body: `<form novalidate id="new-board-form">
        ${FB.forms.field({ name: 'name', label: 'Board name', placeholder: 'e.g. Product launch', autofocus: true, maxlength: 80 })}
        <div class="field" data-field="color"><span class="field-label">Background</span>
          <div class="swatches" role="group" aria-label="Background colour">${FB.validate.BOARD_COLORS.map(c => `<button type="button" class="swatch" data-color="${c}" data-swatch="${c}" aria-pressed="${c === color}" aria-label="${c}" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join('')}</div>
          <div class="field-error"></div></div>
        <label class="check"><input type="checkbox" name="template" checked> Start with To do, In progress and Done lists</label>
      </form>`,
      foot: '<button type="button" class="btn" data-close>Cancel</button><button type="submit" form="new-board-form" class="btn btn-primary">Create board</button>'
    });
    const form = m.el.querySelector('form');
    FB.forms.liveClear(form);
    form.addEventListener('click', e => {
      const sw = e.target.closest('[data-swatch]');
      if (!sw) return;
      color = sw.dataset.swatch;
      FB.util.$$('[data-swatch]', form).forEach(s => s.setAttribute('aria-pressed', String(s === sw)));
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!FB.forms.validate(form, { name: 'boardName' })) return;
      const btn = m.el.querySelector('button[type=submit]');
      const res = await FB.forms.busy(btn, () => FB.api.post('/api/boards', { name: form.elements.name.value.trim(), color, template: form.template.checked }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(form, res);
      m.close('done');
      location.hash = `#/b/${res.board.id}`;
    });
  };
})(window.FB = window.FB || {});
