/* Flowboard toasts: FB.toast(message, { type: 'error', action: { label, run } }). */
(function (FB) {
  'use strict';
  FB.toast = function (message, opts) {
    opts = opts || {};
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (opts.type === 'error' ? ' error' : '');
    el.innerHTML = `<span>${FB.util.esc(message)}</span>`;
    if (opts.action) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = opts.action.label;
      b.addEventListener('click', () => { opts.action.run(); remove(); });
      el.appendChild(b);
    }
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    let gone = false;
    function remove() { if (gone) return; gone = true; el.classList.add('leaving'); setTimeout(() => el.remove(), 220); }
    setTimeout(remove, opts.duration || (opts.type === 'error' ? 5200 : 3200));
    return remove;
  };
})(window.FB = window.FB || {});
