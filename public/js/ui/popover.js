/* Flowboard popovers anchored to a button (one at a time). Close on outside click, Escape or resize.
   FB.popover.open(anchor, { title, render(body, api) }) -> api { el, body, close, reposition } */
(function (FB) {
  'use strict';
  let cur = null;
  function close() {
    if (!cur) return;
    const c = cur; cur = null;
    c.el.classList.remove('is-open');
    setTimeout(() => c.el.remove(), FB.util.reducedMotion() ? 0 : 150);
    if (c.anchor && document.contains(c.anchor)) { c.anchor.setAttribute('aria-expanded', 'false'); try { c.anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    if (c.onClose) c.onClose();
  }
  function position(el, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight, vw = innerWidth, vh = innerHeight;
    let left = Math.min(Math.max(8, r.left), vw - w - 8);
    let top = r.bottom + 6;
    if (top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    top = Math.max(8, Math.min(top, vh - h - 8));
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  function open(anchor, opts) {
    const wasSame = cur && cur.anchor === anchor;
    close();
    if (wasSame && !opts.reopen) return null;
    const el = document.createElement('div');
    el.className = 'popover';
    el.setAttribute('role', 'dialog');
    el.innerHTML = `<div class="pop-head"><h3>${FB.util.esc(opts.title || '')}</h3><button type="button" class="icon-btn" data-pop-close aria-label="Close">${FB.icon('x')}</button></div><div class="pop-body"></div>`;
    if (opts.width) el.style.width = opts.width + 'px';
    document.body.appendChild(el);
    const api = { el, anchor, body: el.querySelector('.pop-body'), close, reposition: () => position(el, anchor), onClose: opts.onClose };
    cur = api;
    anchor.setAttribute('aria-expanded', 'true');
    el.querySelector('[data-pop-close]').addEventListener('click', close);
    opts.render(api.body, api);
    position(el, anchor);
    requestAnimationFrame(() => {
      el.classList.add('is-open');
      const f = el.querySelector('[autofocus]') || el.querySelector('.pop-body input:not([type=checkbox]):not([type=radio]), .pop-body select, .pop-body textarea');
      if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    });
    return api;
  }
  document.addEventListener('pointerdown', e => {
    if (!cur) return;
    if (cur.el.contains(e.target) || cur.anchor.contains(e.target)) return;
    if (e.target.closest('.popover')) return;
    close();
  }, true);
  addEventListener('resize', () => { if (cur) cur.reposition(); });
  FB.popover = { open, close, current: () => cur };
})(window.FB = window.FB || {});
