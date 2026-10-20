// Search over the index written by `npm run docs:build`. A plain script (no modules) so it works from file://, and it
// attaches one object, TabulariusDocsSearch, that the tests load the same way a page does.
(function (root) {
  'use strict';

  /** Lower-case words; a name with underscores is kept whole and also in parts, as the index has it. */
  function tokenize(text) {
    var out = [];
    var seen = {};
    var found = String(text).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
    for (var i = 0; i < found.length; i++) {
      var parts = [found[i]];
      if (found[i].indexOf('_') >= 0) parts = parts.concat(found[i].split('_').filter(Boolean));
      for (var j = 0; j < parts.length; j++) if (!seen[parts[j]]) { seen[parts[j]] = true; out.push(parts[j]); }
    }
    return out;
  }

  function wordsOf(section) {
    if (!section._w) section._w = (' ' + section.w + ' ');
    return section._w;
  }

  /**
   * The sections that contain every word of the query (each may be only the start of a word), best first.
   * A word in a heading counts most, then one in the page's title; a whole word beats the start of one.
   */
  function search(index, query, limit) {
    var terms = tokenize(query);
    if (!terms.length) return [];
    var hits = [];
    for (var n = 0; n < index.sections.length; n++) {
      var section = index.sections[n];
      var haystack = wordsOf(section);
      var headingWords = ' ' + tokenize(section.h).join(' ') + ' ';
      var titleWords = ' ' + tokenize(index.pages[section.p].t).join(' ') + ' ';
      var score = 0;
      var all = true;
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        var whole = haystack.indexOf(' ' + term + ' ') >= 0;
        if (whole) score += 2;
        else if (haystack.indexOf(' ' + term) >= 0) score += 1;
        else { all = false; break; }
        if (headingWords.indexOf(' ' + term + (whole ? ' ' : '')) >= 0) score += 6;
        if (titleWords.indexOf(' ' + term + (whole ? ' ' : '')) >= 0) score += 3;
      }
      if (all) hits.push({ section: section, page: index.pages[section.p], score: score + (section.a === '' ? 1 : 0), order: n });
    }
    hits.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    return hits.slice(0, limit || 20);
  }

  /** Splits text into pieces that match a query word and pieces that do not, so a page can mark them without building HTML from text. */
  function segments(text, terms) {
    if (!terms.length) return [{ text: text, match: false }];
    var escaped = terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    var re = new RegExp('(' + escaped.join('|') + ')', 'giu');
    var out = [];
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), match: false });
      out.push({ text: m[0], match: true });
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) out.push({ text: text.slice(last), match: false });
    return out;
  }

  /** A stretch of text of about `length` characters that shows the first word of the query it finds (or the start, when none is there). */
  function snippet(text, terms, length) {
    var lower = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length; i++) {
      var found = lower.indexOf(terms[i]);
      if (found >= 0 && (at < 0 || found < at)) at = found;
    }
    if (at < 0 || at < length / 3) return text.length > length ? text.slice(0, length).replace(/\s+\S*$/, '') + '…' : text;
    var from = text.indexOf(' ', Math.max(0, at - Math.floor(length / 3)));
    from = from < 0 || from > at ? at : from + 1;
    var piece = text.slice(from, from + length);
    return '…' + (from + length < text.length ? piece.replace(/\s+\S*$/, '') + '…' : piece);
  }

  root.TabulariusDocsSearch = { tokenize: tokenize, search: search, segments: segments, snippet: snippet };
})(typeof window !== 'undefined' ? window : globalThis);
