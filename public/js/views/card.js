/* Flowboard card details modal (route #/b/:boardId/c/:cardId): title, labels, members, due date, blocked flag,
   safe Markdown description, checklist with progress, link attachments, comments, history, move and delete.
   Sections re-render on live updates without disturbing anything the user is currently editing. */
(function (FB) {
  'use strict';
  const { esc, $, $$ } = FB.util;
  const V = FB.views = FB.views || {};
  const store = FB.store;
  let modal = null, cardId = null, boardId = null, card = null, offs = [], editingDesc = false, gone = false;

  const api = (method, url, body) => FB.api[method](url, body);
  async function act(promise, okMsg) {
    const res = await promise;
    if (!res.ok) FB.toast(res.error || 'That didn’t work.', { type: 'error' });
    else if (okMsg) FB.toast(okMsg);
    await reload();
    store.refresh();
    return res;
  }

  async function open(bId, cId) {
    if (modal && cardId === cId) return;
    close('route');
    boardId = bId; cardId = cId; card = null; editingDesc = false; gone = false;
    modal = FB.modal.open({
      className: 'card-modal',
      focusDialog: true,
      raw: '<div class="su-loading"><div class="spinner" aria-label="Loading card"></div></div>',
      onClose: reason => {
        offs.forEach(off => off()); offs = [];
        const wasId = cardId;
        modal = null; cardId = null; card = null;
        if (reason !== 'route' && wasId && location.hash.includes(`/c/${wasId}`)) location.hash = `#/b/${boardId}`;
      }
    });
    modal.el.setAttribute('aria-label', 'Card details');
    offs.push(FB.on('board-change', d => { if (modal && !d.own && (d.reconnect || (d.cardIds || []).includes(cardId))) reload(); }));
    offs.push(FB.on('board', () => { if (modal && card) { renderMeta(); renderSub(); } }));
    const res = await FB.api.get(`/api/cards/${encodeURIComponent(cId)}`);
    if (cardId !== cId || !modal) return;
    if (!res.ok) {
      modal.el.innerHTML = `<div class="modal-head"><h2>Card not found</h2><button type="button" class="icon-btn" data-close aria-label="Close">${FB.icon('x')}</button></div><div class="modal-body"><p class="muted">It may have been deleted or moved to a board you can’t see.</p></div><div class="modal-foot"><button type="button" class="btn" data-close>Close</button></div>`;
      return;
    }
    card = res.card;
    build();
  }

  function close(reason) { if (modal) modal.close(reason || 'route'); }

  async function reload() {
    if (!modal || !cardId) return;
    const id = cardId;
    const res = await FB.api.get(`/api/cards/${encodeURIComponent(id)}`);
    if (cardId !== id || !modal) return;
    if (!res.ok) {
      if (res.status === 404 && !gone) { gone = true; FB.toast('This card was deleted.'); close('deleted'); }
      return;
    }
    card = res.card;
    renderAll();
  }

  // ——— Layout ———
  function build() {
    modal.el.innerHTML = `
      <div class="cm-head">
        <span class="ic">${FB.icon('card')}</span>
        <div class="cm-title">
          <textarea rows="1" maxlength="200" aria-label="Card title" data-title spellcheck="true"></textarea>
          <div class="field-error" data-title-err role="alert"></div>
          <div class="cm-sub" data-sub></div>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close card">${FB.icon('x')}</button>
      </div>
      <div class="cm-grid">
        <div class="cm-main">
          <div class="cm-section"><div class="cm-meta" data-meta></div></div>
          <div class="cm-section">
            <div class="cm-section-head">${FB.icon('text')}<h3>Description</h3><button type="button" class="btn btn-sm btn-soft" data-act="edit-desc">Edit</button></div>
            <div data-desc></div>
          </div>
          <div class="cm-section">
            <div class="cm-section-head">${FB.icon('checklist')}<h3>Checklist</h3><span class="muted small" data-check-count></span></div>
            <div data-checklist></div>
            <div data-check-add></div>
          </div>
          <div class="cm-section">
            <div class="cm-section-head">${FB.icon('link')}<h3>Attachments</h3><button type="button" class="btn btn-sm btn-soft" data-act="add-link">Add link</button></div>
            <div data-attachments></div>
            <div data-attach-form></div>
          </div>
          <div class="cm-section">
            <div class="cm-section-head">${FB.icon('comment')}<h3>Comments</h3></div>
            <form novalidate data-comment-form class="row" style="align-items:flex-start;margin-bottom:14px">
              ${FB.util.avatar(FB.me, 'avatar')}
              <div style="flex:1;min-width:0">
                ${FB.forms.field({ name: 'body', textarea: true, rows: 2, placeholder: 'Write a comment… (Markdown supported)', ariaLabel: 'Write a comment', maxlength: 5000 })}
                <div class="row" style="margin-top:-6px"><button type="submit" class="btn btn-primary btn-sm">Save comment</button><span class="muted small">Ctrl + Enter to send</span></div>
              </div>
            </form>
            <div data-comments></div>
          </div>
          <div class="cm-section">
            <div class="cm-section-head">${FB.icon('clock')}<h3>History</h3></div>
            <div data-activity></div>
          </div>
        </div>
        <aside class="cm-side" aria-label="Card actions">
          <div class="field-label">Add to card</div>
          <button type="button" class="side-btn" data-act="members">${FB.icon('user')} Members</button>
          <button type="button" class="side-btn" data-act="labels">${FB.icon('tag')} Labels</button>
          <button type="button" class="side-btn" data-act="due">${FB.icon('calendar')} Due date</button>
          <button type="button" class="side-btn" data-act="add-item">${FB.icon('checklist')} Checklist item</button>
          <button type="button" class="side-btn" data-act="add-link">${FB.icon('link')} Attachment</button>
          <div class="field-label">Actions</div>
          <button type="button" class="side-btn" data-act="move">${FB.icon('move')} Move</button>
          <button type="button" class="side-btn" data-act="blocked" aria-pressed="false">${FB.icon('blocked')} <span>Mark as blocked</span></button>
          <button type="button" class="side-btn danger" data-act="delete">${FB.icon('trash')} Delete card</button>
        </aside>
      </div>`;
    wire();
    renderAll();
    const ta = $('[data-title]', modal.el);
    FB.util.autosize(ta);
    setTimeout(() => { if (modal) { modal.el.focus({ preventScroll: true }); } }, 30);
  }

  function renderAll() {
    if (!modal || !card) return;
    const ta = $('[data-title]', modal.el);
    if (!ta) return;
    if (document.activeElement !== ta) { ta.value = card.title; FB.util.autosize(ta); }
    renderSub(); renderMeta(); renderDesc(); renderChecklist(); renderAttachments(); renderComments(); renderActivity();
    const b = $('[data-act="blocked"]', modal.el);
    b.classList.toggle('is-on', card.blocked);
    b.setAttribute('aria-pressed', String(card.blocked));
    b.querySelector('span').textContent = card.blocked ? 'Blocked — unblock' : 'Mark as blocked';
  }

  function renderSub() {
    const el = modal && $('[data-sub]', modal.el);
    if (!el || !card) return;
    const list = store.list(card.listId);
    el.innerHTML = `in list <b>${esc(list ? list.name : card.listName)}</b>${card.blocked ? ' · <span class="badge blocked">Blocked</span>' : ''}`;
  }

  function renderMeta() {
    const el = modal && $('[data-meta]', modal.el);
    if (!el || !card) return;
    const labels = card.labelIds.map(store.label).filter(Boolean);
    const people = card.assigneeIds.map(store.member).filter(Boolean);
    const list = store.list(card.listId);
    const due = FB.util.dueInfo(card.due, list && list.isDone);
    el.innerHTML = `
      <div class="group"><span class="field-label">Members</span><div class="chips">${people.map(p => FB.util.avatar(p)).join('')}<button type="button" class="chip-btn" data-act="members" aria-label="Edit members">${FB.icon('plus')}</button></div></div>
      <div class="group"><span class="field-label">Labels</span><div class="chips">${labels.map(l => `<span class="lbl-chip lbl-${esc(l.color)}">${esc(l.name)}</span>`).join('')}<button type="button" class="chip-btn" data-act="labels" aria-label="Edit labels">${FB.icon('plus')}</button></div></div>
      ${card.due ? `<div class="group"><span class="field-label">Due date</span><div class="chips"><button type="button" class="due-chip" data-act="due">${FB.icon('calendar')} ${esc(FB.util.fmtDate(card.due))}${due && due.label ? ` <span class="badge ${due.cls}">${esc(due.label)}</span>` : ''}${due && due.cls === 'done' ? ' <span class="badge done">Complete</span>' : ''}</button></div></div>` : ''}`;
  }

  function renderDesc() {
    if (editingDesc) return;
    const el = $('[data-desc]', modal.el);
    const has = card.description && card.description.trim();
    el.innerHTML = has
      ? `<div class="md desc-view" data-act="edit-desc" title="Click to edit">${FB.markdown.render(card.description)}</div>`
      : '<div class="desc-empty" data-act="edit-desc" role="button" tabindex="0">Add a more detailed description…</div>';
    $('.cm-section-head [data-act="edit-desc"]', modal.el).hidden = !has;
  }

  function editDesc() {
    if (editingDesc) return;
    editingDesc = true;
    const el = $('[data-desc]', modal.el);
    $('.cm-section-head [data-act="edit-desc"]', modal.el).hidden = true;
    el.innerHTML = `<form novalidate data-desc-form>${FB.forms.field({ name: 'description', textarea: true, rows: 6, value: card.description || '', ariaLabel: 'Description', hint: 'Markdown: **bold**, _italic_, `code`, - lists, - [ ] tasks, > quotes, [links](https://…). Ctrl + Enter to save.' })}
      <div class="row"><button type="submit" class="btn btn-primary btn-sm">Save</button><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button></div></form>`;
    const form = $('form', el), ta = $('textarea', form);
    FB.forms.liveClear(form);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    FB.util.autosize(ta);
    ta.addEventListener('input', () => FB.util.autosize(ta));
    const stop = () => { editingDesc = false; renderDesc(); };
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
      if (e.key === 'Escape') { e.preventDefault(); stop(); }
    });
    $('[data-cancel]', form).addEventListener('click', stop);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!FB.forms.validate(form, { description: 'description' })) return;
      const res = await FB.forms.busy($('button[type=submit]', form), () => FB.api.patch(`/api/cards/${cardId}`, { description: ta.value }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(form, res);
      editingDesc = false;
      await reload(); store.refresh();
    });
  }

  function renderChecklist() {
    const el = $('[data-checklist]', modal.el);
    if (el.querySelector('.check-edit')) return;
    const items = card.checklist, done = items.filter(i => i.done).length;
    const pct = items.length ? Math.round(done / items.length * 100) : 0;
    $('[data-check-count]', modal.el).textContent = items.length ? `${done} of ${items.length} done` : '';
    el.innerHTML = (items.length ? `<div class="progress" aria-label="Checklist progress"><span class="pct">${pct}%</span><div class="bar ${pct === 100 ? 'complete' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div>` : '') +
      items.map(i => `<div class="check-item ${i.done ? 'done' : ''}" data-item="${esc(i.id)}">
        <input type="checkbox" ${i.done ? 'checked' : ''} aria-label="${esc(i.text)}" data-toggle>
        <span class="txt" data-edit-item tabindex="0" role="button" title="Click to edit">${esc(i.text)}</span>
        <button type="button" class="icon-btn" data-del-item aria-label="Delete item ${esc(i.text)}">${FB.icon('trash')}</button>
      </div>`).join('');
    const add = $('[data-check-add]', modal.el);
    if (!add.querySelector('form')) add.innerHTML = `<button type="button" class="btn btn-soft btn-sm" data-act="add-item" style="margin-top:6px">${FB.icon('plus')} Add an item</button>`;
  }

  function openItemForm() {
    const add = $('[data-check-add]', modal.el);
    if (!add.querySelector('form')) {
      add.innerHTML = `<form novalidate style="margin-top:8px">${FB.forms.field({ name: 'text', placeholder: 'Add an item', ariaLabel: 'New checklist item', maxlength: 300 })}
        <div class="row" style="margin-top:-6px"><button type="submit" class="btn btn-primary btn-sm">Add</button><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button></div></form>`;
      const form = $('form', add), input = $('input', form);
      FB.forms.liveClear(form);
      const done = () => { add.innerHTML = ''; renderChecklist(); };
      $('[data-cancel]', form).addEventListener('click', done);
      input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); done(); } });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!FB.forms.validate(form, { text: 'checklistText' })) return;
        const res = await FB.forms.busy($('button[type=submit]', form), () => FB.api.post(`/api/cards/${cardId}/checklist`, { text: input.value.trim() }));
        if (res.busy) return;
        if (!res.ok) return FB.forms.serverError(form, res);
        input.value = ''; input.focus();
        await reload(); store.refresh();
      });
    }
    $('input', add).focus();
  }

  function editItem(row) {
    const id = row.dataset.item, item = card.checklist.find(i => i.id === id);
    if (!item) return;
    const span = $('.txt', row);
    const form = document.createElement('form');
    form.className = 'check-edit';
    form.noValidate = true;
    form.style.flex = '1';
    form.innerHTML = `${FB.forms.field({ name: 'text', value: item.text, ariaLabel: 'Edit checklist item', maxlength: 300 })}<div class="row" style="margin-top:-6px"><button type="submit" class="btn btn-primary btn-sm">Save</button><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button></div>`;
    span.replaceWith(form);
    const input = $('input', form);
    input.focus(); input.select();
    const done = () => { form.remove(); renderChecklist(); };
    $('[data-cancel]', form).addEventListener('click', done);
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); done(); } });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!FB.forms.validate(form, { text: 'checklistText' })) return;
      const res = await FB.forms.busy($('button[type=submit]', form), () => FB.api.patch(`/api/checklist/${id}`, { text: input.value.trim() }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(form, res);
      form.remove();
      await reload(); store.refresh();
    });
  }

  function renderAttachments() {
    const el = $('[data-attachments]', modal.el);
    el.innerHTML = card.attachments.length ? card.attachments.map(a => `<div class="attach">
        <span class="thumb">${FB.icon('link')}</span>
        <div class="info"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(a.title)}</a>
          <div class="muted">${esc(FB.util.host(a.url))} · added ${esc(FB.util.relTime(a.createdAt))}${a.userName ? ` by ${esc(a.userName)}` : ''}</div></div>
        <a class="icon-btn" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer nofollow" aria-label="Open ${esc(a.title)} in a new tab">${FB.icon('external')}</a>
        <button type="button" class="icon-btn" data-del-attach="${esc(a.id)}" aria-label="Remove ${esc(a.title)}">${FB.icon('trash')}</button>
      </div>`).join('') : '<p class="muted small">No links yet. Attach docs, designs or tickets by URL.</p>';
  }

  function openAttachForm() {
    const box = $('[data-attach-form]', modal.el);
    if (!box.querySelector('form')) {
      box.innerHTML = `<form novalidate style="margin-top:10px">
        ${FB.forms.field({ name: 'url', label: 'Link', type: 'url', placeholder: 'https://…', maxlength: 2000 })}
        ${FB.forms.field({ name: 'title', label: 'Title (optional)', placeholder: 'e.g. Figma mockups', maxlength: 120 })}
        <div class="row"><button type="submit" class="btn btn-primary btn-sm">Attach</button><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button></div></form>`;
      const form = $('form', box);
      FB.forms.liveClear(form);
      const done = () => { box.innerHTML = ''; };
      $('[data-cancel]', form).addEventListener('click', done);
      form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); done(); } });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!FB.forms.validate(form, { url: 'attachmentUrl', title: 'attachmentTitle' })) return;
        const v = FB.forms.values(form);
        const res = await FB.forms.busy($('button[type=submit]', form), () => FB.api.post(`/api/cards/${cardId}/attachments`, { url: v.url.trim(), title: v.title.trim() }));
        if (res.busy) return;
        if (!res.ok) return FB.forms.serverError(form, res);
        done();
        await reload(); store.refresh();
      });
    }
    $('input', box).focus();
  }

  function renderComments() {
    const el = $('[data-comments]', modal.el);
    const owner = store.isOwner();
    el.innerHTML = card.comments.length ? card.comments.map(c => `<div class="comment">
        ${FB.util.avatar({ name: c.userName || 'Former member', color: c.userColor })}
        <div class="body"><div class="who"><b>${esc(c.userName || 'Former member')}</b><span title="${esc(FB.util.fullTime(c.createdAt))}">${esc(FB.util.relTime(c.createdAt))}</span></div>
          <div class="bubble md">${FB.markdown.render(c.body)}</div>
          ${c.userId === FB.me.id || owner ? `<div class="acts"><button type="button" class="link-btn" data-del-comment="${esc(c.id)}">Delete</button></div>` : ''}
        </div></div>`).join('') : '<p class="muted small">No comments yet.</p>';
  }

  function renderActivity() {
    const el = $('[data-activity]', modal.el);
    el.innerHTML = card.activity.length ? card.activity.slice(0, 15).map(a => `<div class="act-line">${FB.util.avatar({ name: a.userName || 'Someone', color: a.userColor }, 'avatar-sm')}
        <div><b>${esc(a.userName || 'Someone')}</b> ${esc(a.text)}<div class="t" title="${esc(FB.util.fullTime(a.at))}">${esc(FB.util.relTime(a.at))}</div></div></div>`).join('')
      : '<p class="muted small">No history yet.</p>';
  }

  // ——— Popovers ———
  function labelsPopover(anchor) {
    FB.popover.open(anchor, {
      title: 'Labels',
      render(body, pop) {
        const draw = () => {
          const st = store.state;
          body.innerHTML = `<div class="pop-list" role="group" aria-label="Labels">${st.labels.map(l => {
            const on = card.labelIds.includes(l.id);
            return `<button type="button" class="pop-row" style="border:0;background:none;width:100%;text-align:left" data-label="${esc(l.id)}" aria-pressed="${on}"><span class="lbl-bar lbl-${esc(l.color)}">${esc(l.name)}</span><span style="width:18px">${on ? FB.icon('check') : ''}</span></button>`;
          }).join('') || '<p class="muted small">No labels yet.</p>'}</div>
          <form novalidate data-new-label><div class="pop-sub">Create a label</div>
            ${FB.forms.field({ name: 'name', placeholder: 'Label name', ariaLabel: 'New label name', maxlength: 30 })}
            <div class="row" style="margin-top:-6px"><select class="select" name="color" aria-label="Label colour" style="flex:1">${FB.validate.LABEL_COLORS.map(c => `<option value="${c}">${c}</option>`).join('')}</select><button type="submit" class="btn btn-sm">Create</button></div>
          </form>`;
          const form = $('[data-new-label]', body);
          FB.forms.liveClear(form);
          form.addEventListener('submit', async e => {
            e.preventDefault();
            if (!FB.forms.validate(form, { name: 'labelName' })) return;
            const res = await FB.forms.busy($('button[type=submit]', form), () => FB.api.post(`/api/boards/${boardId}/labels`, { name: form.elements.name.value.trim(), color: form.elements.color.value }));
            if (res.busy) return;
            if (!res.ok) return FB.forms.serverError(form, res);
            await FB.api.put(`/api/cards/${cardId}/labels/${res.label.id}`);
            await store.refresh(); await reload();
            draw(); pop.reposition();
          });
        };
        draw();
        body.addEventListener('click', async e => {
          const row = e.target.closest('[data-label]');
          if (!row) return;
          const id = row.dataset.label, on = card.labelIds.includes(id);
          row.disabled = true;
          await act(on ? FB.api.del(`/api/cards/${cardId}/labels/${id}`) : FB.api.put(`/api/cards/${cardId}/labels/${id}`));
          draw();
        });
      }
    });
  }

  function membersPopover(anchor) {
    FB.popover.open(anchor, {
      title: 'Members',
      render(body) {
        const draw = () => {
          body.innerHTML = `<div class="pop-list">${store.state.members.map(m => {
            const on = card.assigneeIds.includes(m.id);
            return `<button type="button" class="pop-row" style="border:0;background:none;width:100%;text-align:left" data-user="${esc(m.id)}" aria-pressed="${on}">${FB.util.avatar(m, 'avatar-sm')}<span class="grow">${esc(m.name)}${m.id === FB.me.id ? ' (you)' : ''}</span><span style="width:18px">${on ? FB.icon('check') : ''}</span></button>`;
          }).join('')}</div><p class="muted small">Invite more people from the board’s Invite button.</p>`;
        };
        draw();
        body.addEventListener('click', async e => {
          const row = e.target.closest('[data-user]');
          if (!row) return;
          const id = row.dataset.user, on = card.assigneeIds.includes(id);
          row.disabled = true;
          await act(on ? FB.api.del(`/api/cards/${cardId}/assignees/${id}`) : FB.api.put(`/api/cards/${cardId}/assignees/${id}`));
          draw();
        });
      }
    });
  }

  function duePopover(anchor) {
    FB.popover.open(anchor, {
      title: 'Due date',
      render(body, pop) {
        const t = FB.util.todayStr();
        body.innerHTML = `<form novalidate>
          ${FB.forms.field({ name: 'due', label: 'Date', type: 'date', value: card.due || '' })}
          <div class="row" style="flex-wrap:wrap;margin:-4px 0 12px">
            <button type="button" class="btn btn-soft btn-sm" data-quick="${t}">Today</button>
            <button type="button" class="btn btn-soft btn-sm" data-quick="${FB.util.addDays(t, 1)}">Tomorrow</button>
            <button type="button" class="btn btn-soft btn-sm" data-quick="${FB.util.addDays(t, 7)}">Next week</button>
          </div>
          <div class="row"><button type="submit" class="btn btn-primary btn-sm">Save</button>${card.due ? '<button type="button" class="btn btn-ghost btn-sm" data-remove>Remove</button>' : ''}</div></form>`;
        const form = $('form', body), input = $('input', form);
        FB.forms.liveClear(form);
        body.addEventListener('click', e => { const q = e.target.closest('[data-quick]'); if (q) { input.value = q.dataset.quick; FB.forms.setError(form, 'due', ''); } });
        const rm = $('[data-remove]', form);
        if (rm) rm.addEventListener('click', async () => { pop.close(); await act(FB.api.patch(`/api/cards/${cardId}`, { due: null }), 'Due date removed'); });
        form.addEventListener('submit', async e => {
          e.preventDefault();
          if (!input.value) { FB.forms.setError(form, 'due', 'Pick a date, or use Remove.'); input.focus(); return; }
          if (!FB.forms.validate(form, { due: 'due' })) return;
          const res = await FB.forms.busy($('button[type=submit]', form), () => FB.api.patch(`/api/cards/${cardId}`, { due: input.value }));
          if (res.busy) return;
          if (!res.ok) return FB.forms.serverError(form, res);
          pop.close();
          await reload(); store.refresh();
        });
      }
    });
  }

  function movePopover(anchor) {
    FB.popover.open(anchor, {
      title: 'Move card',
      render(body, pop) {
        const lists = store.state.lists.slice().sort((a, b) => a.position - b.position);
        body.innerHTML = `<form novalidate>
          <div class="field"><label for="mv-list">List</label><select class="select" id="mv-list" name="list">${lists.map(l => `<option value="${esc(l.id)}" ${l.id === card.listId ? 'selected' : ''}>${esc(l.name)}${l.id === card.listId ? ' (current)' : ''}</option>`).join('')}</select></div>
          <div class="field"><label for="mv-pos">Position</label><select class="select" id="mv-pos" name="pos"></select></div>
          <button type="submit" class="btn btn-primary btn-sm">Move</button></form>`;
        const form = $('form', body);
        const fill = () => {
          const lid = form.elements.list.value;
          const cards = store.cardsIn(lid);
          const same = lid === card.listId;
          const n = same ? cards.length : cards.length + 1;
          const cur = same ? cards.findIndex(c => c.id === card.id) : n - 1;
          form.elements.pos.innerHTML = Array.from({ length: Math.max(1, n) }, (_, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${i + 1}${same && i === cur ? ' (current)' : ''}</option>`).join('');
        };
        fill();
        form.elements.list.addEventListener('change', fill);
        form.addEventListener('submit', async e => {
          e.preventDefault();
          const listId = form.elements.list.value, index = Number(form.elements.pos.value);
          pop.close();
          const l = store.list(listId);
          await act(FB.api.post(`/api/cards/${cardId}/move`, { listId, index }), `Moved to ${l ? l.name : 'list'}`);
        });
      }
    });
  }

  // ——— Wiring ———
  function wire() {
    const el = modal.el;
    const ta = $('[data-title]', el);
    ta.addEventListener('input', () => { FB.util.autosize(ta); $('[data-title-err]', el).textContent = ''; });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); ta.blur(); }
      if (e.key === 'Escape' && ta.value !== card.title) { e.preventDefault(); ta.value = card.title; $('[data-title-err]', el).textContent = ''; FB.util.autosize(ta); ta.blur(); }
    });
    ta.addEventListener('blur', async () => {
      const v = ta.value.replace(/\s+/g, ' ').trim();
      if (v === card.title) { ta.value = card.title; return; }
      const err = FB.validate.rules.cardTitle(v);
      if (err) { $('[data-title-err]', el).textContent = err; ta.value = card.title; FB.util.autosize(ta); return; }
      await act(FB.api.patch(`/api/cards/${cardId}`, { title: v }));
    });

    const cform = $('[data-comment-form]', el), cta = $('textarea', cform);
    FB.forms.liveClear(cform);
    cta.addEventListener('input', () => FB.util.autosize(cta));
    cta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); cform.requestSubmit(); }
      if (e.key === 'Escape' && cta.value) { e.preventDefault(); cta.blur(); }
    });
    cform.addEventListener('submit', async e => {
      e.preventDefault();
      if (!FB.forms.validate(cform, { body: 'comment' })) return;
      const res = await FB.forms.busy($('button[type=submit]', cform), () => FB.api.post(`/api/cards/${cardId}/comments`, { body: cta.value.trim() }));
      if (res.busy) return;
      if (!res.ok) return FB.forms.serverError(cform, res);
      cta.value = ''; FB.util.autosize(cta);
      await reload(); store.refresh();
    });

    el.addEventListener('change', e => {
      if (e.target.matches('[data-toggle]')) {
        const id = e.target.closest('[data-item]').dataset.item;
        e.target.closest('.check-item').classList.toggle('done', e.target.checked);
        act(FB.api.patch(`/api/checklist/${id}`, { done: e.target.checked }));
      }
    });
    el.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-edit-item], .desc-empty')) { e.preventDefault(); e.target.click(); }
    });
    el.addEventListener('click', async e => {
      if (e.target.closest('.md a, .attach a')) return; // let links open
      const t = e.target.closest('[data-act], [data-edit-item], [data-del-item], [data-del-attach], [data-del-comment]');
      if (!t || !el.contains(t)) return;
      if (t.matches('[data-edit-item]')) return editItem(t.closest('[data-item]'));
      if (t.matches('[data-del-item]')) return act(FB.api.del(`/api/checklist/${t.closest('[data-item]').dataset.item}`));
      if (t.matches('[data-del-attach]')) return act(FB.api.del(`/api/attachments/${t.dataset.delAttach}`), 'Link removed');
      if (t.matches('[data-del-comment]')) {
        const ok = await FB.modal.confirm({ title: 'Delete comment?', message: 'This comment will be removed for everyone.', confirm: 'Delete', danger: true });
        if (ok) act(FB.api.del(`/api/comments/${t.dataset.delComment}`), 'Comment deleted');
        return;
      }
      switch (t.dataset.act) {
        case 'edit-desc': if (!e.target.closest('input[type=checkbox]')) editDesc(); break;
        case 'add-item': openItemForm(); break;
        case 'add-link': openAttachForm(); break;
        case 'labels': labelsPopover(t); break;
        case 'members': membersPopover(t); break;
        case 'due': duePopover(t); break;
        case 'move': movePopover(t); break;
        case 'blocked': act(FB.api.patch(`/api/cards/${cardId}`, { blocked: !card.blocked }), card.blocked ? 'Card unblocked' : 'Card marked as blocked'); break;
        case 'delete': {
          const ok = await FB.modal.confirm({ title: `Delete “${card.title}”?`, message: 'The card, its checklist, comments and links will be deleted for everyone.', confirm: 'Delete card', danger: true });
          if (!ok) return;
          const res = await FB.api.del(`/api/cards/${cardId}`);
          if (!res.ok) return FB.toast(res.error, { type: 'error' });
          gone = true;
          FB.toast('Card deleted');
          close('deleted');
          store.refresh();
          break;
        }
        default:
      }
    });
  }

  V.card = { open, close, current: () => cardId };
})(window.FB = window.FB || {});
