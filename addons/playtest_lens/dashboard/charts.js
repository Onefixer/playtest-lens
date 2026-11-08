// Playtest Lens - small dependency-free charts (HTML and inline SVG) and tooltips.
(function () {
  'use strict';
  const PL = (window.PL = window.PL || {});
  const C = (PL.charts = {});

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  PL.esc = esc;
  // Categorical slots, assigned in this fixed order (see styles.css).
  C.SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

  // --- Tooltip ------------------------------------------------------------------
  // Any element with data-tip="..." shows that (escaped) HTML on hover/focus.

  let tipEl = null;
  let tipOwner = null;
  function tooltip() {
    if (!tipEl) tipEl = document.getElementById('tooltip');
    return tipEl;
  }
  C.showTip = function (html, x, y) {
    const el = tooltip();
    el.innerHTML = html;
    el.classList.add('visible');
    C.moveTip(x, y);
  };
  C.moveTip = function (x, y) {
    const el = tooltip();
    const pad = 14;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x + pad;
    let top = y + pad;
    if (left + w > window.innerWidth - 8) left = x - w - pad;
    if (top + h > window.innerHeight - 8) top = y - h - pad;
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = Math.max(8, top) + 'px';
  };
  C.hideTip = function () {
    tooltip().classList.remove('visible');
    tipOwner = null;
  };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return;
    tipOwner = el;
    C.showTip(el.getAttribute('data-tip'), e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (tipOwner) C.moveTip(e.clientX, e.clientY);
  });
  document.addEventListener('mouseout', (e) => {
    if (tipOwner && (!e.relatedTarget || !tipOwner.contains(e.relatedTarget))) C.hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    tipOwner = el;
    C.showTip(el.getAttribute('data-tip'), r.right, r.top);
  });
  document.addEventListener('focusout', () => { if (tipOwner) C.hideTip(); });

  // --- Horizontal bars ---------------------------------------------------------------

  // items: [{label, value, display, sub, tip}]; one measure, one hue.
  C.bars = function (items, opts) {
    const o = opts || {};
    if (!items.length) return '<p class="empty-note">' + esc(o.empty || 'Nothing recorded yet.') + '</p>';
    const max = o.max || Math.max(...items.map((i) => i.value), 0) || 1;
    const color = o.color || C.SERIES[0];
    return '<div class="bars" role="list">' + items.map((i) => {
      const width = Math.max(0, Math.min(100, (i.value / max) * 100));
      return '<div class="bar-row" role="listitem" tabindex="0" data-tip="' + esc(i.tip || '<b>' + esc(i.label) + '</b><br>' + esc(i.display !== undefined ? i.display : i.value)) + '">' +
        '<div class="bar-label">' + esc(i.label) + (i.sub ? '<span class="bar-sub">' + esc(i.sub) + '</span>' : '') + '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + width.toFixed(2) + '%;background:' + color + '"></div></div>' +
        '<div class="bar-value">' + esc(i.display !== undefined ? i.display : i.value) + '</div></div>';
    }).join('') + '</div>';
  };

  // --- Histogram ------------------------------------------------------------------------

  function niceStep(range, target) {
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
    return 10 * mag;
  }

  C.histogram = function (values, opts) {
    const o = opts || {};
    const v = values.filter((x) => x !== null && !Number.isNaN(x));
    if (!v.length) return '<p class="empty-note">' + esc(o.empty || 'Nothing recorded yet.') + '</p>';
    const fmt = o.format || ((x) => String(Math.round(x)));
    const max = Math.max(...v);
    const step = niceStep(max || 1, o.bins || 8);
    const count = Math.max(1, Math.ceil((max + 1e-9) / step));
    const bins = new Array(count).fill(0);
    for (const x of v) bins[Math.min(count - 1, Math.floor(x / step))]++;
    const W = 560;
    const H = 180;
    const left = 30;
    const bottom = 24;
    const top = 10;
    const plotW = W - left - 8;
    const plotH = H - bottom - top;
    const peak = Math.max(...bins);
    const yStep = Math.max(1, niceStep(peak, 3));
    const yMax = Math.ceil(peak / yStep) * yStep;
    const bw = plotW / count;
    const y = (n) => top + plotH - (n / yMax) * plotH;
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Histogram') + '">';
    for (let g = 0; g <= yMax; g += yStep) {
      svg += '<line x1="' + left + '" x2="' + (W - 8) + '" y1="' + y(g) + '" y2="' + y(g) + '" class="grid"/>';
      svg += '<text x="' + (left - 6) + '" y="' + (y(g) + 4) + '" class="tick" text-anchor="end">' + g + '</text>';
    }
    bins.forEach((n, i) => {
      const x = left + i * bw + 1;
      const h = (n / yMax) * plotH;
      const label = fmt(i * step) + '–' + fmt((i + 1) * step);
      const tipText = '<b>' + esc(label) + '</b><br>' + n + ' ' + esc(o.unit || 'items');
      if (h > 0) {
        const r = Math.min(4, h, (bw - 2) / 2);
        const x2 = x + bw - 2;
        const yt = top + plotH - h;
        const yb = top + plotH;
        svg += '<path d="M' + x + ',' + yb + 'V' + (yt + r) + 'Q' + x + ',' + yt + ' ' + (x + r) + ',' + yt + 'H' + (x2 - r) + 'Q' + x2 + ',' + yt + ' ' + x2 + ',' + (yt + r) + 'V' + yb + 'Z" style="fill:' + (o.color || C.SERIES[0]) + '"/>';
      }
      svg += '<rect x="' + (x - 1) + '" y="' + top + '" width="' + bw + '" height="' + plotH + '" class="hit" data-tip="' + esc(tipText) + '"/>';
    });
    svg += '<line x1="' + left + '" x2="' + (W - 8) + '" y1="' + (top + plotH) + '" y2="' + (top + plotH) + '" class="axis"/>';
    const every = Math.ceil(count / 6);
    for (let i = 0; i <= count; i += every) {
      svg += '<text x="' + (left + i * bw) + '" y="' + (H - 6) + '" class="tick" text-anchor="middle">' + esc(fmt(i * step)) + '</text>';
    }
    return svg + '</svg>';
  };

  // --- Stacked share bar (outcomes) ------------------------------------------------------

  // parts: [{label, value, color}]; legend always shown, labels on wide segments.
  C.stack = function (parts) {
    const total = parts.reduce((t, p) => t + p.value, 0);
    if (!total) return '<p class="empty-note">Nothing recorded yet.</p>';
    let html = '<div class="stack" role="img" aria-label="' + esc(parts.map((p) => p.label + ' ' + p.value).join(', ')) + '">';
    for (const p of parts) {
      if (!p.value) continue;
      const share = p.value / total;
      html += '<div class="stack-seg" tabindex="0" style="flex:' + p.value + ';background:' + p.color + '" data-tip="' + esc('<b>' + esc(p.label) + '</b><br>' + p.value + ' (' + Math.round(share * 100) + '%)') + '">' +
        (share >= 0.14 ? '<span>' + Math.round(share * 100) + '%</span>' : '') + '</div>';
    }
    html += '</div><div class="legend">';
    for (const p of parts) {
      if (!p.value) continue;
      html += '<span class="legend-item"><i style="background:' + p.color + '"></i>' + esc(p.label) + ' <b>' + p.value + '</b></span>';
    }
    return html + '</div>';
  };

  // --- Session timeline ---------------------------------------------------------------------

  C.timeline = function (s, levelOrder) {
    const W = 900;
    const H = 96;
    const left = 8;
    const right = 8;
    const duration = Math.max(s.duration, 1);
    const x = (t) => left + (t / duration) * (W - left - right);
    const levelColor = (id) => C.SERIES[Math.max(0, levelOrder.indexOf(id)) % C.SERIES.length];
    let svg = '<svg class="chart timeline" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Session timeline">';
    for (const g of s.gaps) {
      svg += '<rect x="' + x(g[0]) + '" y="8" width="' + Math.max(1, x(g[1]) - x(g[0])) + '" height="64" class="gap" data-tip="' + esc('<b>Paused or unfocused</b><br>' + PL.formatSeconds(g[1] - g[0])) + '"/>';
    }
    for (const v of s.visits) {
      const w = Math.max(2, x(v.end) - x(v.start) - 2);
      svg += '<rect x="' + (x(v.start) + 1) + '" y="12" width="' + w + '" height="16" rx="3" style="fill:' + levelColor(v.level) + '" data-tip="' +
        esc('<b>' + esc(PL.prettyName(v.level)) + '</b><br>' + esc(PL.prettyName(v.result || '')) + ' after ' + PL.formatSeconds(v.duration) + (v.deaths ? '<br>' + v.deaths + ' deaths' : '')) + '"/>';
    }
    svg += '<line x1="' + left + '" x2="' + (W - right) + '" y1="52" y2="52" class="axis"/>';
    const mark = (t, shape, cls, tipHtml) => {
      const cx = x(t);
      let m = '';
      if (shape === 'tri') m = '<path d="M' + cx + ',44 L' + (cx + 5) + ',53 L' + (cx - 5) + ',53 Z" class="' + cls + '"/>';
      else if (shape === 'diamond') m = '<path d="M' + cx + ',43 L' + (cx + 5) + ',48 L' + cx + ',53 L' + (cx - 5) + ',48 Z" class="' + cls + '"/>';
      else if (shape === 'square') m = '<rect x="' + (cx - 4) + '" y="44" width="8" height="8" rx="1.5" class="' + cls + '"/>';
      else m = '<circle cx="' + cx + '" cy="48" r="4" class="' + cls + '"/>';
      return m + '<rect x="' + (cx - 7) + '" y="38" width="14" height="20" class="hit" data-tip="' + esc(tipHtml) + '"/>';
    };
    for (const i of s.items) svg += mark(i.t, 'dot', 'm-item', '<b>Picked up ' + esc(PL.prettyName(i.id)) + '</b><br>' + PL.formatSeconds(i.t));
    for (const c of s.choices) svg += mark(c.t, 'square', 'm-choice', '<b>' + esc(PL.prettyName(c.kind)) + ': ' + esc(PL.prettyName(c.picked)) + '</b><br>Offered ' + esc(c.options.map(PL.prettyName).join(', ')));
    for (const d of s.deaths) svg += mark(d.t, 'tri', 'm-death', '<b>Died: ' + esc(PL.prettyName(d.cause)) + '</b><br>' + esc(PL.prettyName(d.level)) + ' at ' + PL.formatSeconds(d.t));
    for (const n of s.notes) svg += mark(n.t, 'diamond', 'm-note', '<b>Note</b><br>“' + esc(n.text) + '”');
    const endCls = s.clean ? 'm-end' : 'm-crash';
    svg += '<rect x="' + (x(s.duration) - 3) + '" y="38" width="3" height="20" class="' + endCls + '" data-tip="' + esc('<b>' + (s.clean ? 'Session ended (' + esc(PL.prettyName(s.endReason)) + ')' : 'Ended without a clean exit') + '</b><br>' + PL.formatSeconds(s.duration)) + '"/>';
    const every = niceStep(duration, 6);
    for (let t = 0; t <= duration; t += every) {
      svg += '<text x="' + x(t) + '" y="' + (H - 8) + '" class="tick" text-anchor="middle">' + esc(PL.formatSeconds(t)) + '</text>';
    }
    svg += '</svg>';
    const legend = '<div class="legend">' +
      Array.from(new Set(s.visits.map((v) => v.level))).map((id) => '<span class="legend-item"><i style="background:' + levelColor(id) + '"></i>' + esc(PL.prettyName(id)) + '</span>').join('') +
      '<span class="legend-item"><i class="lg-death"></i>Death</span><span class="legend-item"><i class="lg-note"></i>Note</span><span class="legend-item"><i class="lg-choice"></i>Choice</span><span class="legend-item"><i class="lg-item"></i>Pickup</span></div>';
    return svg + legend;
  };
})();
