/* Flowboard modal dialogs: fade + scale in, Escape / backdrop to close, focus kept inside, focus restored.
   FB.modal.open({ title, body, foot, className, labelledBy, onClose }) -> { root, el, close }
   FB.modal.confirm({ title, message, confirm, danger }) -> Promise<boolean> */
(function (FB) {
  'use strict';
  const { esc } = FB.util;
  const stack = [];
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function open(opts) {
    const prev = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const id = 'm' + Math.random().toString(36).slice(2, 8);
    overlay.innerHTML = `<div class="modal ${opts.className || ''}" role="dialog" aria-modal="true" ${opts.title ? `aria-labelledby="${id}"` : ''} tabindex="-1">
      ${opts.title ? `<div class="modal-head"><h2 id="${id}">${esc(opts.title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${FB.icon('x')}</button></div>` : ''}
      ${opts.body != null ? `<div class="modal-body">${opts.body}</div>` : ''}
      ${opts.foot ? `<div class="modal-foot">${opts.foot}</div>` : ''}
      ${opts.raw || ''}
    </div>`;
    document.getElementById('overlays').appendChild(overlay);
    const el = overlay.firstElementChild;
    let closed = false;
    const api = { root: overlay, el, close };
    function close(reason) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), FB.util.reducedMotion() ? 0 : 200);
      if (prev && prev.focus && document.contains(prev)) { try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      if (opts.onClose) opts.onClose(reason);
    }
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.dataset.downOnBackdrop = '1'; else delete overlay.dataset.downOnBackdrop; });
    overlay.addEventListener('click', e => {
      if (e.target === overlay && overlay.dataset.downOnBackdrop) close('backdrop');
      if (e.target.closest('[data-close]')) close('button');
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const items = FB.util.$$(FOCUSABLE, el).filter(x => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    stack.push(api);
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      const auto = opts.focusDialog ? el : (el.querySelector('[autofocus]') || el.querySelector('input:not([type=checkbox]), textarea, select') || el);
      try { auto.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    });
    return api;
  }

  function confirm(opts) {
    return new Promise(resolve => {
      let answered = false;
      const m = open({
        title: opts.title || 'Are you sure?',
        body: `<p class="muted">${esc(opts.message || '')}</p>`,
        foot: `<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(opts.confirm || 'Confirm')}</button>`,
        onClose: () => { if (!answered) resolve(false); }
      });
      const ok = m.el.querySelector('[data-ok]');
      ok.addEventListener('click', () => { answered = true; resolve(true); m.close('ok'); });
      setTimeout(() => ok.focus(), 30);
    });
  }

  // Escape closes the top-most popover first, then the top-most modal.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (FB.popover && FB.popover.current()) { FB.popover.close(); e.preventDefault(); return; }
    const top = stack[stack.length - 1];
    if (top) { e.preventDefault(); top.close('escape'); }
  });

  FB.modal = { open, confirm, top: () => stack[stack.length - 1] || null };
})(window.FB = window.FB || {});
