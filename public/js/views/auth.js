/* Flowboard sign-in and sign-up pages with inline validation. */
(function (FB) {
  'use strict';
  const { esc } = FB.util;
  const V = FB.views = FB.views || {};

  function demoBox() {
    if (!FB.config || !FB.config.demo) return '';
    return `<div class="demo-box" data-demo>
      <div><b>Demo accounts</b> (password <code>flowboard123</code>)</div>
      <div><code>maya@example.com</code> · <code>sam@example.com</code> · <code>priya@example.com</code></div>
      <button type="button" class="btn btn-soft btn-sm" data-action="use-demo">Use demo account (Maya)</button>
    </div>`;
  }

  async function finish(res) {
    FB.me = res.user;
    FB.emit('me', FB.me);
    const next = sessionStorage.getItem('fb_next');
    sessionStorage.removeItem('fb_next');
    location.hash = next && next.startsWith('#/b/') ? next : '#/boards';
  }

  V.signin = function (main) {
    document.title = 'Sign in · Flowboard';
    main.innerHTML = `<div class="auth-wrap"><div class="auth-card">
      <h1>Welcome back</h1>
      <p class="sub">Sign in to your boards.</p>
      <form novalidate data-form="signin">
        ${FB.forms.field({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com', autofocus: true })}
        ${FB.forms.field({ name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}
        <button type="submit" class="btn btn-primary btn-block">Sign in</button>
      </form>
      <p class="auth-alt">New to Flowboard? <a href="#/signup">Create an account</a></p>
      ${demoBox()}
    </div></div>`;
    const form = main.querySelector('form');
    FB.forms.liveClear(form);
    const demo = main.querySelector('[data-action="use-demo"]');
    if (demo) demo.addEventListener('click', () => {
      form.email.value = 'maya@example.com';
      form.password.value = 'flowboard123';
      FB.forms.clear(form);
      form.querySelector('button[type=submit]').focus();
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      FB.forms.formError(form, '');
      if (!FB.forms.validate(form, { email: 'email', password: 'signinPassword' })) return;
      const btn = form.querySelector('button[type=submit]');
      const res = await FB.forms.busy(btn, () => FB.api.post('/api/auth/signin', FB.forms.values(form)));
      if (res.ok) return finish(res);
      if (res.busy) return;
      FB.forms.formError(form, res.error || 'Sign-in failed.');
      if (res.code === 'bad_credentials') { form.password.select(); form.password.focus(); }
    });
  };

  V.signup = function (main) {
    document.title = 'Create account · Flowboard';
    main.innerHTML = `<div class="auth-wrap"><div class="auth-card">
      <h1>Create your account</h1>
      <p class="sub">Plan work on calm, live kanban boards.</p>
      <form novalidate data-form="signup">
        ${FB.forms.field({ name: 'name', label: 'Full name', autocomplete: 'name', placeholder: 'Alex Morgan', autofocus: true, maxlength: 60 })}
        ${FB.forms.field({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' })}
        ${FB.forms.field({ name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters.' })}
        <button type="submit" class="btn btn-primary btn-block">Create account</button>
      </form>
      <p class="auth-alt">Already have an account? <a href="#/signin">Sign in</a></p>
    </div></div>`;
    const form = main.querySelector('form');
    FB.forms.liveClear(form);
    // Validate a field when the user leaves it (after they've typed something).
    form.addEventListener('focusout', e => {
      const t = e.target;
      if (!t.name || !t.value) return;
      const rule = { name: 'name', email: 'email', password: 'password' }[t.name];
      FB.forms.setError(form, t.name, FB.validate.rules[rule](t.value));
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      FB.forms.formError(form, '');
      if (!FB.forms.validate(form, { name: 'name', email: 'email', password: 'password' })) return;
      const btn = form.querySelector('button[type=submit]');
      const res = await FB.forms.busy(btn, () => FB.api.post('/api/auth/signup', FB.forms.values(form)));
      if (res.ok) { FB.toast(`Welcome to Flowboard, ${res.user.name.split(' ')[0]}!`); return finish(res); }
      if (!res.busy) FB.forms.serverError(form, res);
    });
  };
})(window.FB = window.FB || {});
