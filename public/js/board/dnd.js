/* Flowboard drag and drop built on Pointer Events, so the same code handles mouse, pen and touch.
   Cards and lists. Mouse/pen drags start after a 5 px move; touch drags start after a ~220 ms long-press
   (a quick swipe still scrolls the board). The original element stays in the DOM as the placeholder and a
   clone follows the pointer. Neighbours slide out of the way with a FLIP animation. Escape cancels.
   FB.dnd.init(canvas, { onCardDrop(cardId, listId, index), onListDrop(listId, index) }) */
(function (FB) {
  'use strict';
  const D = { active: false };
  const THRESHOLD = 5, LONGPRESS = 220, TOUCH_SLOP = 8, EDGE = 56;
  let canvas = null, opts = {}, pend = null, drag = null, dropAt = 0, raf = 0;

  // FLIP: animate elements from their old position to the new one after `mutate` changes the layout.
  D.flip = function (els, mutate) {
    if (FB.util.reducedMotion()) { mutate(); return; }
    const first = new Map(els.map(n => [n, n.getBoundingClientRect()]));
    mutate();
    els.forEach(n => {
      const a = first.get(n);
      if (!a || !n.isConnected) return;
      const b = n.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      n.style.transition = 'none';
      n.style.transform = `translate(${dx}px, ${dy}px)`;
      n.getBoundingClientRect();
      n.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)';
      n.style.transform = '';
      clearTimeout(n._flipT);
      n._flipT = setTimeout(() => { n.style.transition = ''; }, 240);
    });
  };

  D.init = function (canvasEl, o) {
    canvas = canvasEl; opts = o || {};
    canvas.addEventListener('pointerdown', onDown);
    // Swallow the click that follows a drop so the card modal doesn't open.
    canvas.addEventListener('click', e => { if (Date.now() - dropAt < 350) { e.preventDefault(); e.stopPropagation(); } }, true);
    canvas.addEventListener('dragstart', e => e.preventDefault());
    canvas.addEventListener('contextmenu', e => { if ((pend && pend.touch) || drag) e.preventDefault(); });
  };

  function onDown(e) {
    if (drag || pend || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('input, textarea, select, .composer, .icon-btn, [data-no-drag]')) return;
    const card = e.target.closest('.card');
    const head = !card && e.target.closest('.list-head');
    if (!card && !head) return;
    const el = card || head.closest('.list');
    if (!el || !el.dataset || !(el.dataset.cardId || el.dataset.listId)) return;
    pend = { el, kind: card ? 'card' : 'list', x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch', timer: 0 };
    if (pend.touch) {
      pend.timer = setTimeout(() => { if (pend) { pend.el.classList.add('lifting'); start(pend.x, pend.y); } }, LONGPRESS);
    }
  }
  function cancelPending() { if (pend) { clearTimeout(pend.timer); pend.el.classList.remove('lifting'); pend = null; } }

  function start(x, y) {
    const p = pend; pend = null;
    clearTimeout(p.timer);
    // The board may have re-rendered since pointerdown (e.g. a live update): use the fresh element.
    if (!p.el.isConnected) {
      const sel = p.kind === 'card' ? `.card[data-card-id="${CSS.escape(p.el.dataset.cardId)}"]` : `.list[data-list-id="${CSS.escape(p.el.dataset.listId)}"]`;
      p.el = canvas && canvas.querySelector(sel);
      if (!p.el) return;
    }
    const el = p.el;
    el.classList.remove('lifting');
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('tabindex');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    document.body.appendChild(ghost);
    el.classList.add('drag-placeholder');
    drag = { el, ghost, kind: p.kind, id: p.id, x, y, offX: x - r.left, offY: y - r.top, origParent: el.parentNode, origNext: el.nextSibling, origIndex: indexOf(el, p.kind), origList: listIdOf(el, p.kind) };
    D.active = true;
    document.body.classList.add('is-dragging');
    FB.emit('dnd-start', { kind: p.kind });
    move(x, y);
    raf = requestAnimationFrame(autoScroll);
  }

  const siblingsOf = (el, kind) => kind === 'card'
    ? Array.from(el.parentNode.children).filter(n => n.classList.contains('card') && !n.classList.contains('drag-ghost'))
    : Array.from(el.parentNode.children).filter(n => n.classList.contains('list') && !n.classList.contains('drag-ghost'));
  const indexOf = (el, kind) => siblingsOf(el, kind).indexOf(el);
  const listIdOf = (el, kind) => (kind === 'card' ? el.closest('.list').dataset.listId : null);

  function move(x, y) {
    drag.x = x; drag.y = y;
    drag.ghost.style.left = (x - drag.offX) + 'px';
    drag.ghost.style.top = (y - drag.offY) + 'px';
    place();
  }

  // Moves the placeholder (the original element) to where the pointer is.
  function place() {
    const { el, x, y } = drag;
    const lists = Array.from(canvas.querySelectorAll(':scope > .list'));
    if (drag.kind === 'card') {
      let target = lists.find(l => { const r = l.getBoundingClientRect(); return x >= r.left && x <= r.right; });
      if (!target) target = lists.slice().sort((a, b) => dist(a, x) - dist(b, x))[0];
      if (!target) return;
      const box = target.querySelector('.cards');
      const cards = Array.from(box.children).filter(n => n.classList.contains('card') && n !== el && !n.classList.contains('filtered-out'));
      const before = cards.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
      if (before ? (el.nextElementSibling === before && el.parentNode === box) : (el.parentNode === box && !nextCard(el))) return;
      const affected = Array.from(new Set([...cardsOf(el.parentNode), ...cardsOf(box)])).filter(n => n !== el);
      D.flip(affected, () => { if (before) box.insertBefore(el, before); else box.insertBefore(el, trailing(box)); });
    } else {
      const others = lists.filter(l => l !== el);
      const before = others.find(l => { const r = l.getBoundingClientRect(); return x < r.left + r.width / 2; });
      const anchor = before || canvas.querySelector(':scope > .add-list');
      if (el.nextElementSibling === anchor) return;
      D.flip(others, () => canvas.insertBefore(el, anchor));
    }
  }
  const dist = (el, x) => { const r = el.getBoundingClientRect(); return Math.min(Math.abs(x - r.left), Math.abs(x - r.right)); };
  const cardsOf = box => Array.from(box.children).filter(n => n.classList.contains('card'));
  const nextCard = el => { let n = el.nextElementSibling; while (n && !n.classList.contains('card')) n = n.nextElementSibling; return n; };
  const trailing = box => Array.from(box.children).find(n => !n.classList.contains('card')) || null;

  function autoScroll() {
    if (!drag) return;
    const { x, y } = drag;
    const cr = canvas.getBoundingClientRect();
    let moved = false;
    const speed = d => Math.ceil(Math.min(18, (EDGE - d) / 3 + 2));
    if (x < cr.left + EDGE && canvas.scrollLeft > 0) { canvas.scrollLeft -= speed(x - cr.left); moved = true; }
    else if (x > cr.right - EDGE && canvas.scrollLeft < canvas.scrollWidth - canvas.clientWidth) { canvas.scrollLeft += speed(cr.right - x); moved = true; }
    if (drag.kind === 'card') {
      const box = drag.el.parentNode;
      if (box && box.classList.contains('cards')) {
        const br = box.getBoundingClientRect();
        if (y < br.top + 36 && box.scrollTop > 0) { box.scrollTop -= speed(Math.max(0, y - br.top) + 20); moved = true; }
        else if (y > br.bottom - 36 && box.scrollTop < box.scrollHeight - box.clientHeight) { box.scrollTop += speed(Math.max(0, br.bottom - y) + 20); moved = true; }
      }
    }
    if (moved) place();
    raf = requestAnimationFrame(autoScroll);
  }

  function end(cancel) {
    cancelAnimationFrame(raf);
    const d = drag; drag = null;
    D.active = false;
    document.body.classList.remove('is-dragging');
    if (cancel && d.origParent.isConnected) {
      d.origParent.insertBefore(d.el, d.origNext && d.origNext.parentNode === d.origParent ? d.origNext : null);
    }
    const listId = listIdOf(d.el, d.kind), index = indexOf(d.el, d.kind);
    const changed = !cancel && (index !== d.origIndex || listId !== d.origList);
    dropAt = Date.now();
    const finish = () => {
      d.ghost.remove();
      d.el.classList.remove('drag-placeholder');
      if (changed) {
        const id = d.kind === 'card' ? d.el.dataset.cardId : d.el.dataset.listId;
        if (d.kind === 'card' && opts.onCardDrop) opts.onCardDrop(id, listId, index);
        if (d.kind === 'list' && opts.onListDrop) opts.onListDrop(id, index);
      }
      FB.emit('dnd-end', { changed });
    };
    if (FB.util.reducedMotion() || !d.el.isConnected) { finish(); return; }
    // Glide the ghost into its slot, then reveal the real element.
    const r = d.el.getBoundingClientRect();
    d.ghost.style.transition = 'left .16s cubic-bezier(.2,.8,.2,1), top .16s cubic-bezier(.2,.8,.2,1), transform .16s';
    d.ghost.style.left = r.left + 'px';
    d.ghost.style.top = r.top + 'px';
    d.ghost.style.transform = 'none';
    setTimeout(finish, 170);
  }

  addEventListener('pointermove', e => {
    if (pend && e.pointerId === pend.id) {
      const moved = Math.hypot(e.clientX - pend.x, e.clientY - pend.y);
      if (pend.touch) { if (moved > TOUCH_SLOP) cancelPending(); }
      else if (moved > THRESHOLD) start(e.clientX, e.clientY);
    } else if (drag && e.pointerId === drag.id) {
      e.preventDefault();
      move(e.clientX, e.clientY);
    }
  }, { passive: false });
  addEventListener('pointerup', e => {
    if (pend && e.pointerId === pend.id) cancelPending();
    else if (drag && e.pointerId === drag.id) end(false);
  });
  addEventListener('pointercancel', e => {
    if (pend && e.pointerId === pend.id) cancelPending();
    else if (drag && e.pointerId === drag.id) end(true);
  });
  // Once a touch drag has started, stop the page from scrolling under the finger.
  document.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
  addEventListener('keydown', e => { if (drag && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(true); } }, true);
  addEventListener('blur', () => { if (drag) end(true); cancelPending(); });

  FB.dnd = D;
})(window.FB = window.FB || {});
