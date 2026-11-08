// Playtest Lens - dashboard app: state, views and interactions.
(function () {
  'use strict';
  const PL = window.PL;
  const A = PL.analysis;
  const C = PL.charts;
  const esc = PL.esc;
  const secs = PL.formatSeconds;
  const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? '–' : Math.round(x * 100) + '%');
  const fixed = (x, d) => (x === null || x === undefined || Number.isNaN(x) ? '–' : x.toFixed(d));
  const STORAGE = 'playtest-lens:';

  const store = PL.createStore();
  const state = {
    dataset: null,
    analysis: null,
    insights: [],
    compare: null,
    filters: { build: 'all', tester: 'all' },
    view: 'overview',
    insightFilter: 'all',
    heat: { level: null, layers: ['deaths', 'notes'], session: '', event: 'all', points: false, zones: true, radius: 1, intensity: 1, focus: null },
    sessionSort: { key: 'started', dir: -1 },
    selectedSession: null,
    compareBuilds: { a: null, b: null },
    ai: { running: false, text: '', error: '', note: '' },
  };
  let heatmap = null;
  let replayTimer = null;

  const ICONS = {
    overview: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    insights: '<path d="M9 21h6M10 17h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    heatmaps: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
    progression: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    sessions: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    compare: '<path d="M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4"/>',
    ai: '<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  };
  const VIEWS = [
    { id: 'overview', label: 'Overview' },
    { id: 'insights', label: 'Insights' },
    { id: 'heatmaps', label: 'Heatmaps' },
    { id: 'progression', label: 'Progression' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'compare', label: 'Compare builds' },
    { id: 'ai', label: 'Ask Claude' },
  ];
  const SEVERITY = {
    critical: { label: 'Critical', icon: '!' },
    warning: { label: 'Warning', icon: '▲' },
    info: { label: 'Info', icon: 'i' },
    good: { label: 'Good news', icon: '✓' },
  };
  const OUTCOME_COLORS = { win: 'var(--s3)', death: 'var(--s8)', quit: 'var(--s7)', crash: 'var(--s2)', abandoned: 'var(--s4)', unfinished: 'var(--s5)' };

  // --- Storage helpers (optional; the page works without them) ---------------------

  function load(key) { try { return localStorage.getItem(STORAGE + key); } catch (e) { return null; } }
  function save(key, value) { try { if (value === null) localStorage.removeItem(STORAGE + key); else localStorage.setItem(STORAGE + key, value); } catch (e) { /* storage unavailable */ } }

  // --- Data ---------------------------------------------------------------------------

  function recompute() {
    state.dataset = PL.buildDataset(store);
    const d = state.dataset;
    if (state.filters.build !== 'all' && !d.builds.includes(state.filters.build)) state.filters.build = 'all';
    if (state.filters.tester !== 'all' && !d.testers.includes(state.filters.tester)) state.filters.tester = 'all';
    const sessions = PL.filterSessions(d, state.filters);
    state.analysis = A.analyze(d, sessions);
    state.compare = null;
    if (state.filters.build === 'all' && state.filters.tester === 'all' && d.builds.length >= 2) {
      state.compare = A.compare(d, d.builds[d.builds.length - 2], d.builds[d.builds.length - 1]);
    }
    state.insights = PL.generateInsights(d, state.analysis, { compare: state.compare });
    if (!state.heat.level || !state.analysis.level[state.heat.level]) {
      state.heat.level = state.analysis.levels.length ? state.analysis.levels[0].id : null;
    }
  }

  async function addFiles(files, sourceLabel) {
    if (!files.length) return;
    toast('Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…');
    const report = await PL.addFiles(store, files);
    afterLoad(report, sourceLabel);
  }

  async function addBundle(bundle, sourceLabel) {
    const report = await PL.addBundle(store, bundle);
    afterLoad(report, sourceLabel);
  }

  function afterLoad(report, sourceLabel) {
    recompute();
    render();
    const parts = [];
    if (report.sessions) parts.push(report.sessions + ' session' + (report.sessions === 1 ? '' : 's'));
    if (report.maps) parts.push(report.maps + ' map' + (report.maps === 1 ? '' : 's'));
    let message = parts.length ? 'Loaded ' + parts.join(' and ') + (sourceLabel ? ' from ' + sourceLabel : '') + '.' : 'No new playtest sessions found.';
    if (report.duplicates) message += ' ' + report.duplicates + ' already loaded.';
    if (report.errors.length) message += ' ' + report.errors.length + ' file(s) could not be read.';
    toast(message, report.errors.length ? 'warn' : 'ok');
    if (report.errors.length) console.warn('Playtest Lens:', report.errors);
  }

  function loadSample() {
    if (window.PLAYTEST_LENS_SAMPLE) { addBundle(window.PLAYTEST_LENS_SAMPLE, 'the sample'); return; }
    const script = document.createElement('script');
    script.src = 'sample-data.js';
    script.onload = () => {
      if (window.PLAYTEST_LENS_SAMPLE) addBundle(window.PLAYTEST_LENS_SAMPLE, 'the sample');
      else toast('The sample data file is empty.', 'warn');
    };
    script.onerror = () => toast('sample-data.js was not found next to this page.', 'warn');
    document.body.appendChild(script);
  }

  function clearAll() {
    store.sessions.clear();
    store.maps.clear();
    store.pendingMeta.clear();
    store.pendingImages.clear();
    state.dataset = null;
    state.analysis = null;
    state.insights = [];
    state.selectedSession = null;
    render();
  }

  // --- Shell ----------------------------------------------------------------------------

  function renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = VIEWS.map((v) =>
      '<a href="#' + v.id + '" data-view="' + v.id + '" class="nav-item' + (state.view === v.id ? ' active' : '') + '"' + (state.view === v.id ? ' aria-current="page"' : '') + '>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[v.id] + '</svg><span>' + v.label + '</span>' +
      (v.id === 'insights' && state.insights.length ? '<em class="nav-count">' + state.insights.filter((i) => i.severity === 'critical' || i.severity === 'warning').length + '</em>' : '') +
      '</a>').join('');
  }

  function renderTopbar() {
    const d = state.dataset;
    const title = document.getElementById('gameTitle');
    const meta = document.getElementById('gameMeta');
    const filters = document.getElementById('filters');
    if (!d || !d.sessions.length) {
      title.textContent = 'Playtest Lens';
      meta.textContent = 'Local playtest analytics for Godot';
      filters.innerHTML = '';
      return;
    }
    const s = state.analysis.summary;
    title.textContent = d.game;
    meta.textContent = s.sessions + ' sessions · ' + s.testers + ' testers · ' + secs(s.playtime) + ' played' + (d.mapCount ? '' : ' · no level maps yet');
    filters.innerHTML =
      '<label class="field"><span>Build</span><select id="fBuild"><option value="all">All builds</option>' +
      d.builds.map((b) => '<option value="' + esc(b) + '"' + (state.filters.build === b ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Tester</span><select id="fTester"><option value="all">All testers</option>' +
      d.testers.map((t) => '<option value="' + esc(t) + '"' + (state.filters.tester === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>';
    document.getElementById('fBuild').addEventListener('change', (e) => { state.filters.build = e.target.value; recompute(); render(); });
    document.getElementById('fTester').addEventListener('change', (e) => { state.filters.tester = e.target.value; recompute(); render(); });
  }

  function render() {
    stopReplay();
    if (heatmap) { heatmap.destroy(); heatmap = null; }
    renderTopbar();
    renderNav();
    const root = document.getElementById('view');
    const hasData = state.dataset && state.dataset.sessions.length;
    document.body.classList.toggle('no-data', !hasData);
    if (!hasData) { root.innerHTML = emptyView(); return; }
    if (!state.analysis.sessions.length) {
      root.innerHTML = '<section class="card empty-filter"><h2>No sessions match these filters</h2><p>Pick another build or tester above.</p></section>';
      return;
    }
    const view = VIEW_RENDERERS[state.view] || VIEW_RENDERERS.overview;
    root.innerHTML = view.html();
    if (view.mount) view.mount(root);
    drawThumbnails(root);
    root.focus({ preventScroll: true });
  }

  function emptyView() {
    return '<section class="welcome">' +
      '<div class="drop-card" id="dropCard">' +
      '<svg viewBox="0 0 24 24" class="drop-icon" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>' +
      '<h2>Drop playtest data here</h2>' +
      '<p>Drag in a <code>playtest_lens</code> folder, a tester’s <b>.zip</b> export, or <b>.jsonl</b> session files. Everything stays on this computer.</p>' +
      '<div class="btn-row"><button class="btn primary" data-act="files">Choose files</button><button class="btn" data-act="folder">Choose folder</button><button class="btn ghost" data-act="sample">Try the sample data</button></div>' +
      '</div>' +
      '<div class="steps">' +
      '<div class="step"><b>1</b><h3>Add the plugin</h3><p>Enable <i>Playtest Lens</i> in Project Settings → Plugins and put your player in the group <code>playtest_track</code>.</p></div>' +
      '<div class="step"><b>2</b><h3>Playtest</h3><p>Report moments like <code>PlaytestLens.death("spikes")</code>. Testers press <kbd>F8</kbd> to leave a note and <kbd>F9</kbd> to export a zip.</p></div>' +
      '<div class="step"><b>3</b><h3>Look at the results</h3><p>In Godot, open the <i>Playtest Lens</i> panel and click <i>Open Dashboard</i>, or drop files on this page.</p></div>' +
      '</div>' +
      '<p class="muted small">Session files live in <code>user://playtest_lens/</code>. On Windows that is <code>%APPDATA%\\Godot\\app_userdata\\&lt;your project&gt;\\playtest_lens</code>.</p>' +
      '</section>';
  }

  // --- Shared bits -------------------------------------------------------------------------

  function severityBadge(severity) {
    const s = SEVERITY[severity];
    return '<span class="sev sev-' + severity + '"><i aria-hidden="true">' + s.icon + '</i>' + s.label + '</span>';
  }

  function insightCard(i, compact) {
    const L = i.level ? state.analysis.level[i.level] : null;
    const thumb = i.loc && L ? '<canvas class="thumb" width="320" height="200" data-level="' + esc(i.level) + '" data-x="' + i.loc.x + '" data-y="' + i.loc.y + '" data-r="' + i.loc.r + '" data-layer="' + esc(i.layer || '') + '" aria-hidden="true"></canvas>' : '';
    const actions = (i.loc && L) || (i.layer && L)
      ? '<button class="btn small" data-act="show-insight" data-id="' + esc(i.id) + '">Show on map</button>' : '';
    let body = '<p class="insight-text">' + esc(i.text) + '</p>';
    if (!compact) {
      if (i.evidence.length) body += '<div class="insight-block"><h4>Evidence</h4><ul>' + i.evidence.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
      if (i.suggestions.length) body += '<div class="insight-block"><h4>Try</h4><ul class="try">' + i.suggestions.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
    }
    return '<article class="insight sev-border-' + i.severity + (compact ? ' compact' : '') + '">' +
      (compact ? '' : thumb) +
      '<div class="insight-main">' +
      '<div class="insight-meta">' + severityBadge(i.severity) + '<span class="chip">' + esc(i.category) + '</span>' + (L ? '<span class="chip">' + esc(L.name) + '</span>' : '') +
      '<span class="conf conf-' + i.confidence + '" data-tip="' + esc('<b>' + esc(i.confidence) + ' confidence</b><br>Based on ' + (i.n || 0) + '. More testers make patterns more reliable.') + '" tabindex="0">' + esc(i.confidence) + ' confidence</span></div>' +
      '<h3>' + esc(i.title) + '</h3>' + body +
      (actions ? '<div class="insight-actions">' + actions + '</div>' : '') +
      '</div></article>';
  }

  function drawThumbnails(root) {
    for (const canvas of root.querySelectorAll('canvas.thumb')) {
      const L = state.analysis.level[canvas.dataset.level];
      if (!L) continue;
      const ctx = canvas.getContext('2d');
      const W = canvas.width;
      const H = canvas.height;
      const x = +canvas.dataset.x;
      const y = +canvas.dataset.y;
      const r = +canvas.dataset.r;
      const e = L.extent;
      const span = Math.max(r * 5, e.w * 0.22);
      const vw = Math.min(span, e.w);
      const vh = Math.min(vw * (H / W), e.h);
      const vx = Math.max(e.x, Math.min(e.x + e.w - vw, x - vw / 2));
      const vy = Math.max(e.y, Math.min(e.y + e.h - vh, y - vh / 2));
      ctx.fillStyle = '#121820';
      ctx.fillRect(0, 0, W, H);
      const map = L.meta.map;
      if (map && map.ready) {
        const iw = map.img.naturalWidth;
        const ih = map.img.naturalHeight;
        ctx.drawImage(map.img, ((vx - e.x) / e.w) * iw, ((vy - e.y) / e.h) * ih, (vw / e.w) * iw, (vh / e.h) * ih, 0, 0, W, H);
        ctx.fillStyle = 'rgba(6,9,14,0.25)';
        ctx.fillRect(0, 0, W, H);
      }
      const sx = ((x - vx) / vw) * W;
      const sy = ((y - vy) / vh) * H;
      const sr = Math.max(12, (r / vw) * W);
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  function kpi(label, value, sub, tip) {
    return '<div class="kpi"' + (tip ? ' data-tip="' + esc(tip) + '" tabindex="0"' : '') + '><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + esc(value) + '</div>' + (sub ? '<div class="kpi-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function card(title, body, opts) {
    const o = opts || {};
    return '<section class="card' + (o.cls ? ' ' + o.cls : '') + '"><header class="card-head"><h2>' + esc(title) + '</h2>' + (o.aside || '') + '</header>' + (o.desc ? '<p class="card-desc">' + esc(o.desc) + '</p>' : '') + body + '</section>';
  }

  function stuckPerVisit(L) {
    const total = L.stuckIntervals.filter((iv) => iv.kind === 'wander').reduce((t, iv) => t + iv.duration, 0);
    return L.visits ? total / L.visits : null;
  }

  function levelTable(levels, detailed) {
    return '<div class="table-wrap"><table class="table"><thead><tr><th>Level</th><th class="num">Visits</th><th class="num">Testers</th><th class="num">Clear rate</th><th class="num">Median clear</th>' +
      (detailed ? '<th class="num">Middle half</th>' : '') + '<th class="num">Deaths / visit</th><th>Top cause</th><th class="num">Stuck / visit</th><th class="num">Median FPS</th></tr></thead><tbody>' +
      levels.map((L) => '<tr><td><b>' + esc(L.name) + '</b></td><td class="num">' + L.visits + '</td><td class="num">' + L.visitors + '</td><td class="num">' + pct(L.completion) + '</td><td class="num">' + secs(L.durationMedian) + '</td>' +
        (detailed ? '<td class="num">' + (L.durationP25 !== null ? secs(L.durationP25) + '–' + secs(L.durationP75) : '–') + '</td>' : '') +
        '<td class="num">' + fixed(L.deathsPerVisit, 2) + '</td><td>' + esc(L.deathClusters[0] ? PL.prettyName(L.deathClusters[0].causes[0][0]) : L.deathCount ? PL.prettyName(L.deaths[0] ? L.deaths[0].cause : '') : '–') + '</td>' +
        '<td class="num">' + secs(stuckPerVisit(L)) + '</td><td class="num">' + (L.perf.median !== null ? Math.round(L.perf.median) : '–') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  // --- Views ----------------------------------------------------------------------------------

  const VIEW_RENDERERS = {};

  VIEW_RENDERERS.overview = {
    html() {
      const an = state.analysis;
      const s = an.summary;
      const R = an.runs;
      const top = state.insights.filter((i) => i.severity !== 'good').slice(0, 4);
      const goods = state.insights.filter((i) => i.severity === 'good').slice(0, 2);
      let html = '<div class="kpis">' +
        kpi('Testers', String(s.testers), s.sessions + ' sessions') +
        kpi('Play time', s.playtime >= 3600 ? (s.playtime / 3600).toFixed(1) + ' h' : Math.round(s.playtime / 60) + ' min', 'median session ' + secs(s.medianSession), 'Time with the game focused and unpaused: ' + secs(s.playtime)) +
        kpi('Runs', String(R.count || '–'), R.count ? pct(R.winRate) + ' won' : 'no run_start() calls') +
        kpi('Deaths', String(s.deaths), s.runs ? fixed(s.deaths / Math.max(1, R.count), 1) + ' per run' : '') +
        kpi('Tester notes', String(s.notes), 'left with F8') +
        kpi('Possible crashes', String(s.crashes), s.crashes ? 'sessions without a clean exit' : 'all sessions ended cleanly') +
        '</div>';
      html += '<div class="grid-2">';
      html += card('Top findings', top.length ? top.map((i) => insightCard(i, true)).join('') + '<a class="see-all" href="#insights">See all ' + state.insights.length + ' insights →</a>' : '<p class="empty-note">No problems stood out. Collect more sessions to find patterns.</p>', {
        desc: 'Found automatically. Open Insights for the evidence and suggested fixes.',
      });
      const stages = R.stages.filter((st) => st.ended > 0 || st.won > 0);
      const endItems = stages.map((st) => ({ label: st.label, value: st.ended, display: st.ended + ' runs', sub: pct(st.dropRate) + ' of runs that got here', tip: '<b>' + esc(st.label) + '</b><br>' + st.ended + ' of ' + st.reached + ' runs that reached it ended here (' + pct(st.dropRate) + ')' + (st.won ? '<br>' + st.won + ' won from here' : '') }));
      const runsBody = R.count ? C.bars(endItems, { empty: 'No runs have ended yet.' }) + (R.wins ? '<p class="card-foot">' + R.wins + ' of ' + R.count + ' runs were won.</p>' : '') : '<p class="empty-note">Call <code>PlaytestLens.run_start()</code>, <code>progress()</code> and <code>run_end()</code> to see where runs end.</p>';
      html += '<div class="stack-col">' + card('Where runs end', runsBody, { desc: 'Runs that ended (not won) at each stage.' });
      html += card('Session length', C.histogram(an.sessions.map((x) => x.activeTime / 60), { format: (v) => Math.round(v) + 'm', unit: 'sessions', label: 'Session length in minutes' }), { desc: 'Active minutes per session.' }) + '</div>';
      html += '</div>';
      html += card('Levels', levelTable(an.levels, false), { desc: 'In the order players reach them.' });
      if (goods.length) html += card('What’s working', goods.map((i) => insightCard(i, true)).join(''));
      return html;
    },
  };

  VIEW_RENDERERS.insights = {
    html() {
      const all = state.insights;
      const counts = { critical: 0, warning: 0, info: 0, good: 0 };
      for (const i of all) counts[i.severity]++;
      const f = state.insightFilter;
      const shown = all.filter((i) => f === 'all' || i.severity === f);
      const chips = ['all', 'critical', 'warning', 'info', 'good'].map((k) =>
        '<button class="filter-chip' + (f === k ? ' active' : '') + '" data-act="insight-filter" data-value="' + k + '" aria-pressed="' + (f === k) + '">' +
        (k === 'all' ? 'All' : SEVERITY[k].label) + ' <b>' + (k === 'all' ? all.length : counts[k]) + '</b></button>').join('');
      return '<div class="page-head"><div><h2>Insights</h2><p class="muted">Patterns the Lens analyst found in ' + state.analysis.summary.sessions + ' sessions. They are strong hints, not proof: confirm them on the heatmap and in session replays.</p></div>' +
        '<div class="btn-row"><button class="btn" data-act="copy-md">Copy as Markdown</button><a class="btn" href="#ai">Ask Claude for a deeper read</a></div></div>' +
        '<div class="chip-row" role="group" aria-label="Filter by severity">' + chips + '</div>' +
        '<div class="insight-list">' + (shown.length ? shown.map((i) => insightCard(i, false)).join('') : '<p class="empty-note">Nothing in this category.</p>') + '</div>';
    },
  };

  VIEW_RENDERERS.heatmaps = {
    html() {
      const an = state.analysis;
      const L = an.level[state.heat.level];
      if (!L) return card('Heatmaps', '<p class="empty-note">No level data in these sessions.</p>');
      const tabs = an.levels.map((l) => '<button class="tab' + (l.id === L.id ? ' active' : '') + '" data-act="heat-level" data-value="' + esc(l.id) + '" aria-pressed="' + (l.id === L.id) + '">' + esc(l.name) + '<span>' + l.deathCount + ' deaths</span></button>').join('');
      const layerChips = PL.LAYERS.map((layer) => {
        const on = state.heat.layers.includes(layer.id);
        const count = layerCount(L, layer.id);
        return '<label class="layer-chip' + (on ? ' on' : '') + (count ? '' : ' none') + '" data-tip="' + esc('<b>' + layer.label + '</b><br>' + layer.hint + '<br>' + count + ' recorded') + '">' +
          '<input type="checkbox" data-act="heat-layer" value="' + layer.id + '"' + (on ? ' checked' : '') + '><i style="background:var(' + layer.color + ')"></i>' + layer.label + '</label>';
      }).join('');
      const eventNames = Array.from(new Set(L.customs.map((c) => c.name)));
      const sessionsHere = an.sessions.filter((s) => s.pos.some((p) => p.level === L.id));
      const noMap = !(L.meta.map);
      return '<div class="tabs" role="group" aria-label="Level">' + tabs + '</div>' +
        '<div class="heat-layout"><div class="heat-main card">' +
        '<div class="layer-row">' + layerChips + '</div>' +
        '<div class="heat-tools">' +
        (eventNames.length ? '<label class="field inline"><span>Event</span><select data-act="heat-event"><option value="all">All events</option>' + eventNames.map((n) => '<option' + (state.heat.event === n ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' : '') +
        '<label class="field inline"><span>Spread</span><input type="range" min="0.5" max="2.5" step="0.1" value="' + state.heat.radius + '" data-act="heat-radius"></label>' +
        '<label class="field inline"><span>Intensity</span><input type="range" min="0.4" max="3" step="0.1" value="' + state.heat.intensity + '" data-act="heat-intensity"></label>' +
        '<label class="check"><input type="checkbox" data-act="heat-points"' + (state.heat.points ? ' checked' : '') + '>Individual events</label>' +
        '<label class="check"><input type="checkbox" data-act="heat-zones"' + (state.heat.zones ? ' checked' : '') + '>Zones</label>' +
        '<button class="btn small ghost" data-act="heat-reset">Reset zoom</button></div>' +
        (noMap ? '<p class="note">No map picture for this level yet. Maps are captured when the game runs in a window, one second after each level starts. Showing positions on a grid instead.</p>' : '') +
        '<div class="heat-stage" id="heatStage"></div>' +
        '<p class="muted small">Scroll to zoom, drag to pan, double-click to reset. Numbered rings are the hotspots listed on the right.</p>' +
        '</div><aside class="heat-side">' +
        card('Hotspots', hotspotList(L), { desc: 'Click one to zoom to it.' }) +
        card('Replay a session', '<label class="field"><span>Session</span><select data-act="heat-session"><option value="">None</option>' +
          sessionsHere.map((s) => '<option value="' + esc(s.id) + '"' + (state.heat.session === s.id ? ' selected' : '') + '>' + esc(s.label + ' · ' + s.build + ' · ' + secs(s.activeTime)) + '</option>').join('') + '</select></label>' +
          '<div id="replayControls"></div>', { desc: 'Draws one tester’s path through this level.' }) +
        '</aside></div>';
    },
    mount(root) {
      const L = state.analysis.level[state.heat.level];
      if (!L) return;
      heatmap = new PL.Heatmap(root.querySelector('#heatStage'));
      heatmap.options.points = state.heat.points;
      heatmap.options.zones = state.heat.zones;
      heatmap.options.radius = state.heat.radius;
      heatmap.options.intensity = state.heat.intensity;
      heatmap.layers = new Set(state.heat.layers);
      heatmap.onSelect = (h) => heatmap.focus({ x: h.x, y: h.y, r: h.r });
      heatmap.setData(heatData(L));
      if (state.heat.focus) { heatmap.focus(state.heat.focus); state.heat.focus = null; }
      renderReplayControls(L);
    },
  };

  function layerCount(L, layer) {
    switch (layer) {
      case 'moves': return L.positionCount;
      case 'deaths': return L.deaths.length;
      case 'stuck': return L.stuckIntervals.filter((iv) => iv.kind === 'wander').length;
      case 'quits': return L.quits.length + L.crashes.length;
      case 'perf': return L.perf.samples.filter((p) => p.fps < 30).length;
      case 'events': return L.customs.filter((c) => c.x !== null).length;
      case 'items': return L.items.filter((i) => i.x !== null).length;
      case 'notes': return L.notes.filter((n) => n.x !== null).length;
      default: return 0;
    }
  }

  function hotspots(L) {
    const list = [];
    for (const c of L.deathClusters.slice(0, 5)) {
      const name = A.placeName(L, c.x, c.y, PL.prettyName(c.causes[0][0]));
      list.push({ kind: 'deaths', x: c.x, y: c.y, r: c.r * 1.3, title: name, sub: c.count + ' deaths · ' + c.sessions + ' testers', tip: '<b>' + esc(name) + '</b><br>' + c.count + ' deaths from ' + c.sessions + ' testers<br>Mostly ' + esc(PL.prettyName(c.causes[0][0]).toLowerCase()) });
    }
    for (const s of L.stuckSpots.slice(0, 3)) {
      if (s.sessions < 2 && s.totalTime < 20) continue;
      const name = A.placeName(L, s.x, s.y, 'Stuck spot');
      list.push({ kind: 'stuck', x: s.x, y: s.y, r: s.r, title: name, sub: 'Stuck ' + secs(s.avgPerSession) + ' avg · ' + s.sessions + ' testers', tip: '<b>Stuck: ' + esc(name) + '</b><br>' + s.sessions + ' testers, ' + secs(s.avgPerSession) + ' on average' });
    }
    for (const q of L.quitClusters.slice(0, 2)) {
      const name = A.placeName(L, q.x, q.y, 'Quit spot');
      list.push({ kind: 'quits', x: q.x, y: q.y, r: q.r, title: name, sub: q.count + ' sessions ended here', tip: '<b>Quits: ' + esc(name) + '</b><br>' + q.count + ' sessions ended here' + (q.afterDeath ? '<br>' + q.afterDeath + ' right after a death' : '') });
    }
    for (const p of L.perf.spots.slice(0, 1)) {
      if (p.count < 3) continue;
      const name = A.placeName(L, p.x, p.y, 'Low FPS spot');
      list.push({ kind: 'perf', x: p.x, y: p.y, r: p.r, title: name, sub: 'Median ' + Math.round(p.fpsMedian) + ' FPS', tip: '<b>Low frame rate: ' + esc(name) + '</b><br>Median ' + Math.round(p.fpsMedian) + ' FPS in ' + p.count + ' samples' });
    }
    list.forEach((h, i) => { h.rank = i + 1; });
    return list;
  }

  function hotspotList(L) {
    const list = hotspots(L);
    if (!list.length) return '<p class="empty-note">No clear hotspots in this level yet.</p>';
    const colors = { deaths: '--s8', stuck: '--s4', quits: '--s7', perf: '--s2' };
    return '<ol class="hotspots">' + list.map((h) => '<li><button data-act="focus-hotspot" data-x="' + h.x + '" data-y="' + h.y + '" data-r="' + h.r + '" data-kind="' + h.kind + '">' +
      '<span class="rank">' + h.rank + '</span><i style="background:var(' + colors[h.kind] + ')"></i><span class="hs-text"><b>' + esc(h.title) + '</b><span>' + esc(h.sub) + '</span></span></button></li>').join('') + '</ol>';
  }

  function heatData(L) {
    const sessions = state.analysis.sessions;
    const id = L.id;
    const stuckPoints = [];
    for (const iv of L.stuckIntervals) {
      if (iv.kind !== 'wander') continue;
      for (const p of iv.session.pos) if (p.level === id && p.t >= iv.t0 && p.t <= iv.t1) stuckPoints.push(p);
    }
    const ev = state.heat.event;
    const data = {
      extent: L.extent,
      map: L.meta.map || null,
      zones: L.meta.zones || [],
      bounds: L.meta.bounds,
      layers: {
        moves: sessions.flatMap((s) => s.pos.filter((p) => p.level === id)),
        deaths: L.deaths.map((d) => ({ x: d.x, y: d.y, cause: d.cause, who: d.session.label + ' · ' + secs(d.t) })),
        stuck: stuckPoints,
        quits: L.quits.concat(L.crashes).filter((q) => q.x !== null),
        perf: L.perf.samples.filter((p) => p.fps < 30 && p.x !== null).map((p) => ({ x: p.x, y: p.y, w: 0.5 + (30 - p.fps) / 10 })),
        events: L.customs.filter((c) => c.x !== null && (ev === 'all' || c.name === ev)),
        items: L.items.filter((i) => i.x !== null),
        notes: L.notes.filter((n) => n.x !== null).map((n) => ({ x: n.x, y: n.y, text: n.text, who: n.session.label })),
      },
      hotspots: hotspots(L),
      replay: null,
    };
    if (state.heat.session) {
      const s = sessions.find((x) => x.id === state.heat.session);
      if (s) {
        data.replay = {
          points: s.pos.filter((p) => p.level === id),
          deaths: s.deaths.filter((d) => d.level === id && d.x !== null),
          jump: L.r * 4,
        };
      }
    }
    return data;
  }

  function renderReplayControls(L) {
    const box = document.getElementById('replayControls');
    if (!box) return;
    const s = state.analysis.sessions.find((x) => x.id === state.heat.session);
    if (!s || !heatmap.data.replay || !heatmap.data.replay.points.length) { box.innerHTML = ''; return; }
    const pts = heatmap.data.replay.points;
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const deaths = heatmap.data.replay.deaths.length;
    box.innerHTML = '<div class="replay">' +
      '<button class="btn small" data-act="replay-play">Play</button>' +
      '<input type="range" min="' + t0 + '" max="' + t1 + '" step="0.1" value="' + t1 + '" data-act="replay-seek" aria-label="Replay time">' +
      '<span class="replay-time" id="replayTime">' + secs(t1) + '</span></div>' +
      '<p class="muted small">' + esc(s.label) + ' spent ' + secs(t1 - t0) + ' here across ' + s.visits.filter((v) => v.level === L.id).length + ' visits and died ' + deaths + ' time' + (deaths === 1 ? '' : 's') + '. <a href="#sessions" data-act="open-session" data-id="' + esc(s.id) + '">Session details</a></p>';
    heatmap.replayT = null;
  }

  function stopReplay() {
    if (replayTimer) { cancelAnimationFrame(replayTimer); replayTimer = null; }
  }

  function toggleReplay(button) {
    const seek = document.querySelector('[data-act="replay-seek"]');
    if (!seek || !heatmap) return;
    if (replayTimer) { stopReplay(); button.textContent = 'Play'; return; }
    button.textContent = 'Pause';
    if (+seek.value >= +seek.max) seek.value = seek.min;
    let last = performance.now();
    const step = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = Math.min(+seek.max, +seek.value + dt * 8);
      seek.value = next;
      heatmap.replayT = next;
      heatmap.render();
      const label = document.getElementById('replayTime');
      if (label) label.textContent = secs(next);
      if (next >= +seek.max) { replayTimer = null; button.textContent = 'Play'; return; }
      replayTimer = requestAnimationFrame(step);
    };
    replayTimer = requestAnimationFrame(step);
  }

  VIEW_RENDERERS.progression = {
    html() {
      const an = state.analysis;
      const R = an.runs;
      let html = '';
      if (R.count) {
        const outcomes = R.outcomes.map(([o, n]) => ({ label: PL.prettyName(o), value: n, color: OUTCOME_COLORS[o] || 'var(--s6)' }));
        html += '<div class="grid-2">';
        html += card('How runs end', C.stack(outcomes) + '<p class="card-foot">' + R.count + ' runs · median length ' + secs(R.medianDuration) + '</p>');
        html += card('How far runs get', C.bars(R.stages.map((st) => ({ label: st.label, value: st.reached, display: st.reached + ' runs', sub: pct(st.reached / R.count) + ' of runs', tip: '<b>' + esc(st.label) + '</b><br>Reached by ' + st.reached + ' of ' + R.count + ' runs' }))), { desc: 'Runs that reached each stage.' });
        html += '</div>';
        html += card('Where runs end', C.bars(R.stages.map((st) => ({ label: st.label, value: st.dropRate, display: pct(st.dropRate), sub: st.ended + ' of ' + st.reached + ' runs', tip: '<b>' + esc(st.label) + '</b><br>' + st.ended + ' of the ' + st.reached + ' runs that reached it ended here' })), { max: 1, color: 'var(--s2)' }), { desc: 'Share of runs that reached a stage and ended there. A tall bar is a difficulty spike.' });
      } else {
        html += card('Runs', '<p class="empty-note">This game does not report runs yet. Call <code>PlaytestLens.run_start()</code>, <code>progress(stage, "Name")</code> and <code>run_end("death")</code> to see how far players get.</p>');
      }
      html += card('Levels', levelTable(an.levels, true), { desc: 'Clear rate counts every visit, so retries after a lost run count again.' });
      for (const kind of an.choices) {
        html += card(PL.prettyName(kind.kind) + ' choices', '<div class="table-wrap"><table class="table"><thead><tr><th>Option</th><th class="num">Offered</th><th class="num">Picked</th><th>Pick rate</th><th class="num">Win rate when picked</th><th class="num">When skipped</th></tr></thead><tbody>' +
          kind.options.map((o) => '<tr><td><b>' + esc(o.name) + '</b></td><td class="num">' + o.offered + '</td><td class="num">' + o.picked + '</td><td><div class="mini-bar"><i style="width:' + Math.round(o.pickRate * 100) + '%"></i></div><span class="mini-val">' + pct(o.pickRate) + '</span></td>' +
            '<td class="num">' + pct(o.with.winRate) + ' <span class="muted">(' + o.with.n + ')</span></td><td class="num">' + pct(o.without.winRate) + ' <span class="muted">(' + o.without.n + ')</span></td></tr>').join('') +
          '</tbody></table></div>', { desc: kind.decisions + ' decisions. Win rates compare runs that took an option with runs where it was offered but skipped.' });
      }
      html += '<div class="grid-2">';
      html += card('Death causes', C.bars(an.causes.map(([cause, n]) => ({ label: PL.prettyName(cause), value: n, display: n + ' deaths' })), { color: 'var(--s8)', empty: 'No deaths recorded.' }));
      html += card('Pickups', C.bars(an.items.map(([id, n]) => ({ label: PL.prettyName(id), value: n, display: String(n) })), { color: 'var(--s6)', empty: 'No PlaytestLens.item() calls recorded.' }));
      html += '</div>';
      return html;
    },
  };

  VIEW_RENDERERS.sessions = {
    html() {
      const list = state.analysis.sessions.slice();
      const { key, dir } = state.sessionSort;
      const value = (s) => {
        switch (key) {
          case 'tester': return s.label.toLowerCase();
          case 'build': return s.build;
          case 'length': return s.activeTime;
          case 'runs': return s.runs.length;
          case 'progress': return Math.max(0, ...s.runs.map((r) => r.progress));
          case 'deaths': return s.deaths.length;
          case 'notes': return s.notes.length;
          case 'ended': return s.endReason;
          default: return s.started ? s.started.getTime() : 0;
        }
      };
      list.sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (key === 'build') return PL.compareVersions(va, vb) * dir;
        return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
      });
      const head = (k, label, num) => '<th class="' + (num ? 'num ' : '') + 'sortable" aria-sort="' + (key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button data-act="sort" data-value="' + k + '">' + label + (key === k ? (dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
      const rows = list.map((s) => {
        const best = s.runs.reduce((m, r) => (r.progress > (m ? m.progress : -1) ? r : m), null);
        const ended = s.clean ? PL.prettyName(s.endReason) : '<span class="sev sev-critical"><i>!</i>No clean exit</span>';
        return '<tr class="clickable' + (state.selectedSession === s.id ? ' selected' : '') + '" data-act="open-session" data-id="' + esc(s.id) + '" tabindex="0">' +
          '<td><b>' + esc(s.label) + '</b></td><td>' + esc(s.build) + '</td><td>' + (s.started ? esc(s.started.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : '–') + '</td>' +
          '<td class="num">' + secs(s.activeTime) + '</td><td class="num">' + s.runs.length + '</td><td>' + esc(best ? best.label || String(best.progress) : '–') + '</td>' +
          '<td class="num">' + s.deaths.length + '</td><td class="num">' + s.notes.length + '</td><td>' + ended + '</td></tr>';
      }).join('');
      let html = card('Sessions', '<div class="table-wrap"><table class="table"><thead><tr>' + head('tester', 'Tester') + head('build', 'Build') + head('started', 'Started') + head('length', 'Length', true) + head('runs', 'Runs', true) + head('progress', 'Furthest') + head('deaths', 'Deaths', true) + head('notes', 'Notes', true) + head('ended', 'Ended') + '</tr></thead><tbody>' + rows + '</tbody></table></div>', { desc: 'Click a session to see its timeline.' });
      const s = state.analysis.sessions.find((x) => x.id === state.selectedSession);
      if (s) html += sessionDetail(s);
      return html;
    },
  };

  function sessionDetail(s) {
    const levels = Array.from(new Set(s.visits.map((v) => v.level)));
    const facts = [
      ['Tester', s.label + (s.testerName && s.tester !== s.testerName ? ' (' + s.tester + ')' : '')],
      ['Build', s.build],
      ['Platform', [s.platform, s.gpu].filter(Boolean).join(' · ') || '–'],
      ['Godot', s.godot || '–'],
      ['Active time', secs(s.activeTime) + ' of ' + secs(s.duration)],
      ['Runs', s.runs.map((r) => PL.prettyName(r.outcome) + (r.label ? ' at ' + r.label : '')).join(', ') || '–'],
      ['Picks', s.choices.map((c) => PL.prettyName(c.picked)).join(', ') || '–'],
      ['File', s.file],
    ].concat(Object.entries(s.attrs).map(([k, v]) => [PL.prettyName(k), String(v)]));
    return card('Session: ' + s.label, C.timeline(s, state.dataset.levels) +
      '<div class="grid-2 detail-grid"><dl class="facts">' + facts.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' +
      '<div><h4>Notes</h4>' + (s.notes.length ? '<ul class="notes">' + s.notes.map((n) => '<li>“' + esc(n.text) + '” <span class="muted">' + esc(PL.prettyName(n.level)) + ' · ' + secs(n.t) + '</span></li>').join('') + '</ul>' : '<p class="empty-note">No notes in this session.</p>') +
      '<h4>Replay on the map</h4><div class="btn-row">' + levels.map((l) => '<button class="btn small" data-act="replay-level" data-id="' + esc(s.id) + '" data-level="' + esc(l) + '">' + esc(PL.prettyName(l)) + '</button>').join('') + '</div></div></div>',
      { aside: '<button class="btn small ghost" data-act="close-session">Close</button>' });
  }

  VIEW_RENDERERS.compare = {
    html() {
      const d = state.dataset;
      if (d.builds.length < 2) {
        return card('Compare builds', '<p class="empty-note">All sessions so far are from build <b>' + esc(d.builds[0] || 'dev') + '</b>. Record playtests on a second build to compare them. The build label comes from <code>application/config/version</code> or the Build Label setting.</p>');
      }
      const a = state.compareBuilds.a && d.builds.includes(state.compareBuilds.a) ? state.compareBuilds.a : d.builds[d.builds.length - 2];
      const b = state.compareBuilds.b && d.builds.includes(state.compareBuilds.b) ? state.compareBuilds.b : d.builds[d.builds.length - 1];
      const cmp = A.compare(d, a, b);
      const sel = (id, value) => '<select data-act="compare-build" data-side="' + id + '">' + d.builds.map((x) => '<option' + (x === value ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>';
      const row = (label, va, vb, fmt, goodWhenLower) => {
        let delta = '';
        if (va !== null && vb !== null && va !== undefined && vb !== undefined && !Number.isNaN(va) && !Number.isNaN(vb)) {
          const diff = vb - va;
          if (Math.abs(diff) > 1e-9) {
            const better = goodWhenLower === null ? null : goodWhenLower ? diff < 0 : diff > 0;
            const cls = better === null ? 'neutral' : better ? 'better' : 'worse';
            const rel = va ? Math.round((diff / Math.abs(va)) * 100) : null;
            delta = '<span class="delta ' + cls + '">' + (diff > 0 ? '↑' : '↓') + ' ' + (rel !== null && Number.isFinite(rel) ? Math.abs(rel) + '%' : fmt(Math.abs(diff))) + (better === null ? '' : better ? ' better' : ' worse') + '</span>';
          } else delta = '<span class="delta neutral">no change</span>';
        }
        return '<tr><td>' + esc(label) + '</td><td class="num">' + fmt(va) + '</td><td class="num">' + fmt(vb) + '</td><td>' + delta + '</td></tr>';
      };
      const n = (x) => (x === null || x === undefined ? '–' : String(Math.round(x * 100) / 100));
      const sa = cmp.a.summary;
      const sb = cmp.b.summary;
      let rows = row('Sessions', sa.sessions, sb.sessions, n, null) +
        row('Testers', sa.testers, sb.testers, n, null) +
        row('Median session', sa.medianSession, sb.medianSession, secs, null) +
        row('Win rate', cmp.a.runs.winRate, cmp.b.runs.winRate, pct, false) +
        row('Average furthest stage', cmp.a.runs.avgProgress, cmp.b.runs.avgProgress, (x) => fixed(x, 2), false) +
        row('Deaths per run', cmp.a.runs.count ? sa.deaths / cmp.a.runs.count : null, cmp.b.runs.count ? sb.deaths / cmp.b.runs.count : null, (x) => fixed(x, 2), true) +
        row('Sessions without a clean exit', sa.crashes, sb.crashes, n, true);
      for (const level of cmp.levels) {
        if (!level.a || !level.b) continue;
        rows += '<tr class="group"><td colspan="4">' + esc(level.name) + '</td></tr>' +
          row('Clear rate', level.a.completion, level.b.completion, pct, false) +
          row('Deaths per visit', level.a.deathsPerVisit, level.b.deathsPerVisit, (x) => fixed(x, 2), true) +
          row('Median clear time', level.a.durationMedian, level.b.durationMedian, secs, null) +
          row('Stuck time per visit', stuckPerVisit(level.a), stuckPerVisit(level.b), secs, true) +
          (level.a.perf.count && level.b.perf.count ? row('Median FPS', level.a.perf.median, level.b.perf.median, (x) => (x === null ? '–' : String(Math.round(x))), false) : '');
        // The zone with the worst frame rate in either build, where averages hide drops.
        const worstZone = level.a.perf.zones.concat(level.b.perf.zones).filter((z) => z.n >= 4).sort((x, y) => x.median - y.median)[0];
        if (worstZone && worstZone.median < 45) {
          const za = level.a.perf.zones.find((z) => z.zone === worstZone.zone);
          const zb = level.b.perf.zones.find((z) => z.zone === worstZone.zone);
          rows += row('Median FPS in ' + worstZone.zone, za ? za.median : null, zb ? zb.median : null, (x) => (x === null ? '–' : String(Math.round(x))), false);
        }
        for (const spot of level.spots) {
          rows += row('Deaths per visit at ' + spot.name, spot.a.perVisit, spot.b.perVisit, (x) => fixed(x, 2), true);
        }
      }
      const changes = PL.generateInsights(d, cmp.b, { compare: cmp }).filter((i) => i.category === 'Change');
      return '<div class="page-head"><div><h2>Compare builds</h2><p class="muted">Did your changes help? Hotspots are matched by place across both builds.</p></div>' +
        '<div class="compare-pick"><label class="field inline"><span>From</span>' + sel('a', a) + '</label><span class="arrow">→</span><label class="field inline"><span>To</span>' + sel('b', b) + '</label></div></div>' +
        (changes.length ? card('What changed', changes.map((i) => insightCard(i, true)).join('')) : '') +
        card('Metrics', '<div class="table-wrap"><table class="table compare"><thead><tr><th>Metric</th><th class="num">' + esc(a) + '</th><th class="num">' + esc(b) + '</th><th>Change</th></tr></thead><tbody>' + rows + '</tbody></table></div>', { desc: 'Arrows show the direction of change; "better" and "worse" assume fewer deaths and crashes and more wins are good.' });
    },
  };

  VIEW_RENDERERS.ai = {
    html() {
      const remembered = load('apiKey');
      const model = load('model') || PL.ai.MODELS[0].id;
      const payload = PL.ai.buildPayload(state.dataset, state.analysis, state.insights, filterDescription());
      const ai = state.ai;
      return '<div class="page-head"><div><h2>Ask Claude</h2><p class="muted">Get a written playtest report from Claude, built on the same numbers as this dashboard.</p></div></div>' +
        '<div class="grid-ai">' +
        card('Analyze with Claude', '<form id="aiForm" class="ai-form" autocomplete="off">' +
          '<label class="field"><span>Anthropic API key</span><input type="password" id="aiKey" placeholder="sk-ant-…" value="' + esc(remembered || '') + '" spellcheck="false"></label>' +
          '<label class="check"><input type="checkbox" id="aiRemember"' + (remembered ? ' checked' : '') + '>Remember the key in this browser</label>' +
          '<label class="field"><span>Model</span><select id="aiModel">' + PL.ai.MODELS.map((m) => '<option value="' + m.id + '"' + (m.id === model ? ' selected' : '') + '>' + esc(m.label) + '</option>').join('') + '</select></label>' +
          '<div class="btn-row"><button type="submit" class="btn primary" id="aiRun"' + (ai.running ? ' disabled' : '') + '>' + (ai.running ? 'Analyzing…' : 'Analyze ' + state.analysis.summary.sessions + ' sessions') + '</button>' +
          (ai.running ? '<button type="button" class="btn" data-act="ai-stop">Stop</button>' : '') + '</div>' +
          '</form>' +
          '<ul class="fine-print"><li>Only aggregated numbers, the automatic findings and tester notes are sent. Raw position logs never leave this computer.</li>' +
          '<li>Requests go straight from this page to Anthropic using your key, billed to your Anthropic account. A typical report costs a few cents.</li>' +
          '<li>Get a key at <b>console.anthropic.com</b>. Leave "Remember" unchecked on shared computers.</li></ul>' +
          '<details class="preview"><summary>Preview exactly what will be sent</summary><pre>' + esc(JSON.stringify(payload, null, 2)) + '</pre></details>') +
        card('Report', '<div id="aiOut" class="ai-out' + (ai.running ? ' streaming' : '') + '">' + aiOutput() + '</div>', {
          aside: ai.text && !ai.running ? '<button class="btn small" data-act="ai-copy">Copy</button>' : '',
        }) +
        '</div>';
    },
    mount() {
      const form = document.getElementById('aiForm');
      form.addEventListener('submit', (e) => { e.preventDefault(); runAI(); });
    },
  };

  function aiOutput() {
    const ai = state.ai;
    if (ai.error) return '<p class="error-note">' + esc(ai.error) + '</p>' + (ai.text ? PL.ai.renderMarkdown(ai.text) : '');
    if (ai.text) return PL.ai.renderMarkdown(ai.text) + (ai.note ? '<p class="muted small">' + esc(ai.note) + '</p>' : '');
    if (ai.running) return '<p class="muted">Claude is reading the data…</p>';
    return '<p class="empty-note">The report will appear here. The built-in Insights tab already covers the main patterns offline; Claude adds a designer’s read of how they fit together.</p>';
  }

  async function runAI() {
    const key = document.getElementById('aiKey').value.trim();
    const model = document.getElementById('aiModel').value;
    const remember = document.getElementById('aiRemember').checked;
    if (!key) { toast('Enter your Anthropic API key first.', 'warn'); return; }
    save('apiKey', remember ? key : null);
    save('model', model);
    const payload = PL.ai.buildPayload(state.dataset, state.analysis, state.insights, filterDescription());
    state.ai = { running: true, text: '', error: '', note: '' };
    render();
    let pending = false;
    const paint = () => {
      pending = false;
      const out = document.getElementById('aiOut');
      if (out) out.innerHTML = aiOutput();
    };
    try {
      const message = await PL.ai.run({
        apiKey: key, model, payload,
        onText: (text) => {
          state.ai.text += text;
          if (!pending) { pending = true; requestAnimationFrame(paint); }
        },
      });
      if (message.stop_reason === 'refusal') state.ai.error = 'Claude declined to write this report.' + (message.stop_details && message.stop_details.explanation ? ' ' + message.stop_details.explanation : '');
      else if (message.stop_reason === 'max_tokens') state.ai.note = 'The report hit the length limit and may be cut off.';
      else state.ai.note = 'Written by ' + message.model + '.';
    } catch (err) {
      state.ai.error = PL.ai.describeError(err);
    }
    state.ai.running = false;
    if (state.view === 'ai') render();
  }

  function filterDescription() {
    const f = state.filters;
    return (f.build === 'all' ? 'all builds' : 'build ' + f.build) + ', ' + (f.tester === 'all' ? 'all testers' : 'tester ' + f.tester);
  }

  // --- Events --------------------------------------------------------------------------------

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const act = el.dataset.act;
    switch (act) {
      case 'files': document.getElementById('fileInput').click(); break;
      case 'folder': document.getElementById('folderInput').click(); break;
      case 'sample': loadSample(); break;
      case 'clear': if (confirm('Remove all loaded data from this page? Your files are not touched.')) clearAll(); break;
      case 'insight-filter': state.insightFilter = el.dataset.value; render(); break;
      case 'show-insight': {
        const i = state.insights.find((x) => x.id === el.dataset.id);
        if (!i) break;
        state.heat.level = i.level;
        const layers = new Set(['notes']);
        if (i.layer && i.layer !== 'notes') layers.add(i.layer);
        if (i.layer === 'stuck' || i.layer === 'moves') layers.add('moves');
        state.heat.layers = Array.from(layers);
        state.heat.focus = i.loc || null;
        state.heat.session = '';
        go('heatmaps');
        break;
      }
      case 'heat-level': state.heat.level = el.dataset.value; state.heat.session = ''; render(); break;
      case 'heat-reset': if (heatmap) heatmap.resetView(); break;
      case 'focus-hotspot': if (heatmap) heatmap.focus({ x: +el.dataset.x, y: +el.dataset.y, r: +el.dataset.r }); break;
      case 'replay-play': toggleReplay(el); break;
      case 'open-session': e.preventDefault(); state.selectedSession = el.dataset.id; go('sessions', true); break;
      case 'close-session': state.selectedSession = null; render(); break;
      case 'replay-level': state.heat.level = el.dataset.level; state.heat.session = el.dataset.id; state.heat.layers = ['deaths', 'notes']; go('heatmaps'); break;
      case 'sort': {
        const k = el.dataset.value;
        state.sessionSort = { key: k, dir: state.sessionSort.key === k ? -state.sessionSort.dir : k === 'tester' || k === 'build' ? 1 : -1 };
        render();
        break;
      }
      case 'copy-md': copyText(markdown(), 'Insights copied as Markdown.'); break;
      case 'download-md': download('playtest-insights.md', markdown(), 'text/markdown'); break;
      case 'print': window.print(); break;
      case 'ai-stop': PL.ai.cancel(); break;
      case 'ai-copy': copyText(state.ai.text, 'Report copied.'); break;
      case 'menu': toggleMenu(el); return;
      default: break;
    }
    closeMenus();
  }

  function onChange(e) {
    const el = e.target;
    const act = el.dataset && el.dataset.act;
    if (!act) return;
    switch (act) {
      case 'heat-layer': {
        const set = new Set(state.heat.layers);
        if (el.checked) set.add(el.value); else set.delete(el.value);
        state.heat.layers = Array.from(set);
        el.closest('.layer-chip').classList.toggle('on', el.checked);
        if (heatmap) heatmap.setLayers(state.heat.layers);
        break;
      }
      case 'heat-points': state.heat.points = el.checked; if (heatmap) heatmap.setOption('points', el.checked); break;
      case 'heat-zones': state.heat.zones = el.checked; if (heatmap) heatmap.setOption('zones', el.checked); break;
      case 'heat-event': state.heat.event = el.value; render(); break;
      case 'heat-session': state.heat.session = el.value; render(); break;
      case 'compare-build': state.compareBuilds[el.dataset.side] = el.value; render(); break;
      default: break;
    }
  }

  function onInput(e) {
    const el = e.target;
    const act = el.dataset && el.dataset.act;
    if (act === 'heat-radius') { state.heat.radius = +el.value; if (heatmap) heatmap.setOption('radius', +el.value); }
    else if (act === 'heat-intensity') { state.heat.intensity = +el.value; if (heatmap) heatmap.setOption('intensity', +el.value); }
    else if (act === 'replay-seek' && heatmap) {
      stopReplay();
      const button = document.querySelector('[data-act="replay-play"]');
      if (button) button.textContent = 'Play';
      heatmap.replayT = +el.value;
      heatmap.render();
      const label = document.getElementById('replayTime');
      if (label) label.textContent = secs(+el.value);
    }
  }

  function go(view, keepScroll) {
    if (location.hash === '#' + view) { state.view = view; render(); }
    else location.hash = view;
    if (!keepScroll) window.scrollTo(0, 0);
  }

  function toggleMenu(button) {
    const menu = document.getElementById(button.getAttribute('aria-controls'));
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  function closeMenus() {
    for (const m of document.querySelectorAll('.menu')) m.hidden = true;
    for (const b of document.querySelectorAll('[data-act="menu"]')) b.setAttribute('aria-expanded', 'false');
  }

  function markdown() {
    return PL.insightsToMarkdown(state.insights, state.dataset, 'Generated by Playtest Lens from ' + state.analysis.summary.sessions + ' sessions (' + filterDescription() + ') on ' + new Date().toLocaleDateString() + '.');
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message, 'ok');
    } catch (err) {
      download('playtest-insights.md', text, 'text/markdown');
      toast('Clipboard is blocked here, so the text was downloaded instead.', 'warn');
    }
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  let toastTimer = null;
  function toast(message, kind) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast visible' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 4200);
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    save('theme', next);
    if (heatmap) heatmap.refreshTheme();
  }

  function init() {
    PL.state = state; // for poking around in the browser console
    applyTheme(load('theme'));
    const hash = location.hash.replace('#', '');
    if (VIEWS.some((v) => v.id === hash)) state.view = hash;
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenus();
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-act]')) { e.preventDefault(); e.target.click(); }
    });
    window.addEventListener('hashchange', () => {
      const id = location.hash.replace('#', '');
      if (VIEWS.some((v) => v.id === id)) { state.view = id; render(); }
    });
    document.getElementById('themeBtn').addEventListener('click', toggleTheme);
    document.getElementById('fileInput').addEventListener('change', (e) => { addFiles(Array.from(e.target.files), 'your files'); e.target.value = ''; });
    document.getElementById('folderInput').addEventListener('change', (e) => { addFiles(Array.from(e.target.files), 'the folder'); e.target.value = ''; });
    let depth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');
      const files = await PL.filesFromDrop(e.dataTransfer);
      addFiles(files, 'the dropped files');
    });
    window.addEventListener('beforeprint', () => document.body.classList.add('printing'));
    window.addEventListener('afterprint', () => document.body.classList.remove('printing'));
    PL.onMapLoaded = () => {
      if (heatmap) heatmap.render();
      const root = document.getElementById('view');
      if (root) drawThumbnails(root);
    };
    if (window.PLAYTEST_LENS_BUNDLE) addBundle(window.PLAYTEST_LENS_BUNDLE, 'your project');
    else if (hash === 'sample' || window.PLAYTEST_LENS_AUTOSAMPLE) { state.view = 'overview'; render(); loadSample(); }
    else render();
  }

  init();
})();
