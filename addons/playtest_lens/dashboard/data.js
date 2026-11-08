// Playtest Lens - loading and parsing session files (JSON Lines) and level maps.
(function () {
  'use strict';
  const PL = (window.PL = window.PL || {});

  PL.createStore = function () {
    return { sessions: new Map(), maps: new Map(), pendingMeta: new Map(), pendingImages: new Map() };
  };

  // --- Session parsing ------------------------------------------------------

  // 3D positions are [x, y, z]; maps look straight down, so they use x and z.
  function point(p) {
    if (!Array.isArray(p) || p.length < 2) return null;
    return p.length >= 3 ? { x: +p[0], y: +p[2] } : { x: +p[0], y: +p[1] };
  }

  PL.parseSession = function (text, fileName) {
    const s = {
      id: null, file: fileName, game: '', build: 'dev', tester: '', testerName: '', platform: '', gpu: '',
      godot: '', started: null, clock: 'real', duration: 0, activeTime: 0,
      pos: [], deaths: [], items: [], choices: [], customs: [], notes: [], perf: [],
      runs: [], visits: [], progress: [], attrs: {}, gaps: [], levelInfo: {}, end: null, badLines: 0,
    };
    let level = '';
    let run = null;
    let visit = null;
    let pausedAt = null;
    let unfocusedAt = null;
    let lastT = 0;
    let lastPoint = null;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.charCodeAt(0) !== 123) continue;
      let ev;
      try { ev = JSON.parse(line); } catch (err) { s.badLines++; continue; }
      const t = +ev.t || 0;
      if (t > lastT) lastT = t;
      const where = point(ev.p);
      const lv = ev.level !== undefined ? ev.level : level;
      if (where) lastPoint = { x: where.x, y: where.y, level: lv };
      switch (ev.e) {
        case 'session_start':
          s.id = ev.sid || fileName;
          s.game = ev.game || '';
          s.build = String(ev.build || 'dev');
          s.tester = ev.tester || 'unknown';
          s.testerName = ev.tester_name || '';
          s.platform = ev.platform || '';
          s.gpu = ev.gpu || '';
          s.godot = ev.godot || '';
          s.started = ev.started ? new Date(ev.started) : null;
          s.clock = ev.clock || 'real';
          break;
        case 'level_start':
          if (visit && visit.result === null) { visit.end = t; visit.result = 'left'; }
          level = ev.level;
          visit = { level, start: t, end: null, result: null, run: ev.run || (run ? run.index : 0), deaths: 0 };
          s.visits.push(visit);
          if (run) run.levels.push(level);
          break;
        case 'level_end':
          if (visit && visit.level === ev.level && visit.result === null) {
            visit.end = t;
            visit.result = ev.result || 'left';
          }
          visit = null;
          level = '';
          break;
        case 'pos':
          if (where) s.pos.push({ t, x: where.x, y: where.y, in: +ev.in || 0, level, id: ev.id || '' });
          break;
        case 'death':
          s.deaths.push({ t, level: lv, x: where ? where.x : null, y: where ? where.y : null, cause: ev.cause || 'unknown', run: ev.run || 0, data: ev.data });
          if (visit) visit.deaths++;
          if (run) run.deaths++;
          break;
        case 'item':
          s.items.push({ t, level: lv, id: String(ev.id), x: where ? where.x : null, y: where ? where.y : null, run: ev.run || 0 });
          break;
        case 'choice': {
          const c = { t, level: lv, kind: ev.kind || 'choice', options: (ev.options || []).map(String), picked: String(ev.picked), run: ev.run || 0 };
          s.choices.push(c);
          if (run) run.picks.push(c);
          break;
        }
        case 'event':
          s.customs.push({ t, level: lv, name: String(ev.name), x: where ? where.x : null, y: where ? where.y : null, data: ev.data });
          break;
        case 'note':
          s.notes.push({ t, level: lv, text: String(ev.text || ''), x: where ? where.x : null, y: where ? where.y : null });
          break;
        case 'perf':
          s.perf.push({ t, level: lv, fps: +ev.fps || 0, ms: +ev.ms || 0, mem: +ev.mem || 0, x: where ? where.x : null, y: where ? where.y : null });
          break;
        case 'run_start':
          if (run && run.outcome === null) { run.end = t; run.outcome = 'abandoned'; }
          run = { index: ev.run, start: t, end: null, outcome: null, progress: 0, label: '', picks: [], deaths: 0, levels: [] };
          s.runs.push(run);
          break;
        case 'run_end':
          if (run && run.index === ev.run) {
            run.end = t;
            run.outcome = ev.outcome || 'ended';
            if (ev.progress !== undefined) run.progress = +ev.progress;
            if (ev.label) run.label = ev.label;
            run = null;
          }
          break;
        case 'progress':
          s.progress.push({ t, value: +ev.value, label: ev.label || String(ev.value) });
          if (run) { run.progress = +ev.value; run.label = ev.label || String(ev.value); }
          break;
        case 'pause':
          if (ev.state) pausedAt = t;
          else if (pausedAt !== null) { s.gaps.push([pausedAt, t]); pausedAt = null; }
          break;
        case 'focus':
          if (!ev.state) unfocusedAt = t;
          else if (unfocusedAt !== null) { s.gaps.push([unfocusedAt, t]); unfocusedAt = null; }
          break;
        case 'level_info':
          s.levelInfo[ev.level] = { mode: ev.mode || '2d', bounds: ev.bounds || null, zones: ev.zones || [] };
          break;
        case 'attribute':
          s.attrs[ev.key] = ev.value;
          if (ev.key === 'tester_name') s.testerName = String(ev.value);
          break;
        case 'session_end':
          s.end = { t, reason: ev.reason || 'quit', level: ev.level || '', x: where ? where.x : null, y: where ? where.y : null, run: ev.run || 0 };
          break;
        default:
          break;
      }
    }
    if (!s.id) return null;
    if (pausedAt !== null) s.gaps.push([pausedAt, lastT]);
    if (unfocusedAt !== null) s.gaps.push([unfocusedAt, lastT]);
    s.duration = s.end ? s.end.t : lastT;
    s.clean = !!s.end && s.end.reason !== 'crash';
    s.endReason = s.end ? s.end.reason : 'abrupt';
    if (!s.end) {
      // No session_end line: use the last position any event recorded.
      const last = lastPoint;
      s.end = { t: lastT, reason: 'abrupt', level: level || (last ? last.level : ''), x: last ? last.x : null, y: last ? last.y : null, run: run ? run.index : 0 };
      if (run && run.outcome === null) { run.end = lastT; run.outcome = 'crash'; }
      if (visit && visit.result === null) { visit.end = lastT; visit.result = 'crash'; }
    }
    for (const r of s.runs) {
      if (r.outcome === null) { r.end = s.duration; r.outcome = 'unfinished'; }
      r.duration = (r.end || s.duration) - r.start;
    }
    for (const v of s.visits) {
      if (v.end === null) { v.end = s.duration; v.result = 'unfinished'; }
      v.duration = v.end - v.start;
    }
    let gapTime = 0;
    for (const g of s.gaps) gapTime += Math.max(0, g[1] - g[0]);
    s.activeTime = Math.max(0, s.duration - gapTime);
    s.label = s.testerName || s.tester;
    return s;
  };

  // --- Loading files ----------------------------------------------------------

  // Accepts File objects (from an input or a drop), and {name, text} or
  // {name, data} objects (from the dashboard bundle or a zip).
  PL.addFiles = async function (store, files) {
    const report = { sessions: 0, duplicates: 0, maps: 0, ignored: 0, errors: [] };
    for (const file of files) {
      const name = file.name || '';
      const ext = name.split('.').pop().toLowerCase();
      try {
        if (ext === 'zip') {
          const buffer = file.arrayBuffer ? await file.arrayBuffer() : file.data.buffer;
          const entries = await PL.unzip(buffer);
          const inner = entries.map((e) => ({ name: e.name.split('/').pop(), data: e.data }));
          const sub = await PL.addFiles(store, inner);
          report.sessions += sub.sessions; report.duplicates += sub.duplicates; report.maps += sub.maps;
          report.errors.push(...sub.errors);
        } else if (ext === 'jsonl') {
          const text = await readText(file);
          const session = PL.parseSession(text, name);
          if (!session) { report.ignored++; continue; }
          if (store.sessions.has(session.id)) { report.duplicates++; continue; }
          store.sessions.set(session.id, session);
          report.sessions++;
        } else if (ext === 'json') {
          const meta = JSON.parse(await readText(file));
          if (meta && meta.rect) {
            const base = name.replace(/\.json$/i, '');
            if (store.pendingImages.has(base)) { addMap(store, meta, store.pendingImages.get(base)); store.pendingImages.delete(base); report.maps++; }
            else store.pendingMeta.set(base, meta);
          } else report.ignored++;
        } else if (ext === 'png') {
          const base = name.replace(/\.png$/i, '');
          const src = file.src || URL.createObjectURL(file instanceof Blob ? file : new Blob([file.data], { type: 'image/png' }));
          if (file.meta) { addMap(store, file.meta, src); report.maps++; }
          else if (store.pendingMeta.has(base)) { addMap(store, store.pendingMeta.get(base), src); store.pendingMeta.delete(base); report.maps++; }
          else store.pendingImages.set(base, src);
        } else {
          report.ignored++;
        }
      } catch (err) {
        report.errors.push(name + ': ' + err.message);
      }
    }
    return report;
  };

  // The dashboard bundle (built by the editor) and the sample data share a shape.
  PL.addBundle = async function (store, bundle) {
    const files = (bundle.files || []).map((f) => ({ name: f.name, text: f.text }));
    const maps = (bundle.maps || []).map((m) => ({ name: m.name, src: m.png, meta: m.meta }));
    return PL.addFiles(store, files.concat(maps));
  };

  // Folders dropped onto the page arrive as directory entries.
  PL.filesFromDrop = async function (dataTransfer) {
    const out = [];
    const items = Array.from(dataTransfer.items || []);
    const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length) return Array.from(dataTransfer.files || []);
    async function walk(entry) {
      if (entry.isFile) {
        out.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          for (const child of batch) await walk(child);
        } while (batch.length);
      }
    }
    for (const entry of entries) await walk(entry);
    return out;
  };

  function addMap(store, meta, src) {
    const level = meta.level;
    if (!level) return;
    const existing = store.maps.get(level);
    if (existing && existing.meta.captured && meta.captured && existing.meta.captured > meta.captured) return;
    const img = new Image();
    const entry = { level, meta, src, img, ready: false };
    img.onload = () => { entry.ready = true; if (PL.onMapLoaded) PL.onMapLoaded(level); };
    img.src = src;
    store.maps.set(level, entry);
  }

  async function readText(file) {
    if (typeof file.text === 'string') return file.text;
    if (file.data) return new TextDecoder().decode(file.data);
    return await file.text();
  }

  // --- Dataset ----------------------------------------------------------------

  PL.buildDataset = function (store) {
    // A clean session with no levels, positions or play time carries no information.
    const sessions = Array.from(store.sessions.values())
      .filter((s) => s.visits.length || s.pos.length || !s.clean || s.duration >= 5)
      .sort((a, b) => (a.started || 0) - (b.started || 0));
    const builds = unique(sessions.map((s) => s.build)).sort(PL.compareVersions);
    const testers = unique(sessions.map((s) => s.label)).sort();
    const games = countBy(sessions.map((s) => s.game).filter(Boolean));
    const game = Object.keys(games).sort((a, b) => games[b] - games[a])[0] || 'Playtest';

    // Order levels the way players meet them: average rank of first visit.
    const rank = {};
    for (const s of sessions) {
      const seen = [];
      for (const v of s.visits) if (!seen.includes(v.level)) seen.push(v.level);
      seen.forEach((level, i) => { (rank[level] = rank[level] || []).push(i); });
    }
    for (const d of sessions.flatMap((s) => s.deaths)) if (d.level && !rank[d.level]) rank[d.level] = [99];
    const levels = Object.keys(rank).filter(Boolean).sort((a, b) => avg(rank[a]) - avg(rank[b]));

    const meta = {};
    for (const level of levels) {
      const info = { id: level, name: PL.prettyName(level), mode: '2d', bounds: null, zones: [], map: store.maps.get(level) || null };
      for (const s of sessions) {
        const li = s.levelInfo[level];
        if (!li) continue;
        info.mode = li.mode || info.mode;
        if (li.bounds && !info.bounds) info.bounds = li.bounds;
        if (li.zones && li.zones.length && !info.zones.length) info.zones = li.zones;
      }
      if (info.map && info.map.meta.zones && info.map.meta.zones.length) info.zones = info.map.meta.zones;
      meta[level] = info;
    }
    return { sessions, builds, testers, game, levels, meta, mapCount: store.maps.size };
  };

  PL.filterSessions = function (dataset, filters) {
    return dataset.sessions.filter((s) =>
      (filters.build === 'all' || s.build === filters.build) &&
      (filters.tester === 'all' || s.label === filters.tester));
  };

  // --- Small shared helpers ---------------------------------------------------

  PL.prettyName = function (id) {
    return String(id || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  PL.compareVersions = function (a, b) {
    const pa = String(a).split(/[^0-9]+/).filter(Boolean).map(Number);
    const pb = String(b).split(/[^0-9]+/).filter(Boolean).map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return String(a).localeCompare(String(b));
  };

  function unique(list) { return Array.from(new Set(list)); }
  function avg(list) { return list.reduce((a, b) => a + b, 0) / (list.length || 1); }
  function countBy(list) { const out = {}; for (const k of list) out[k] = (out[k] || 0) + 1; return out; }
})();
