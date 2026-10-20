// Behaviour for the documentation pages: search, the colour-scheme button, copy buttons for code and the contents box on
// narrow screens. Without it the pages still read and link as they are; nothing here makes a network request (the search
// index is a script beside the pages, loaded when the search box is first used so it also works from file://).
(function () {
  'use strict';
  var script = document.currentScript || document.querySelector('script[src$="assets/site.js"]');
  var assets = new URL('.', script.src).href;

  // ---- colour scheme: system, light or dark -----------------------------------------------------------------------
  var themeButton = document.getElementById('theme');
  function show() {
    var choice = document.documentElement.getAttribute('data-theme') || 'system';
    themeButton.textContent = choice === 'system' ? 'Auto' : choice === 'dark' ? 'Dark' : 'Light';
    themeButton.setAttribute('aria-label', themeButton.textContent + ', colour scheme. Press to change.');
  }
  if (themeButton) {
    themeButton.hidden = false;
    show();
    themeButton.addEventListener('click', function () {
      var now = document.documentElement.getAttribute('data-theme') || '';
      var next = now === '' ? 'light' : now === 'light' ? 'dark' : '';
      if (next) document.documentElement.setAttribute('data-theme', next); else document.documentElement.removeAttribute('data-theme');
      try { if (next) window.localStorage.setItem('tabularius-docs-theme', next); else window.localStorage.removeItem('tabularius-docs-theme'); } catch (e) { /* Not saved. */ }
      show();
    });
  }

  // ---- copy buttons on code blocks ----------------------------------------------------------------------------------
  Array.prototype.forEach.call(document.querySelectorAll('.code-block'), function (block) {
    var button = block.querySelector('button.copy');
    var code = block.querySelector('pre');
    if (!button || !code) return;
    button.hidden = false;
    button.setAttribute('aria-label', 'Copy this code');
    button.addEventListener('click', function () {
      var text = code.textContent || '';
      var settled = false;
      function done(ok) {
        if (settled) return;
        settled = true;
        button.textContent = ok ? 'Copied' : 'Press Ctrl+C';
        if (!ok) { var range = document.createRange(); range.selectNodeContents(code); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
        window.setTimeout(function () { button.textContent = 'Copy'; }, 1800);
      }
      // The older way works where the clipboard API is not allowed (a page opened from disk); the API may also wait on a prompt.
      function legacy() {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(area);
        return ok;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        var timer = window.setTimeout(function () { done(legacy()); }, 1500);
        navigator.clipboard.writeText(text).then(function () { window.clearTimeout(timer); done(true); }, function () { window.clearTimeout(timer); done(legacy()); });
      } else done(legacy());
    });
  });

  // ---- the contents box: open on a wide screen, closed on a narrow one --------------------------------------------
  var navBox = document.getElementById('nav-box');
  if (navBox) {
    var narrow = window.matchMedia('(max-width: 899px)');
    var apply = function () { navBox.open = !narrow.matches; };
    apply();
    if (narrow.addEventListener) narrow.addEventListener('change', apply);
  }
  // The page you are on, in view in the menu.
  var current = document.querySelector('.site-nav [aria-current="page"]');
  if (current && current.scrollIntoView) { try { current.scrollIntoView({ block: 'nearest' }); } catch (e) { /* Older browsers. */ } }

  // ---- search ------------------------------------------------------------------------------------------------------
  var form = document.querySelector('form.search');
  var input = document.getElementById('q');
  var panel = document.getElementById('search-results');
  var status = document.getElementById('search-status');
  if (!form || !input || !panel || !window.TabulariusDocsSearch) return;
  form.hidden = false;
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  var engine = window.TabulariusDocsSearch;
  var index = null;
  var loading = null;

  function load() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = assets + 'search-index.js';
      s.onload = function () { index = window.TabulariusDocsIndex; resolve(index); };
      s.onerror = function () { reject(new Error('The search index did not load.')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function close() {
    panel.hidden = true;
    panel.textContent = '';
  }

  function mark(parent, text, terms) {
    engine.segments(text, terms).forEach(function (piece) {
      if (piece.match) { var m = document.createElement('mark'); m.textContent = piece.text; parent.appendChild(m); }
      else parent.appendChild(document.createTextNode(piece.text));
    });
  }

  function render(query) {
    var terms = engine.tokenize(query);
    var hits = engine.search(index, query, 12);
    panel.textContent = '';
    if (!terms.length) { close(); status.textContent = ''; return; }
    panel.hidden = false;
    if (!hits.length) {
      var none = document.createElement('p');
      none.className = 'search-none';
      none.textContent = 'Nothing matches "' + query + '". Try fewer or shorter words.';
      panel.appendChild(none);
      status.textContent = 'No results';
      return;
    }
    var list = document.createElement('ul');
    hits.forEach(function (hit) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = assets + '../' + hit.page.u + (hit.section.a ? '#' + hit.section.a : '');
      var title = document.createElement('span');
      title.className = 'hit-title';
      mark(title, hit.page.t + (hit.section.h && hit.section.h !== hit.page.t ? ' › ' + hit.section.h : ''), terms);
      var snippet = document.createElement('span');
      snippet.className = 'hit-snippet';
      mark(snippet, engine.snippet(hit.section.x, terms, 200), terms);
      a.appendChild(title);
      a.appendChild(snippet);
      li.appendChild(a);
      list.appendChild(li);
    });
    panel.appendChild(list);
    status.textContent = hits.length + (hits.length === 1 ? ' result' : ' results');
  }

  function run() {
    var query = input.value;
    if (!query.trim()) { close(); status.textContent = ''; return; }
    load().then(function () { if (input.value === query) render(query); }, function (e) {
      panel.hidden = false;
      panel.textContent = '';
      var p = document.createElement('p');
      p.className = 'search-none';
      p.textContent = e.message;
      panel.appendChild(p);
    });
  }

  input.addEventListener('focus', function () { load().catch(function () { /* Reported when a search is run. */ }); });
  input.addEventListener('input', run);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      var first = panel.querySelector('a');
      if (first) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'Escape') {
      if (input.value) { input.value = ''; close(); status.textContent = ''; } else input.blur();
    }
  });
  panel.addEventListener('keydown', function (e) {
    var links = Array.prototype.slice.call(panel.querySelectorAll('a'));
    var at = links.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && at >= 0) { e.preventDefault(); (links[at + 1] || links[at]).focus(); }
    else if (e.key === 'ArrowUp' && at >= 0) { e.preventDefault(); (at === 0 ? input : links[at - 1]).focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); input.focus(); close(); }
  });
  document.addEventListener('click', function (e) { if (!form.contains(e.target)) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var target = e.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
})();
