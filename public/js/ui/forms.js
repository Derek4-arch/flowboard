/* Flowboard form helpers: field markup, inline validation (shared rules), server error mapping, busy buttons. */
(function (FB) {
  'use strict';
  const { esc } = FB.util;
  let n = 0;
  const F = {};

  // <div class="field" data-field="name"> label · input · error </div>
  F.field = function (o) {
    const id = 'f' + (++n) + '-' + o.name;
    const attrs = [`id="${id}"`, `name="${esc(o.name)}"`, `aria-describedby="${id}-err"`];
    if (o.placeholder) attrs.push(`placeholder="${esc(o.placeholder)}"`);
    if (o.autocomplete) attrs.push(`autocomplete="${esc(o.autocomplete)}"`);
    if (o.maxlength) attrs.push(`maxlength="${o.maxlength}"`);
    if (o.autofocus) attrs.push('autofocus');
    if (o.ariaLabel) attrs.push(`aria-label="${esc(o.ariaLabel)}"`);
    if (o.type === 'date') attrs.push('min="2000-01-01" max="2100-12-31"');
    const control = o.textarea
      ? `<textarea class="textarea" ${attrs.join(' ')} rows="${o.rows || 3}">${esc(o.value || '')}</textarea>`
      : `<input class="input" type="${o.type || 'text'}" ${attrs.join(' ')} value="${esc(o.value || '')}">`;
    return `<div class="field" data-field="${esc(o.name)}">${o.label ? `<label for="${id}">${esc(o.label)}</label>` : ''}${control}${o.hint ? `<div class="field-hint">${esc(o.hint)}</div>` : ''}<div class="field-error" id="${id}-err" role="alert"></div></div>`;
  };

  F.setError = function (form, name, msg) {
    const f = form.querySelector(`[data-field="${name}"]`);
    if (!f) { F.formError(form, msg); return; }
    f.classList.toggle('invalid', !!msg);
    const ctl = f.querySelector('input, textarea, select');
    if (ctl) ctl.setAttribute('aria-invalid', msg ? 'true' : 'false');
    const err = f.querySelector('.field-error');
    if (err) err.textContent = msg || '';
  };
  F.formError = function (form, msg) {
    let box = form.querySelector('.form-error');
    if (!box) { box = document.createElement('div'); box.className = 'form-error'; box.setAttribute('role', 'alert'); form.prepend(box); }
    box.textContent = msg || '';
  };
  F.clear = function (form) {
    FB.util.$$('.field', form).forEach(f => F.setError(form, f.dataset.field, ''));
    F.formError(form, '');
  };
  // map: { fieldName: ruleName }. Returns true when valid; shows inline errors and focuses the first invalid field.
  F.validate = function (form, map) {
    const values = F.values(form);
    const errors = FB.validate.check(values, map);
    Object.keys(map).forEach(k => F.setError(form, k, errors[k] || ''));
    const first = Object.keys(map).find(k => errors[k]);
    if (first) { const el = form.querySelector(`[name="${first}"]`); if (el) el.focus(); return false; }
    return true;
  };
  F.values = form => Object.fromEntries(new FormData(form).entries());
  // Show a server response error inline (on its field when the server names one).
  F.serverError = function (form, res) {
    if (res && res.field && form.querySelector(`[data-field="${res.field}"]`)) { F.setError(form, res.field, res.error); const el = form.querySelector(`[name="${res.field}"]`); if (el) el.focus(); }
    else F.formError(form, (res && res.error) || 'Something went wrong.');
  };
  // Clears a field's error as soon as the user edits it.
  F.liveClear = function (form) {
    form.addEventListener('input', e => { const f = e.target.closest('.field'); if (f && f.classList.contains('invalid')) F.setError(form, f.dataset.field, ''); });
  };
  F.busy = async function (btn, fn) {
    if (!btn) return fn();
    if (btn.disabled) return { ok: false, busy: true };
    btn.disabled = true; btn.classList.add('is-busy');
    try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
  };
  FB.forms = F;
})(window.FB = window.FB || {});
