/* Flowboard board page: header (rename, star, members + focus badges, presence, search, filters, panels),
   lists and cards with keyed re-rendering, composers, list/board menus, invite and label dialogs. */
(function (FB) {
  'use strict';
  const { esc, $, $$ } = FB.util;
  const V = FB.views = FB.views || {};
  const store = FB.store;
  let page = null, canvas = null, boardId = null, presence = [], offs = [], seenCards = null;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const LEVEL = { focused: 'Focused', stretched: 'Stretched', overloaded: 'Overloaded' };

  // ——— Markup ———
  function cardHtml(c) {
    const list = store.list(c.listId);
    const labels = c.labelIds.map(store.label).filter(Boolean);
    const due = FB.util.dueInfo(c.due, list && list.isDone);
    const people = c.assigneeIds.map(store.member).filter(Boolean);
    const meta = [];
    if (c.blocked) meta.push(`<span class="badge blocked" title="Marked as blocked">${FB.icon('blocked')} Blocked</span>`);
    if (due) meta.push(`<span class="badge ${due.cls}" title="${esc((due.label || 'Due') + ' ' + FB.util.fmtDate(c.due))}">${FB.icon('clock')} ${esc(due.text)}</span>`);
    if (c.description && c.description.trim()) meta.push(`<span class="m" title="This card has a description">${FB.icon('text')}<span class="sr-only">Has description</span></span>`);
    if (c.checklist.total) meta.push(`<span class="badge ${c.checklist.done === c.checklist.total ? 'done' : ''}" title="Checklist items">${FB.icon('checklist')} ${c.checklist.done}/${c.checklist.total}</span>`);
    if (c.comments) meta.push(`<span class="m" title="${plural(c.comments, 'comment')}">${FB.icon('comment')} ${c.comments}</span>`);
    if (c.attachments) meta.push(`<span class="m" title="${plural(c.attachments, 'link')}">${FB.icon('link')} ${c.attachments}</span>`);
    if (people.length) meta.push(`<span class="avatars">${people.map(p => FB.util.avatar(p, 'avatar-sm')).join('')}</span>`);
    return `<div class="card${c.blocked ? ' is-blocked' : ''}" role="button" tabindex="0" data-card-id="${esc(c.id)}" aria-label="${esc(c.title)}">
      ${labels.length ? `<div class="card-labels">${labels.map(l => `<span class="lbl-chip lbl-${esc(l.color)}">${esc(l.name)}</span>`).join('')}</div>` : ''}
      <div class="card-title">${esc(c.title)}</div>
      ${meta.length ? `<div class="card-meta">${meta.join('')}</div>` : ''}
    </div>`;
  }

  function createListEl(l) {
    const el = document.createElement('section');
    el.className = 'list';
    el.dataset.listId = l.id;
    el.innerHTML = `<div class="list-head">
        <button type="button" class="list-name" data-action="rename-list" title="Rename list"></button>
        <span class="list-done-tag" title="Cards in this list count as done in the standup" hidden>DONE</span>
        <span class="list-count"></span>
        <button type="button" class="icon-btn" data-action="list-menu">${FB.icon('more')}</button>
      </div>
      <div class="cards" data-cards></div>
      <div class="list-foot"><button type="button" class="add-btn" data-action="add-card">${FB.icon('plus')} Add a card</button></div>`;
    return el;
  }

  function updateListEl(el, l) {
    const cards = store.cardsIn(l.id);
    el.setAttribute('aria-label', `List ${l.name}`);
    const nameBtn = el.querySelector('.list-name');
    if (nameBtn) { nameBtn.textContent = l.name; }
    el.querySelector('[data-action="list-menu"]').setAttribute('aria-label', `List actions for ${l.name}`);
    el.querySelector('.list-done-tag').hidden = !l.isDone;
    el.querySelector('.list-count').textContent = cards.length;
    const box = el.querySelector('.cards');
    const html = cards.map(cardHtml).join('') + '<div class="list-empty-filter" hidden>No matching cards</div>';
    if (el._html !== html) {
      const focused = document.activeElement && box.contains(document.activeElement) && document.activeElement.dataset.cardId;
      const top = box.scrollTop;
      box.innerHTML = html;
      box.scrollTop = top;
      el._html = html;
      // Cards that just appeared (created here or by someone else) rise in gently.
      if (seenCards) cards.forEach(c => { if (!seenCards.has(c.id)) { const n = box.querySelector(`[data-card-id="${CSS.escape(c.id)}"]`); if (n) n.classList.add('is-new'); } });
      if (focused) { const f = box.querySelector(`[data-card-id="${CSS.escape(focused)}"]`); if (f) f.focus({ preventScroll: true }); }
    }
  }

  function renderCanvas() {
    const st = store.state;
    const lists = st.lists.slice().sort((a, b) => a.position - b.position);
    const existing = new Map($$(':scope > .list', canvas).map(el => [el.dataset.listId, el]));
    const oldOrder = [...existing.keys()];
    const keep = lists.map(l => l.id).filter(id => existing.has(id));
    const addList = canvas.querySelector(':scope > .add-list');
    const mutate = () => {
      let cursor = canvas.firstElementChild;
      lists.forEach(l => {
        let el = existing.get(l.id);
        if (!el) el = createListEl(l);
        existing.delete(l.id);
        updateListEl(el, l);
        if (el !== cursor) canvas.insertBefore(el, cursor || addList);
        else cursor = cursor.nextElementSibling;
      });
      existing.forEach(el => el.remove());
      if (canvas.lastElementChild !== addList) canvas.appendChild(addList);
    };
    const reordered = oldOrder.filter(id => keep.includes(id)).join('|') !== keep.join('|');
    if (reordered) FB.dnd.flip($$(':scope > .list', canvas), mutate); else mutate();
    st.cards.forEach(c => seenCards.add(c.id));
    FB.filters.apply(canvas);
  }

  function renderHead() {
    const st = store.state, b = st.board;
    page.dataset.color = b.color;
    document.title = `${b.name} · Flowboard`;
    const nameBtn = page.querySelector('.board-name');
    if (nameBtn) nameBtn.textContent = b.name;
    const star = page.querySelector('[data-action="star"]');
    star.classList.toggle('is-on', b.starred);
    star.setAttribute('aria-pressed', String(b.starred));
    star.setAttribute('aria-label', b.starred ? 'Unstar board' : 'Star board');
    star.innerHTML = FB.starIcon(b.starred);
    renderMembers();
  }

  function renderMembers() {
    if (!page || !store.state) return;
    const st = store.state;
    const online = new Set(presence.map(u => u.id));
    const MAX = 5;
    const shown = st.members.length > MAX ? st.members.slice(0, MAX - 1) : st.members;
    const extra = st.members.length - shown.length;
    page.querySelector('[data-members]').innerHTML = shown.map(m => {
      const f = st.focus[m.id];
      const badge = f ? `<span class="focus-badge focus-${f.level}" aria-hidden="true">${f.score}</span>` : '';
      const dot = online.has(m.id) ? '<span class="presence-dot" aria-hidden="true"></span>' : '';
      const label = `${m.name}${m.role === 'owner' ? ' (owner)' : ''}${f ? ` · focus ${f.score}/100, ${LEVEL[f.level]}` : ''}${online.has(m.id) ? ' · viewing now' : ''}`;
      return `<button type="button" class="member-chip" data-member="${esc(m.id)}" aria-label="${esc(label)}" title="${esc(label)}">${FB.util.avatar(m, '', dot)}${badge}</button>`;
    }).join('') + (extra ? `<button type="button" class="member-chip" data-action="invite" aria-label="${extra} more members" title="${extra} more members"><span class="avatar" style="--av:var(--faint)">+${extra}</span></button>` : '');
  }

  function render() {
    if (!page || !store.state) return;
    renderHead();
    renderCanvas();
  }

  function setLive(s) {
    const el = page && page.querySelector('[data-live]');
    if (!el) return;
    el.classList.toggle('on', s === 'on');
    el.classList.toggle('off', s === 'off');
    el.querySelector('span').textContent = s === 'on' ? 'Live' : s === 'connecting' ? 'Connecting…' : 'Offline';
    el.title = s === 'on' ? 'Changes from other people appear instantly' : 'Reconnecting to live updates…';
  }

  // ——— Mount / unmount ———
  async function mount(main, id) {
    if (boardId === id && page && page.isConnected) return;
    unmount();
    boardId = id;
    seenCards = null;
    FB.filters.reset();
    main.innerHTML = '<div class="page-center"><div class="spinner" aria-label="Loading board"></div></div>';
    const res = await store.load(id);
    if (boardId !== id) return;
    if (!res.ok) {
      boardId = null;
      document.title = 'Board not found · Flowboard';
      main.innerHTML = `<div class="page-center"><div><h1>${res.network ? 'Can’t reach Flowboard' : 'Board not found'}</h1><p>${esc(res.network ? res.error : 'It may have been deleted, or you are not a member.')}</p><p style="margin-top:16px"><a class="btn" href="#/boards">Back to your boards</a></p></div></div>`;
      return;
    }
    main.innerHTML = `<div class="board-page" data-color="${esc(res.board.color)}">
      <div class="board-head">
        <div class="board-title">
          <span class="board-dot" aria-hidden="true"></span>
          <h1 class="sr-only">Board</h1>
          <button type="button" class="board-name" data-action="rename-board" title="Rename board"></button>
          <button type="button" class="icon-btn" data-action="star"></button>
        </div>
        <span class="live" data-live><i></i><span>Connecting…</span></span>
        <div class="avatar-stack" data-members aria-label="Board members and focus scores"></div>
        <div class="board-tools">
          <button type="button" class="btn btn-sm" data-action="invite" title="Invite people">${FB.icon('users')}<span class="lbl-text">Invite</span></button>
          <div class="search">${FB.icon('search')}<input class="input" type="search" placeholder="Search cards" aria-label="Search cards" data-search autocomplete="off"></div>
          <button type="button" class="btn btn-sm" data-action="filter" title="Filter cards">${FB.icon('filter')}<span class="lbl-text">Filter</span><span class="count-pill" data-filter-count hidden></span></button>
          <button type="button" class="btn btn-sm" data-action="activity" title="Activity">${FB.icon('activity')}<span class="lbl-text">Activity</span></button>
          <button type="button" class="btn btn-sm btn-primary" data-action="standup" title="AI Standup">${FB.icon('sparkles')}<span class="lbl-text">Standup</span></button>
          <button type="button" class="icon-btn" data-action="board-menu" aria-label="Board menu" title="Board menu">${FB.icon('more')}</button>
        </div>
      </div>
      <div class="filter-bar" data-filter-bar hidden><span data-filter-text></span><button type="button" class="link-btn" data-action="clear-filters">Clear filters</button></div>
      <div class="board-body"><div class="canvas" data-canvas>
        <div class="add-list"><button type="button" class="add-btn" data-action="add-list">${FB.icon('plus')} Add another list</button></div>
      </div></div>
    </div>`;
    page = main.querySelector('.board-page');
    canvas = page.querySelector('[data-canvas]');
    seenCards = new Set(res.cards.map(c => c.id));
    render();
    wire();
    FB.dnd.init(canvas, { onCardDrop, onListDrop });
    offs = [
      FB.on('board', () => render()),
      FB.on('presence', users => { presence = users; renderMembers(); }),
      FB.on('live', setLive),
      FB.on('filters', () => FB.filters.apply(canvas)),
      FB.on('board-gone', d => {
        FB.toast((d && d.reason) || 'This board is no longer available.', { type: 'error' });
        unmount();
        location.hash = '#/boards';
      })
    ];
    FB.realtime.connect(id);
  }

  function unmount() {
    offs.forEach(off => off()); offs = [];
    FB.realtime.disconnect();
    FB.popover.close();
    if (FB.views.activity) FB.views.activity.close(true);
    if (FB.views.standup) FB.views.standup.close(true);
    boardId = null; page = null; canvas = null; presence = [];
    store.reset(null);
  }

  // ——— Drag and drop results ———
  function onCardDrop(cardId, listId, index) {
    store.localMoveCard(cardId, listId, index);
    render();
    store.act(FB.api.post(`/api/cards/${cardId}/move`, { listId, index }));
  }
  function onListDrop(listId, index) {
    store.localMoveList(listId, index);
    render();
    store.act(FB.api.post(`/api/lists/${listId}/move`, { index }));
  }

  // ——— Events ———
  function wire() {
    const search = page.querySelector('[data-search]');
    search.addEventListener('input', FB.util.debounce(() => { FB.filters.q = search.value; FB.filters.apply(canvas); }, 80));
    search.addEventListener('keydown', e => { if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; FB.filters.q = ''; FB.filters.apply(canvas); } });

    page.addEventListener('click', e => {
      const chip = e.target.closest('[data-member]');
      if (chip && page.querySelector('[data-members]').contains(chip)) return memberPopover(chip, chip.dataset.member);
      const act = e.target.closest('[data-action]');
      if (act && page.contains(act)) return action(act.dataset.action, act, e);
      const card = e.target.closest('.card');
      if (card && canvas.contains(card) && !card.classList.contains('drag-ghost')) openCard(card.dataset.cardId);
    });
    canvas.addEventListener('keydown', e => {
      const card = e.target.closest && e.target.closest('.card');
      if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openCard(card.dataset.cardId); }
    });
  }

  function openCard(cardId) { location.hash = `#/b/${boardId}/c/${cardId}`; }

  function action(name, el) {
    const listEl = el.closest('.list');
    switch (name) {
      case 'rename-board': return renameBoard(el);
      case 'star': return toggleStar();
      case 'invite': return inviteDialog();
      case 'filter': return FB.filters.openPopover(el);
      case 'clear-filters': FB.filters.reset(); page.querySelector('[data-search]').value = ''; FB.filters.apply(canvas); return;
      case 'activity': return FB.views.activity.toggle(page, boardId);
      case 'standup': return FB.views.standup.toggle(page, boardId);
      case 'board-menu': return boardMenu(el);
      case 'add-list': return openListComposer();
      case 'add-card': return openComposer(listEl);
      case 'rename-list': return renameList(listEl);
      case 'list-menu': return listMenu(el, listEl);
      default: return undefined;
    }
  }

  // Inline rename used for the board name and list names.
  function inlineEdit(btn, { value, rule, cls, label, save }) {
    const input = document.createElement('input');
    input.className = `input ${cls}`;
    input.value = value;
    input.maxLength = rule === 'boardName' ? 80 : 60;
    input.setAttribute('aria-label', label);
    btn.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = async commit => {
      if (done) return;
      const v = input.value.trim();
      if (commit && v !== value) {
        const err = FB.validate.rules[rule](v);
        if (err) { input.setAttribute('aria-invalid', 'true'); input.title = err; FB.toast(err, { type: 'error' }); input.focus(); return; }
      }
      done = true;
      btn.textContent = commit && v ? v : value;
      input.replaceWith(btn);
      if (commit && v && v !== value) await store.act(save(v));
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); btn.focus(); }
    });
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    input.addEventListener('blur', () => { if (!input.value.trim()) finish(false); else finish(true); });
  }
  function renameBoard(btn) {
    inlineEdit(btn, { value: store.state.board.name, rule: 'boardName', cls: 'board-name-input', label: 'Board name', save: v => FB.api.patch(`/api/boards/${boardId}`, { name: v }) });
  }
  function renameList(listEl) {
    const l = store.list(listEl.dataset.listId);
    inlineEdit(listEl.querySelector('.list-name'), { value: l.name, rule: 'listName', cls: 'list-name-input', label: 'List name', save: v => FB.api.patch(`/api/lists/${l.id}`, { name: v }) });
  }

  async function toggleStar() {
    const b = store.state.board;
    b.starred = !b.starred; renderHead();
    const res = await FB.api.put(`/api/boards/${boardId}/star`, { starred: b.starred });
    if (!res.ok) { b.starred = !b.starred; renderHead(); FB.toast(res.error, { type: 'error' }); }
    else FB.toast(b.starred ? 'Board starred' : 'Board unstarred');
  }

  // ——— Composers ———
  function closeComposers(except) {
    $$('.list-foot .composer', canvas).forEach(f => { if (f !== except) f._close(); });
    const al = canvas.querySelector('.add-list form');
    if (al && al !== except) al._close();
  }
  function openComposer(listEl) {
    const foot = listEl.querySelector('.list-foot');
    const listId = listEl.dataset.listId;
    const original = foot.innerHTML;
    foot.innerHTML = `<form class="composer" novalidate>${FB.forms.field({ name: 'title', textarea: true, rows: 2, placeholder: 'Enter a title for this card…', ariaLabel: 'Card title', maxlength: 200 })}
      <div class="row"><button type="submit" class="btn btn-primary btn-sm">Add card</button><button type="button" class="icon-btn" data-cancel aria-label="Cancel">${FB.icon('x')}</button></div></form>`;
    const form = foot.querySelector('form'), ta = form.querySelector('textarea');
    form.querySelector('.field').style.marginBottom = '0';
    closeComposers(form);
    const close = () => { document.removeEventListener('pointerdown', outside, true); foot.innerHTML = original; };
    form._close = close;
    const outside = e => { if (!form.contains(e.target) && !ta.value.trim()) close(); };
    document.addEventListener('pointerdown', outside, true);
    FB.forms.liveClear(form);
    ta.focus();
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); listEl.querySelector('[data-action="add-card"]').focus(); }
    });
    form.querySelector('[data-cancel]').addEventListener('click', close);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!FB.forms.validate(form, { title: 'cardTitle' })) return;
      const btn = form.querySelector('button[type=submit]');
      const res = await FB.forms.busy(btn, () => FB.api.post(`/api/lists/${listId}/cards`, { title: ta.value.trim() }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(form, res);
      ta.value = '';
      ta.focus();
      await store.refresh();
      const box = listEl.querySelector('.cards');
      box.scrollTop = box.scrollHeight;
    });
  }
  function openListComposer() {
    const wrap = canvas.querySelector('.add-list');
    const original = wrap.innerHTML;
    wrap.innerHTML = `<form novalidate>${FB.forms.field({ name: 'name', placeholder: 'List name', ariaLabel: 'List name', maxlength: 60 })}
      <div class="row"><button type="submit" class="btn btn-primary btn-sm">Add list</button><button type="button" class="icon-btn" data-cancel aria-label="Cancel">${FB.icon('x')}</button></div></form>`;
    const form = wrap.querySelector('form'), input = form.querySelector('input');
    form.querySelector('.field').style.marginBottom = '8px';
    closeComposers(form);
    const close = () => { document.removeEventListener('pointerdown', outside, true); wrap.innerHTML = original; };
    form._close = close;
    const outside = e => { if (!form.contains(e.target) && !input.value.trim()) close(); };
    document.addEventListener('pointerdown', outside, true);
    FB.forms.liveClear(form);
    input.focus();
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    form.querySelector('[data-cancel]').addEventListener('click', close);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!FB.forms.validate(form, { name: 'listName' })) return;
      const res = await FB.forms.busy(form.querySelector('button[type=submit]'), () => FB.api.post(`/api/boards/${boardId}/lists`, { name: input.value.trim() }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(form, res);
      input.value = ''; input.focus();
      await store.refresh();
      canvas.scrollLeft = canvas.scrollWidth;
    });
  }

  // ——— Menus ———
  const menuHtml = items => `<div class="menu" style="padding:0;min-width:0">${items.map(i => i === '-' ? '<div class="menu-sep"></div>'
    : `<button type="button" class="menu-item ${i.danger ? 'danger' : ''}" data-m="${i.id}" ${i.disabled ? 'disabled' : ''}>${FB.icon(i.icon)} ${esc(i.label)}</button>`).join('')}</div>`;

  function listMenu(anchor, listEl) {
    const l = store.list(listEl.dataset.listId);
    const lists = store.state.lists;
    const idx = lists.findIndex(x => x.id === l.id);
    const count = store.cardsIn(l.id).length;
    FB.popover.open(anchor, {
      title: 'List actions', width: 240,
      render(body, pop) {
        body.innerHTML = menuHtml([
          { id: 'add', icon: 'plus', label: 'Add a card' },
          { id: 'rename', icon: 'edit', label: 'Rename list' },
          { id: 'left', icon: 'move', label: 'Move list left', disabled: idx === 0 },
          { id: 'right', icon: 'move', label: 'Move list right', disabled: idx === lists.length - 1 },
          '-',
          { id: 'delete', icon: 'trash', label: 'Delete list…', danger: true }
        ]);
        body.addEventListener('click', async e => {
          const b = e.target.closest('[data-m]');
          if (!b) return;
          pop.close();
          if (b.dataset.m === 'add') openComposer(listEl);
          if (b.dataset.m === 'rename') renameList(listEl);
          if (b.dataset.m === 'left' || b.dataset.m === 'right') {
            const to = idx + (b.dataset.m === 'left' ? -1 : 1);
            store.localMoveList(l.id, to); render();
            store.act(FB.api.post(`/api/lists/${l.id}/move`, { index: to }));
          }
          if (b.dataset.m === 'delete') {
            const ok = await FB.modal.confirm({ title: `Delete “${l.name}”?`, message: count ? `This list and its ${plural(count, 'card')} will be deleted for everyone. This can’t be undone.` : 'This empty list will be deleted for everyone.', confirm: 'Delete list', danger: true });
            if (ok) { const res = await store.act(FB.api.del(`/api/lists/${l.id}`)); if (res.ok) FB.toast(`Deleted “${l.name}”`); }
          }
        });
      }
    });
  }

  function boardMenu(anchor) {
    const st = store.state, owner = store.isOwner();
    FB.popover.open(anchor, {
      title: 'Board', width: 280,
      render(body, pop) {
        body.innerHTML = `<div class="pop-sub" style="margin-top:2px">Background</div>
          <div class="swatches" style="margin-bottom:12px">${FB.validate.BOARD_COLORS.map(c => `<button type="button" class="swatch" data-color="${c}" data-swatch="${c}" aria-pressed="${c === st.board.color}" aria-label="${c} background" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join('')}</div>
          ${menuHtml([
            { id: 'rename', icon: 'edit', label: 'Rename board' },
            { id: 'labels', icon: 'tag', label: 'Manage labels…' },
            { id: 'members', icon: 'users', label: 'Members…' },
            '-',
            owner ? { id: 'delete', icon: 'trash', label: 'Delete board…', danger: true } : { id: 'leave', icon: 'door', label: 'Leave board…', danger: true }
          ])}`;
        body.addEventListener('click', async e => {
          const sw = e.target.closest('[data-swatch]');
          if (sw) {
            $$('[data-swatch]', body).forEach(s => s.setAttribute('aria-pressed', String(s === sw)));
            page.dataset.color = sw.dataset.swatch;
            store.act(FB.api.patch(`/api/boards/${boardId}`, { color: sw.dataset.swatch }));
            return;
          }
          const b = e.target.closest('[data-m]');
          if (!b) return;
          pop.close();
          if (b.dataset.m === 'rename') renameBoard(page.querySelector('.board-name'));
          if (b.dataset.m === 'labels') labelsDialog();
          if (b.dataset.m === 'members') inviteDialog();
          if (b.dataset.m === 'delete') {
            const ok = await FB.modal.confirm({ title: `Delete “${st.board.name}”?`, message: 'All lists, cards, comments and activity on this board will be permanently deleted for every member.', confirm: 'Delete board', danger: true });
            if (!ok) return;
            const res = await FB.api.del(`/api/boards/${boardId}`);
            if (!res.ok) return FB.toast(res.error, { type: 'error' });
            FB.toast(`Deleted “${st.board.name}”`);
            unmount();
            location.hash = '#/boards';
          }
          if (b.dataset.m === 'leave') leaveBoard();
        });
      }
    });
  }

  async function leaveBoard() {
    const st = store.state;
    const ok = await FB.modal.confirm({ title: `Leave “${st.board.name}”?`, message: 'You will lose access until someone invites you again. You will be unassigned from its cards.', confirm: 'Leave board', danger: true });
    if (!ok) return;
    const res = await FB.api.del(`/api/boards/${boardId}/members/${FB.me.id}`);
    if (!res.ok) return FB.toast(res.error, { type: 'error' });
    FB.toast(`You left “${st.board.name}”`);
    unmount();
    location.hash = '#/boards';
  }

  function memberPopover(anchor, userId) {
    const m = store.member(userId);
    if (!m) return;
    const f = store.state.focus[m.id];
    const isMe = m.id === FB.me.id, owner = store.isOwner();
    FB.popover.open(anchor, {
      title: m.name, width: 290,
      render(body, pop) {
        body.innerHTML = `<div class="row" style="margin-bottom:10px">${FB.util.avatar(m, 'avatar-lg')}<div style="min-width:0"><b>${esc(m.name)}</b>${isMe ? ' <span class="muted small">(you)</span>' : ''}<div class="muted small">${esc(m.email)} · ${m.role === 'owner' ? 'Owner' : 'Member'}</div></div></div>
          ${f ? `<div class="person-nums" style="margin:4px 0 10px"><span class="focus-badge focus-${f.level}" style="position:static;box-shadow:none">${f.score}</span><span>${LEVEL[f.level]} · <b>${f.open}</b> open · <b>${f.overdue}</b> overdue · <b>${f.switches}</b> touched in 24 h</span></div>` : ''}
          ${menuHtml([
            { id: 'filter', icon: 'filter', label: `Show only ${isMe ? 'my' : m.name.split(' ')[0] + '’s'} cards` },
            ...(isMe && m.role !== 'owner' ? ['-', { id: 'leave', icon: 'door', label: 'Leave board…', danger: true }] : []),
            ...(!isMe && owner ? ['-', { id: 'remove', icon: 'trash', label: 'Remove from board…', danger: true }] : [])
          ])}`;
        body.addEventListener('click', async e => {
          const b = e.target.closest('[data-m]');
          if (!b) return;
          pop.close();
          if (b.dataset.m === 'filter') { FB.filters.members.clear(); FB.filters.members.add(m.id); FB.filters.apply(canvas); }
          if (b.dataset.m === 'leave') leaveBoard();
          if (b.dataset.m === 'remove') removeMember(m);
        });
      }
    });
  }
  async function removeMember(m) {
    const ok = await FB.modal.confirm({ title: `Remove ${m.name}?`, message: `${m.name} will lose access to this board and be unassigned from its cards.`, confirm: 'Remove', danger: true });
    if (!ok) return false;
    const res = await store.act(FB.api.del(`/api/boards/${boardId}/members/${m.id}`));
    if (res.ok) FB.toast(`${m.name} was removed`);
    return res.ok;
  }

  // ——— Dialogs ———
  function inviteDialog() {
    const m = FB.modal.open({
      title: 'Share board',
      body: `<form novalidate data-invite>
          <p class="muted small" style="margin-bottom:10px">Invite someone who already has a Flowboard account.</p>
          ${FB.forms.field({ name: 'email', label: 'Email address', type: 'email', placeholder: 'name@example.com', autocomplete: 'off', autofocus: true })}
          <button type="submit" class="btn btn-primary">${FB.icon('plus')} Invite</button>
        </form>
        <div class="pop-sub" style="margin-top:18px">Members</div>
        <div data-member-list class="pop-list"></div>`,
      foot: '<button type="button" class="btn" data-close>Done</button>',
      onClose: () => off()
    });
    const form = m.el.querySelector('form');
    const listBox = m.el.querySelector('[data-member-list]');
    const renderList = () => {
      if (!store.state) return;
      const owner = store.isOwner();
      listBox.innerHTML = store.state.members.map(u => `<div class="pop-row" style="cursor:default">${FB.util.avatar(u, 'avatar-sm')}<span class="grow"><b>${esc(u.name)}</b> <span class="muted small">${esc(u.email)}</span></span>
        <span class="muted small">${u.role === 'owner' ? 'Owner' : ''}</span>${owner && u.role !== 'owner' ? `<button type="button" class="link-btn" data-remove="${esc(u.id)}">Remove</button>` : ''}</div>`).join('');
    };
    const off = FB.on('board', renderList);
    renderList();
    FB.forms.liveClear(form);
    listBox.addEventListener('click', e => { const b = e.target.closest('[data-remove]'); if (b) removeMember(store.member(b.dataset.remove)); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!FB.forms.validate(form, { email: 'email' })) return;
      const res = await FB.forms.busy(form.querySelector('button[type=submit]'), () => FB.api.post(`/api/boards/${boardId}/members`, { email: form.email.value.trim() }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(form, Object.assign({}, res, { field: 'email' }));
      form.email.value = '';
      FB.toast(`${res.member.name} can now see this board`);
      store.refresh();
    });
  }

  function labelsDialog() {
    let newColor = 'blue';
    const m = FB.modal.open({
      title: 'Labels',
      body: `<div data-label-rows></div>
        <form novalidate data-new-label style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
          ${FB.forms.field({ name: 'name', label: 'New label', placeholder: 'e.g. Urgent', maxlength: 30 })}
          <div class="swatches" style="margin-bottom:12px" role="group" aria-label="Label colour">${FB.validate.LABEL_COLORS.map(c => `<button type="button" class="swatch lbl lbl-${c}" data-new-color="${c}" aria-pressed="${c === newColor}" aria-label="${c}" title="${c}"></button>`).join('')}</div>
          <button type="submit" class="btn btn-primary btn-sm">${FB.icon('plus')} Create label</button>
        </form>`,
      foot: '<button type="button" class="btn" data-close>Done</button>',
      onClose: () => off()
    });
    const rows = m.el.querySelector('[data-label-rows]');
    const renderRows = () => {
      if (!store.state) return;
      const labels = store.state.labels;
      if (rows.querySelector(':focus')) return;
      rows.innerHTML = labels.length ? labels.map(l => `<form novalidate class="row" data-label-id="${esc(l.id)}" style="margin-bottom:8px;align-items:flex-start">
          <div class="field" data-field="name" style="flex:1;margin:0"><input class="input" name="name" value="${esc(l.name)}" maxlength="30" aria-label="Label name"><div class="field-error"></div></div>
          <select class="select" name="color" aria-label="Label colour" style="width:110px">${FB.validate.LABEL_COLORS.map(c => `<option value="${c}" ${c === l.color ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <span class="lbl-chip lbl-${esc(l.color)}" style="margin-top:9px" aria-hidden="true"></span>
          <button type="submit" class="btn btn-sm" style="margin-top:4px">Save</button>
          <button type="button" class="icon-btn" data-del-label aria-label="Delete label ${esc(l.name)}">${FB.icon('trash')}</button>
        </form>`).join('') : '<p class="muted">No labels yet.</p>';
    };
    const off = FB.on('board', renderRows);
    renderRows();
    rows.addEventListener('change', e => { if (e.target.name === 'color') { const chip = e.target.parentNode.querySelector('.lbl-chip'); chip.className = `lbl-chip lbl-${e.target.value}`; } });
    rows.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target;
      if (!FB.forms.validate(form, { name: 'labelName' })) return;
      const res = await FB.forms.busy(form.querySelector('button[type=submit]'), () => FB.api.patch(`/api/labels/${form.dataset.labelId}`, { name: form.elements.name.value.trim(), color: form.color.value }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(form, res);
      form.querySelector('input').blur();
      FB.toast('Label saved');
      store.refresh();
    });
    rows.addEventListener('click', async e => {
      const b = e.target.closest('[data-del-label]');
      if (!b) return;
      const id = b.closest('form').dataset.labelId, l = store.label(id);
      const ok = await FB.modal.confirm({ title: `Delete the “${l.name}” label?`, message: 'It will be removed from every card on this board.', confirm: 'Delete label', danger: true });
      if (ok) { b.blur(); await store.act(FB.api.del(`/api/labels/${id}`)); }
    });
    const nf = m.el.querySelector('[data-new-label]');
    FB.forms.liveClear(nf);
    nf.addEventListener('click', e => {
      const sw = e.target.closest('[data-new-color]');
      if (!sw) return;
      newColor = sw.dataset.newColor;
      $$('[data-new-color]', nf).forEach(s => s.setAttribute('aria-pressed', String(s === sw)));
    });
    nf.addEventListener('submit', async e => {
      e.preventDefault();
      if (!FB.forms.validate(nf, { name: 'labelName' })) return;
      const res = await FB.forms.busy(nf.querySelector('button[type=submit]'), () => FB.api.post(`/api/boards/${boardId}/labels`, { name: nf.elements.name.value.trim(), color: newColor }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(nf, res);
      nf.elements.name.value = '';
      FB.toast(`Created “${res.label.name}”`);
      store.refresh();
    });
  }

  V.board = { mount, unmount, id: () => boardId, page: () => page, canvas: () => canvas, openCard, renderMembers };
})(window.FB = window.FB || {});
