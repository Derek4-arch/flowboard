/* Applies the saved theme before first paint (light by default). A file, not inline, so CSP can forbid inline scripts. */
(function () {
  try {
    var t = localStorage.getItem('fb_theme');
    document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
  } catch (e) { document.documentElement.dataset.theme = 'light'; }
})();
