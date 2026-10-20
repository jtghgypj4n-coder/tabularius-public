// Runs before the page is drawn: applies a colour scheme the reader chose, so a dark choice does not flash light.
(function () {
  try {
    var saved = window.localStorage.getItem('tabularius-docs-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch (e) { /* Storage can be blocked; the system's setting applies. */ }
})();
