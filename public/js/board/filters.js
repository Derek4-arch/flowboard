/* Flowboard search & filters (client side): text, labels, members, due date and blocked status.
   FB.filters.apply(canvas) hides cards that don't match and updates the filter bar. */
(function (FB) {
  'use strict';
  const { esc, todayStr, addDays } = FB.util;
  const F = { q: '', labels: new Set(), members: new Set(), due: '', blocked: false };

  F.reset = () => { F.q = ''; F.labels.clear(); F.members.clear(); F.due = ''; F.blocked = false; };
  F.count = () => F.labels.size + F.members.size + (F.due ? 1 : 0) + (F.blocked ? 1 : 0);
  F.active = () => !!F.q.trim() || F.count() > 0;

  const BLOCKED = /^\s*blocked\s*$/i;
  F.isBlocked = card => card.blocked || card.labelIds.some(id => { const l = FB.store.label(id); return l && BLOCKED.test(l.name); });

  F.matches = function (card) {
    const words = F.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      const hay = (card.title + ' ' + (card.description || '')).toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    if (F.labels.size && !card.labelIds.some(id => F.labels.has(id))) return false;
    if (F.members.size && !(card.assigneeIds.some(id => F.members.has(id)) || (F.members.has('none') && !card.assigneeIds.length))) return false;
    if (F.due) {
      const today = todayStr(), d = card.due, list = FB.store.list(card.listId), done = list && list.isDone;
      if (F.due === 'overdue' && !(d && d < today && !done)) return false;
      if (F.due === 'today' && d !== today) return false;
      if (F.due === 'week' && !(d && d >= today && d <= addDays(today, 7))) return false;
      if (F.due === 'none' && d) return false;
    }
    if (F.blocked && !F.isBlocked(card)) return false;
    return true;
  };

  F.apply = function (root) {
    if (!root || !FB.store.state) return;
    let shown = 0, total = 0;
    FB.util.$$('.list', root).forEach(listEl => {
      let visible = 0, n = 0;
      FB.util.$$('.cards > .card', listEl).forEach(el => {
        const card = FB.store.card(el.dataset.cardId);
        if (!card) return;
        n++;
        const ok = F.matches(card);
        el.classList.toggle('filtered-out', !ok);
        if (ok) visible++;
      });
      total += n; shown += visible;
      const empty = listEl.querySelector('.list-empty-filter');
      if (empty) empty.hidden = !(F.active() && n > 0 && visible === 0);
    });
    const page = root.closest('.board-page');
    if (!page) return;
    const bar = page.querySelector('[data-filter-bar]');
    if (bar) {
      bar.hidden = !F.active();
      const txt = bar.querySelector('[data-filter-text]');
      if (txt) txt.textContent = `Showing ${shown} of ${total} card${total === 1 ? '' : 's'}`;
    }
    const pill = page.querySelector('[data-filter-count]');
    if (pill) { pill.hidden = !F.count(); pill.textContent = F.count(); }
  };

  F.openPopover = function (anchor) {
    FB.popover.open(anchor, {
      title: 'Filter cards',
      render(body) {
        const st = FB.store.state;
        const dueOpts = [['', 'Any due date'], ['overdue', 'Overdue'], ['today', 'Due today'], ['week', 'Due in the next 7 days'], ['none', 'No due date']];
        body.innerHTML = `
          <div class="pop-sub">Labels</div>
          <div class="pop-list">${st.labels.map(l => `<label class="pop-row"><input type="checkbox" data-f-label="${esc(l.id)}" ${F.labels.has(l.id) ? 'checked' : ''}><span class="lbl-bar lbl-${esc(l.color)}">${esc(l.name)}</span></label>`).join('') || '<div class="muted small">No labels yet.</div>'}</div>
          <div class="pop-sub">Members</div>
          <div class="pop-list">
            <label class="pop-row"><input type="checkbox" data-f-member="none" ${F.members.has('none') ? 'checked' : ''}><span class="avatar avatar-sm" style="--av:var(--faint)">?</span><span class="grow">No members</span></label>
            ${st.members.map(m => `<label class="pop-row"><input type="checkbox" data-f-member="${esc(m.id)}" ${F.members.has(m.id) ? 'checked' : ''}>${FB.util.avatar(m, 'avatar-sm')}<span class="grow">${esc(m.name)}</span></label>`).join('')}
          </div>
          <div class="pop-sub">Due date</div>
          <div class="pop-list">${dueOpts.map(([v, t]) => `<label class="pop-row"><input type="radio" name="f-due" value="${v}" ${F.due === v ? 'checked' : ''}><span class="grow">${t}</span></label>`).join('')}</div>
          <div class="pop-sub">Status</div>
          <div class="pop-list"><label class="pop-row"><input type="checkbox" data-f-blocked ${F.blocked ? 'checked' : ''}><span class="grow">Blocked cards only</span></label></div>
          <button type="button" class="btn btn-soft btn-block" data-f-clear>Clear filters</button>`;
        body.addEventListener('change', e => {
          const t = e.target;
          if (t.dataset.fLabel) (t.checked ? F.labels.add(t.dataset.fLabel) : F.labels.delete(t.dataset.fLabel));
          else if (t.dataset.fMember) (t.checked ? F.members.add(t.dataset.fMember) : F.members.delete(t.dataset.fMember));
          else if (t.name === 'f-due') F.due = t.value;
          else if ('fBlocked' in t.dataset) F.blocked = t.checked;
          FB.emit('filters');
        });
        body.querySelector('[data-f-clear]').addEventListener('click', () => {
          F.labels.clear(); F.members.clear(); F.due = ''; F.blocked = false;
          FB.util.$$('input', body).forEach(i => { i.checked = i.type === 'radio' && i.value === ''; });
          FB.emit('filters');
        });
      }
    });
  };

  FB.filters = F;
})(window.FB = window.FB || {});
