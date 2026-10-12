/* Flowboard safe Markdown renderer (no dependencies).
   Security model: ALL user text is HTML-escaped first; only a fixed set of tags is produced by the renderer
   itself, and links are emitted only for http(s) and mailto URLs. Raw HTML in the input is shown as text.
   Supported: headings, paragraphs, line breaks, **bold**, *italic*, ~~strike~~, `code`, fenced code blocks,
   > quotes, - bullet / 1. numbered lists, - [ ] task items, --- rules, [links](https://…) and bare URLs. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.FB = root.FB || {}; root.FB.markdown = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
  const unesc = s => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
  const C0 = '\u0000', C1 = '\u0001';

  // Returns an escaped, safe href or null. Only absolute http(s) and mailto links are allowed.
  function safeHref(escapedUrl) {
    const u = unesc(escapedUrl).trim();
    if (/[\u0000-\u001f\s]/.test(u)) return null;
    if (/^https?:\/\/[^/]/i.test(u) || /^mailto:[^\s@]+@[^\s@]+$/i.test(u)) return esc(u);
    return null;
  }
  const A = href => `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">`;

  function emphasis(s) {
    return s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');
  }

  function inline(raw) {
    const codes = [], links = [];
    let s = String(raw).replace(/[\u0000\u0001]/g, '');
    s = s.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return C0 + (codes.length - 1) + C0; });
    s = esc(s);
    s = s.replace(/\[([^\]\n]{1,300})\]\(([^()\s]{1,2000})\)/g, (m, label, url) => {
      const href = safeHref(url);
      if (!href) return label;
      links.push(A(href) + emphasis(label) + '</a>');
      return C1 + (links.length - 1) + C1;
    });
    s = s.replace(/\bhttps?:\/\/[^\s<\u0001\u0000]+/g, m => {
      const trail = (m.match(/(?:[.,:;!?)\]]|&quot;|&#39;)+$/) || [''])[0];
      const url = trail ? m.slice(0, -trail.length) : m;
      const href = safeHref(url);
      if (!href) return m;
      links.push(A(href) + url + '</a>');
      return C1 + (links.length - 1) + C1 + trail;
    });
    s = emphasis(s);
    s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => links[+i]);
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
    return s;
  }

  const RE = {
    fence: /^\s*```/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/,
    quote: /^\s*>\s?/,
    ul: /^\s*[-*+]\s+/,
    ol: /^\s*\d{1,9}[.)]\s+/
  };
  const isBlockStart = l => RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.ul.test(l) || RE.ol.test(l);

  function render(src, depth) {
    depth = depth || 0;
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (RE.fence.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !RE.fence.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      let m = line.match(RE.heading);
      if (m) { const lvl = Math.min(6, m[1].length + 2); out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`); i++; continue; }
      if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }
      if (RE.quote.test(line)) {
        const buf = [];
        while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].replace(RE.quote, ''));
        out.push(depth < 4 ? `<blockquote>${render(buf.join('\n'), depth + 1)}</blockquote>` : `<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
        continue;
      }
      if (RE.ul.test(line) || RE.ol.test(line)) {
        const ordered = RE.ol.test(line) && !RE.ul.test(line);
        const re = ordered ? RE.ol : RE.ul;
        const items = [];
        while (i < lines.length && re.test(lines[i])) {
          let text = lines[i++].replace(re, '');
          while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !RE.ul.test(lines[i]) && !RE.ol.test(lines[i])) text += ' ' + lines[i++].trim();
          const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
          items.push(task ? `<li class="md-task"><input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inline(task[2])}</li>` : `<li>${inline(text)}</li>`);
        }
        out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
        continue;
      }
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('\n');
  }

  // Plain-text excerpt (used for card previews and search).
  const toText = src => String(src || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~[\]()-]/g, ' ').replace(/\s+/g, ' ').trim();

  return { render, inline, escape: esc, toText, safeHref };
});
