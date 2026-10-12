/* Flowboard app shell: boot (config + session), hash router, theme toggle, account menu. */
(function (FB) {
  'use strict';
  const { esc } = FB.util;
  const main = document.getElementById('main');
  let current = null; // 'signin' | 'signup' | 'home' | 'board'

  // ——— Theme ———
  const themeBtn = document.querySelector('[data-action="toggle-theme"]');
  function paintThemeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeBtn.innerHTML = FB.icon(dark ? 'sun' : 'moon');
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeBtn.title = dark ? 'Light theme' : 'Dark theme';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#171A21' : '#FFFFFF';
  }
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('fb_theme', next); } catch (e) { /* private mode */ }
    paintThemeButton();
  });
  paintThemeButton();

  // ——— Account menu ———
  const account = document.querySelector('[data-account]');
  const topnav = document.querySelector('[data-topnav]');
  function paintAccount() {
    topnav.hidden = !FB.me;
    if (!FB.me) { account.innerHTML = ''; return; }
    account.innerHTML = `<button type="button" class="account-btn" data-account-btn aria-label="Account menu for ${esc(FB.me.name)}" aria-haspopup="true">${FB.util.avatar(FB.me)}</button>`;
  }
  account.addEventListener('click', e => {
    const btn = e.target.closest('[data-account-btn]');
    if (!btn) return;
    FB.popover.open(btn, {
      title: 'Account', width: 260,
      render(body, pop) {
        body.innerHTML = `<div class="menu" style="padding:0;min-width:0">
          <div class="menu-head"><b>${esc(FB.me.name)}</b><div class="muted small">${esc(FB.me.email)}</div></div>
          <a class="menu-item" href="#/boards" data-m="boards">${FB.icon('board')} Your boards</a>
          <button type="button" class="menu-item" data-m="theme">${FB.icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')} ${document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'} theme</button>
          <div class="menu-sep"></div>
          <button type="button" class="menu-item danger" data-m="signout">${FB.icon('logout')} Sign out</button></div>`;
        body.addEventListener('click', async ev => {
          const it = ev.target.closest('[data-m]');
          if (!it) return;
          pop.close();
          if (it.dataset.m === 'theme') themeBtn.click();
          if (it.dataset.m === 'signout') signOut();
        });
      }
    });
  });
  async function signOut() {
    await FB.api.post('/api/auth/signout');
    leaveBoard();
    FB.me = null;
    paintAccount();
    FB.toast('Signed out');
    location.hash = '#/signin';
  }

  function leaveBoard() {
    if (FB.views.card) FB.views.card.close('route');
    if (current === 'board') FB.views.board.unmount();
  }

  // ——— Router ———
  async function route() {
    const hash = location.hash || '#/';
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    FB.popover.close();
    const go = h => { location.replace(h); };

    if (!FB.me) {
      if (parts[0] === 'b') sessionStorage.setItem('fb_next', hash);
      if (parts[0] === 'signup') return show('signup', () => FB.views.signup(main));
      if (parts[0] !== 'signin') return go('#/signin');
      return show('signin', () => FB.views.signin(main));
    }
    if (parts[0] === 'b' && parts[1]) {
      const boardId = parts[1], cardId = parts[2] === 'c' ? parts[3] : null;
      if (current !== 'board' || FB.views.board.id() !== boardId) {
        closeOverlays();
        current = 'board';
        await FB.views.board.mount(main, boardId);
        if (location.hash !== hash) return undefined; // navigated away while loading
      }
      if (!FB.views.board.id()) { FB.views.card.close('route'); return undefined; } // board failed to load
      if (cardId) FB.views.card.open(boardId, cardId);
      else FB.views.card.close('route');
      return undefined;
    }
    if (parts[0] === 'boards') return show('home', () => FB.views.home(main));
    return go('#/boards');
  }
  function closeOverlays() {
    if (FB.views.card) FB.views.card.close('route');
    document.getElementById('overlays').innerHTML = '';
  }
  function show(name, fn) {
    leaveBoard();
    closeOverlays();
    current = name;
    main.innerHTML = '';
    fn();
    window.scrollTo(0, 0);
  }

  FB.on('auth-expired', () => {
    if (!FB.me) return;
    FB.me = null;
    leaveBoard();
    paintAccount();
    FB.toast('Your session has ended. Please sign in again.', { type: 'error' });
    if (location.hash.startsWith('#/b/')) sessionStorage.setItem('fb_next', location.hash);
    location.hash = '#/signin';
  });
  FB.on('me', () => paintAccount());

  // ——— Boot ———
  (async function boot() {
    main.innerHTML = '<div class="page-center"><div class="spinner" aria-label="Loading"></div></div>';
    const [cfg, me] = await Promise.all([FB.api.get('/api/config'), FB.api.get('/api/me')]);
    FB.config = cfg.ok ? cfg : { ai: { enabled: false }, demo: false };
    if (!me.ok && me.network) {
      main.innerHTML = `<div class="page-center"><div><h1>Can’t reach Flowboard</h1><p>${esc(me.error)}</p><p style="margin-top:16px"><button type="button" class="btn" data-reload>Try again</button></p></div></div>`;
      main.querySelector('[data-reload]').addEventListener('click', () => location.reload());
      return;
    }
    FB.me = me.user || null;
    paintAccount();
    addEventListener('hashchange', route);
    route();
  })();
})(window.FB = window.FB || {});
