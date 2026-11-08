// Playtest Lens - statistics: levels, runs, choices, hotspots, stuck spots, frame rate.
(function () {
  'use strict';
  const PL = (window.PL = window.PL || {});
  const A = (PL.analysis = {});

  // --- Small statistics helpers -------------------------------------------------

  function quantile(values, q) {
    const v = values.filter((x) => x !== null && !Number.isNaN(x));
    if (!v.length) return null;
    v.sort((a, b) => a - b);
    const pos = (v.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  }
  const median = (values) => quantile(values, 0.5);
  const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function countBy(list, key) {
    const out = new Map();
    for (const item of list) {
      const k = key ? key(item) : item;
      out.set(k, (out.get(k) || 0) + 1);
    }
    return Array.from(out.entries()).sort((a, b) => b[1] - a[1]);
  }
  A.quantile = quantile;
  A.median = median;
  A.mean = mean;
  A.countBy = countBy;

  // Groups nearby points: the densest point seeds a cluster that takes every
  // unassigned point within the radius, then the next densest, and so on.
  A.cluster = function (points, radius) {
    const n = points.length;
    if (!n || !(radius > 0)) return [];
    const grid = new Map();
    const key = (x, y) => Math.floor(x / radius) + ',' + Math.floor(y / radius);
    points.forEach((p, i) => {
      const k = key(p.x, p.y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const near = (p) => {
      const out = [];
      const cx = Math.floor(p.x / radius);
      const cy = Math.floor(p.y / radius);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const i of grid.get(cx + dx + ',' + (cy + dy)) || []) {
            if (dist(p, points[i]) <= radius) out.push(i);
          }
        }
      }
      return out;
    };
    const neighbours = points.map(near);
    const order = points.map((_, i) => i).sort((a, b) => neighbours[b].length - neighbours[a].length);
    const owner = new Int32Array(n).fill(-1);
    const clusters = [];
    for (const i of order) {
      if (owner[i] >= 0) continue;
      const members = neighbours[i].filter((j) => owner[j] < 0);
      if (!members.length) continue;
      members.forEach((j) => { owner[j] = clusters.length; });
      clusters.push(members.map((j) => points[j]));
    }
    return clusters
      .map((members) => ({ members, x: mean(members.map((m) => m.x)), y: mean(members.map((m) => m.y)), r: radius }))
      .sort((a, b) => b.members.length - a.members.length);
  };

  // --- Top level ------------------------------------------------------------------

  A.analyze = function (dataset, sessions) {
    const cache = new Map();
    const ctx = { dataset, sessions, meta: dataset.meta, cache };
    const result = {
      sessions,
      summary: summary(sessions),
      runs: runStats(sessions),
      choices: choiceStats(sessions),
      items: countBy(sessions.flatMap((s) => s.items), (i) => i.id),
      causes: countBy(sessions.flatMap((s) => s.deaths), (d) => d.cause),
      notes: sessions.flatMap((s) => s.notes.map((n) => Object.assign({ session: s }, n))),
      levels: [],
      level: {},
    };
    for (const id of dataset.levels) {
      const L = levelAnalysis(ctx, id);
      if (!L.visits && !L.deathCount && !L.positionCount) continue;
      result.levels.push(L);
      result.level[id] = L;
    }
    return result;
  };

  // Positions of one session in one level, cached.
  function positionsOf(ctx, session, level) {
    const k = session.id + '\u0000' + level;
    if (!ctx.cache.has(k)) ctx.cache.set(k, session.pos.filter((p) => p.level === level));
    return ctx.cache.get(k);
  }

  function summary(sessions) {
    const runs = sessions.flatMap((s) => s.runs);
    const wins = runs.filter((r) => r.outcome === 'win').length;
    return {
      sessions: sessions.length,
      testers: new Set(sessions.map((s) => s.label)).size,
      playtime: sessions.reduce((t, s) => t + s.activeTime, 0),
      medianSession: median(sessions.map((s) => s.activeTime)),
      runs: runs.length,
      wins,
      winRate: runs.length ? wins / runs.length : null,
      deaths: sessions.reduce((n, s) => n + s.deaths.length, 0),
      notes: sessions.reduce((n, s) => n + s.notes.length, 0),
      crashes: sessions.filter((s) => !s.clean).length,
      midLevelQuits: sessions.filter((s) => s.clean && s.end && s.end.level).length,
      builds: Array.from(new Set(sessions.map((s) => s.build))),
    };
  }

  function runStats(sessions) {
    const runs = sessions.flatMap((s) => s.runs.map((r) => Object.assign({ session: s }, r)));
    // Every stage anyone reached, not just the stages where runs ended.
    const labels = new Map();
    const seen = new Set();
    for (const s of sessions) {
      for (const p of s.progress) {
        seen.add(p.value);
        if (p.label) labels.set(p.value, p.label);
      }
    }
    for (const r of runs) {
      seen.add(r.progress);
      if (r.label && !labels.has(r.progress)) labels.set(r.progress, r.label);
    }
    const values = Array.from(seen).filter((v) => v > 0).sort((a, b) => a - b);
    const stages = values.map((value) => {
      const reached = runs.filter((r) => r.progress >= value).length;
      const ended = runs.filter((r) => r.progress === value && r.outcome !== 'win' && r.outcome !== 'unfinished').length;
      const won = runs.filter((r) => r.progress === value && r.outcome === 'win').length;
      return { value, label: labels.get(value) || 'Stage ' + value, reached, ended, won, dropRate: reached ? ended / reached : 0 };
    });
    const wins = runs.filter((r) => r.outcome === 'win').length;
    return {
      list: runs,
      count: runs.length,
      wins,
      winRate: runs.length ? wins / runs.length : null,
      stages,
      outcomes: countBy(runs, (r) => r.outcome),
      durations: runs.map((r) => r.duration).filter((d) => d > 0),
      medianDuration: median(runs.map((r) => r.duration)),
      avgProgress: mean(runs.map((r) => r.progress)),
    };
  }

  // Pick rates, and whether picking an option helps compared with the same
  // decision when the option was offered but not taken.
  function choiceStats(sessions) {
    const decisions = sessions.flatMap((s) => s.choices.map((c) => Object.assign({ session: s, runInfo: s.runs.find((r) => r.index === c.run) }, c)));
    const kinds = Array.from(new Set(decisions.map((d) => d.kind)));
    return kinds.map((kind) => {
      const list = decisions.filter((d) => d.kind === kind);
      const ids = Array.from(new Set(list.flatMap((d) => d.options.concat([d.picked]))));
      const options = ids.map((id) => {
        const offered = list.filter((d) => d.options.includes(id) || d.picked === id);
        const picked = offered.filter((d) => d.picked === id);
        const skipped = offered.filter((d) => d.picked !== id);
        const outcome = (group) => {
          const finished = group.filter((d) => d.runInfo && d.runInfo.outcome !== 'unfinished');
          const wins = finished.filter((d) => d.runInfo.outcome === 'win').length;
          return {
            n: finished.length,
            wins,
            progress: mean(finished.map((d) => d.runInfo.progress)),
            winRate: finished.length ? wins / finished.length : null,
          };
        };
        return {
          id, name: PL.prettyName(id), offered: offered.length, picked: picked.length,
          pickRate: offered.length ? picked.length / offered.length : 0,
          with: outcome(picked), without: outcome(skipped),
          skippedFor: countBy(skipped, (d) => d.picked),
          skippedOutcomes: skippedOutcomes(skipped),
        };
      }).sort((a, b) => b.picked - a.picked);
      return { kind, decisions: list.length, options };
    });
  }

  // Wins and finished runs per alternative picked instead of an option.
  function skippedOutcomes(skipped) {
    const out = {};
    for (const d of skipped) {
      if (!d.runInfo || d.runInfo.outcome === 'unfinished') continue;
      const row = out[d.picked] || (out[d.picked] = { n: 0, wins: 0 });
      row.n++;
      if (d.runInfo.outcome === 'win') row.wins++;
    }
    return out;
  }

  // --- Per level ------------------------------------------------------------------

  function levelAnalysis(ctx, id) {
    const sessions = ctx.sessions;
    const meta = ctx.meta[id] || { id, name: PL.prettyName(id), zones: [] };
    const visits = sessions.flatMap((s) => s.visits.filter((v) => v.level === id).map((v) => Object.assign({ session: s }, v)));
    const completes = visits.filter((v) => v.result === 'complete');
    const allDeaths = sessions.flatMap((s) => s.deaths.filter((d) => d.level === id).map((d) => Object.assign({ session: s }, d)));
    const deaths = allDeaths.filter((d) => d.x !== null);
    let positionCount = 0;
    const speeds = [];
    const bbox = [];
    for (const s of sessions) {
      const pts = positionsOf(ctx, s, id);
      positionCount += pts.length;
      for (let i = 1; i < pts.length; i++) {
        const dt = pts[i].t - pts[i - 1].t;
        if (dt > 0 && dt <= 1.2) {
          const v = dist(pts[i], pts[i - 1]) / dt;
          if (v > 0) speeds.push(v);
        }
      }
      if (pts.length) bbox.push(pts[0], pts[pts.length - 1]);
    }
    const extent = levelExtent(meta, bbox.concat(deaths));
    const r = Math.max(Math.hypot(extent.w, extent.h) * 0.035, 1e-6);
    const L = {
      id, name: meta.name || PL.prettyName(id), meta, extent, r,
      visits: visits.length,
      visitList: visits,
      visitors: new Set(visits.map((v) => v.session.id)).size,
      completes: completes.length,
      completion: visits.length ? completes.length / visits.length : null,
      deathCount: allDeaths.length,
      deaths,
      deathsPerVisit: visits.length ? allDeaths.length / visits.length : null,
      durations: completes.map((v) => v.duration),
      durationMedian: median(completes.map((v) => v.duration)),
      durationP25: quantile(completes.map((v) => v.duration), 0.25),
      durationP75: quantile(completes.map((v) => v.duration), 0.75),
      positionCount,
      speedMedian: median(speeds.filter((v) => v > r * 0.3)) || median(speeds) || 1,
      notes: sessions.flatMap((s) => s.notes.filter((n) => n.level === id).map((n) => Object.assign({ session: s }, n))),
      customs: sessions.flatMap((s) => s.customs.filter((c) => c.level === id).map((c) => Object.assign({ session: s }, c))),
      items: sessions.flatMap((s) => s.items.filter((i) => i.level === id).map((i) => Object.assign({ session: s }, i))),
    };
    L.perf = perfAnalysis(sessions, L);
    L.quits = sessions
      .filter((s) => s.end && s.end.level === id && s.end.x !== null && s.clean)
      .map((s) => ({ x: s.end.x, y: s.end.y, t: s.end.t, session: s, reason: s.end.reason }));
    L.crashes = sessions
      .filter((s) => !s.clean && s.end && s.end.level === id)
      .map((s) => ({ x: s.end.x, y: s.end.y, t: s.end.t, session: s }));
    L.deathClusters = groupByZone(L, deaths, r).map((c) => enrichDeaths(ctx, L, c));
    L.quitClusters = A.cluster(L.quits.filter((q) => q.x !== null), r * 1.5).map((c) => enrichQuits(ctx, L, c));
    const stuck = stuckAnalysis(ctx, L);
    L.stuckIntervals = stuck.intervals;
    L.stuckSpots = stuck.spots;
    L.lingerSpots = stuck.linger;
    return L;
  }

  function levelExtent(meta, points) {
    if (meta && meta.map && meta.map.meta && meta.map.meta.rect) {
      const [x, y, w, h] = meta.map.meta.rect;
      return { x, y, w, h, source: 'map' };
    }
    if (meta && meta.bounds) {
      const [x, y, w, h] = meta.bounds;
      return { x: x - w * 0.03, y: y - h * 0.03, w: w * 1.06, h: h * 1.06, source: 'bounds' };
    }
    const pts = points.filter((p) => p && p.x !== null);
    if (!pts.length) return { x: 0, y: 0, w: 100, h: 100, source: 'none' };
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const w = Math.max(x1 - x0, 1);
    const h = Math.max(y1 - y0, 1);
    return { x: x0 - w * 0.08, y: y0 - h * 0.08, w: w * 1.16, h: h * 1.16, source: 'points' };
  }

  // Names a spot after the zone it is in (or next to), if the game defined zones.
  A.zoneAt = function (L, x, y) {
    const zones = (L.meta && L.meta.zones) || [];
    let best = null;
    let bestScore = Infinity;
    for (const z of zones) {
      const [zx, zy, zw, zh] = z.rect;
      const dx = Math.max(zx - x, 0, x - (zx + zw));
      const dy = Math.max(zy - y, 0, y - (zy + zh));
      const outside = Math.hypot(dx, dy);
      const score = outside > 0 ? 1e9 + outside : zw * zh;
      if (outside <= L.r * 1.2 && score < bestScore) { best = z.name; bestScore = score; }
    }
    return best;
  };

  A.placeName = function (L, x, y, fallback) {
    return A.zoneAt(L, x, y) || fallback || 'near (' + Math.round(x) + ', ' + Math.round(y) + ')';
  };

  // Deaths inside one named zone are one hotspot (a long tunnel is one place
  // to a designer). Deaths outside zones are clustered by distance.
  function groupByZone(L, points, r) {
    const zoned = new Map();
    const loose = [];
    for (const p of points) {
      const zone = A.zoneAt(L, p.x, p.y);
      if (!zone) { loose.push(p); continue; }
      if (!zoned.has(zone)) zoned.set(zone, []);
      zoned.get(zone).push(p);
    }
    const out = [];
    for (const [zone, members] of zoned) {
      if (members.length < 2) { loose.push(...members); continue; }
      const x = mean(members.map((m) => m.x));
      const y = mean(members.map((m) => m.y));
      const spread = quantile(members.map((m) => Math.hypot(m.x - x, m.y - y)), 0.8) || 0;
      out.push({ members, x, y, r: Math.min(r * 4, Math.max(r, spread)), zone });
    }
    for (const c of A.cluster(loose, r)) if (c.members.length >= 2) out.push(c);
    return out.sort((a, b) => b.members.length - a.members.length);
  }

  function enrichDeaths(ctx, L, c) {
    const members = c.members;
    const sessionIds = new Set(members.map((d) => d.session.id));
    const causes = countBy(members, (d) => d.cause);
    const inArea = [];
    const arrival = [];
    const before = new Map();
    let runEnders = 0;
    for (const d of members) {
      const pts = positionsOf(ctx, d.session, L.id);
      let i = lastIndexBefore(pts, d.t);
      if (i >= 0) {
        let start = d.t;
        let j = i;
        while (j >= 0 && dist(pts[j], d) <= L.r * 1.25 && d.t - pts[j].t < 120) { start = pts[j].t; j--; }
        inArea.push(d.t - start);
        let k = i;
        while (k > 0 && d.t - pts[k - 1].t <= 1.6) k--;
        if (d.t - pts[k].t >= 0.4) arrival.push(dist(pts[k], d) / (d.t - pts[k].t));
      }
      const names = new Set(d.session.customs.filter((e) => e.t <= d.t && d.t - e.t <= 3).map((e) => e.name));
      for (const n of names) before.set(n, (before.get(n) || 0) + 1);
      const run = d.session.runs.find((r) => r.index === d.run);
      if (run && run.outcome === 'death' && Math.abs((run.end || 0) - d.t) < 0.1) runEnders++;
    }
    const perSession = countBy(members, (d) => d.session.id);
    let passed = 0;
    for (const [sid] of perSession) {
      const firstDeath = Math.min(...members.filter((d) => d.session.id === sid).map((d) => d.t));
      const s = members.find((d) => d.session.id === sid).session;
      if (s.visits.some((v) => v.level === L.id && v.result === 'complete' && v.end > firstDeath)) passed++;
    }
    const precededBy = Array.from(before.entries()).sort((a, b) => b[1] - a[1]);
    // Frame rate where these deaths happen: the zone's samples if it has a zone.
    const zoneFps = c.zone ? L.perf.zones.find((z) => z.zone === c.zone) : null;
    const nearbyFps = L.perf.samples.filter((p) => p.x !== null && Math.hypot(p.x - c.x, p.y - c.y) <= c.r * 1.5).map((p) => p.fps);
    const fpsMedian = zoneFps && zoneFps.n >= 3 ? zoneFps.median : nearbyFps.length >= 3 ? median(nearbyFps) : null;
    const rage = [];
    for (const sid of sessionIds) {
      const s = members.find((d) => d.session.id === sid).session;
      if (!s.end || s.end.level !== L.id) continue;
      const last = members.filter((d) => d.session.id === sid).reduce((m, d) => Math.max(m, d.t), -1);
      if (s.end.t - last <= 45 && s.end.t >= last) rage.push(s);
    }
    return Object.assign(c, {
      count: members.length,
      sessions: sessionIds.size,
      causes,
      medianInArea: median(inArea),
      fastShare: inArea.length ? inArea.filter((t) => t < 1.5).length / inArea.length : null,
      arrivalRatio: arrival.length >= 3 ? median(arrival) / L.speedMedian : null,
      precededBy,
      perSessionMax: perSession.length ? perSession[0][1] : 0,
      perAffected: members.length / sessionIds.size,
      passed,
      passRate: sessionIds.size ? passed / sessionIds.size : null,
      runEnders,
      fpsMedian,
      rageQuits: rage,
      notes: L.notes.filter((n) => n.x !== null && Math.hypot(n.x - c.x, n.y - c.y) <= c.r * 2),
      upgradeEffect: upgradeEffect(L, members),
    });
  }

  // Compares deaths here per visit for visits with and without each pick.
  function upgradeEffect(L, members) {
    const rows = new Map();
    for (const v of L.visitList) {
      const run = v.session.runs.find((r) => r.index === v.run);
      const picks = new Set(run ? run.picks.filter((p) => p.t <= v.start + 0.01).map((p) => p.picked) : []);
      const here = members.filter((d) => d.session === v.session && d.t >= v.start && d.t <= v.end + 0.01).length;
      for (const p of run ? run.picks : []) {
        for (const option of p.options.concat([p.picked])) {
          if (!rows.has(option)) rows.set(option, { id: option, withVisits: 0, withDeaths: 0, withoutVisits: 0, withoutDeaths: 0, withSessions: new Set() });
        }
      }
      for (const row of rows.values()) {
        if (picks.has(row.id)) { row.withVisits++; row.withDeaths += here; row.withSessions.add(v.session.id); }
        else { row.withoutVisits++; row.withoutDeaths += here; }
      }
    }
    let best = null;
    for (const row of rows.values()) {
      if (row.withVisits < 6 || row.withoutVisits < 6 || row.withSessions.size < 3) continue;
      const rWith = row.withDeaths / row.withVisits;
      const rWithout = row.withoutDeaths / row.withoutVisits;
      const ratio = rWithout / Math.max(rWith, 0.05);
      // Two-sample test on death rates, so small groups cannot fake a pattern.
      const pooled = (row.withDeaths + row.withoutDeaths) / (row.withVisits + row.withoutVisits);
      const z = (rWithout - rWith) / Math.sqrt(Math.max(pooled, 1e-6) * (1 / row.withVisits + 1 / row.withoutVisits));
      if (ratio >= 2 && rWithout >= 0.3 && z >= 2.5 && (!best || z > best.z)) {
        best = { id: row.id, rateWith: rWith, rateWithout: rWithout, ratio, z, n: row.withVisits + row.withoutVisits };
      }
    }
    return best;
  }

  function enrichQuits(ctx, L, c) {
    let afterDeath = 0;
    const causes = new Map();
    for (const q of c.members) {
      const d = q.session.deaths.filter((x) => x.t <= q.t && q.t - x.t <= 45).pop();
      if (d) { afterDeath++; causes.set(d.cause, (causes.get(d.cause) || 0) + 1); }
    }
    return Object.assign(c, {
      count: c.members.length,
      sessions: new Set(c.members.map((q) => q.session.id)).size,
      afterDeath,
      deathCauses: Array.from(causes.entries()).sort((a, b) => b[1] - a[1]),
      medianSessionTime: median(c.members.map((q) => q.t)),
      notes: L.notes.filter((n) => n.x !== null && Math.hypot(n.x - c.x, n.y - c.y) <= c.r * 2),
    });
  }

  function lastIndexBefore(pts, t) {
    let lo = 0;
    let hi = pts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // --- Stuck detection --------------------------------------------------------------

  // A player is "stuck" when they spend at least 10 seconds inside a small
  // area while moving around (wandering) - not standing still or away.
  function stuckAnalysis(ctx, L) {
    const R = L.r * 2.5;
    const minDuration = 10;
    const intervals = [];
    for (const s of ctx.sessions) {
      const pts = positionsOf(ctx, s, L.id);
      if (pts.length < 6) continue;
      const steps = [];
      for (let i = 1; i < pts.length; i++) steps.push(pts[i].t - pts[i - 1].t);
      const step = median(steps) || 0.5;
      const maxGap = Math.max(step * 3, 2);
      const segments = [];
      let seg = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].t - pts[i - 1].t > maxGap || dist(pts[i], pts[i - 1]) > R * 3) { segments.push(seg); seg = []; }
        seg.push(pts[i]);
      }
      segments.push(seg);
      for (const sg of segments) {
        let i = 0;
        while (i < sg.length) {
          let cx = sg[i].x;
          let cy = sg[i].y;
          let n = 1;
          let j = i;
          while (j + 1 < sg.length) {
            const p = sg[j + 1];
            const nx = (cx * n + p.x) / (n + 1);
            const ny = (cy * n + p.y) / (n + 1);
            if (Math.hypot(p.x - nx, p.y - ny) > R) break;
            cx = nx; cy = ny; n++; j++;
          }
          const duration = sg[j].t - sg[i].t;
          if (duration >= minDuration) {
            let path = 0;
            let inputs = 0;
            for (let k = i; k < j; k++) path += dist(sg[k], sg[k + 1]);
            for (let k = i; k <= j; k++) inputs += sg[k].in;
            const moving = path >= R * 1.5;
            if (moving || inputs / (j - i + 1) >= 0.5) {
              intervals.push({ session: s, t0: sg[i].t, t1: sg[j].t, duration, x: cx, y: cy, path, kind: moving ? 'wander' : 'linger', next: sg[j + 1] || null });
            }
            i = j + 1;
          } else {
            i++;
          }
        }
      }
    }
    for (const iv of intervals) {
      const s = iv.session;
      iv.quit = !!(s.end && s.end.level === L.id && s.end.t >= iv.t0 && s.end.t - iv.t1 <= 12);
      iv.died = s.deaths.some((d) => d.level === L.id && d.t >= iv.t1 - 0.5 && d.t <= iv.t1 + 4);
      iv.after = s.customs.filter((c) => c.t >= iv.t0 && c.t <= iv.t1 + 6).map((c) => c.name);
      iv.exit = null;
      if (!iv.quit && !iv.died) {
        const pts = positionsOf(ctx, s, L.id);
        const later = pts.find((p) => p.t > iv.t1 && p.t <= iv.t1 + 15 && Math.hypot(p.x - iv.x, p.y - iv.y) > R);
        if (later) {
          const len = Math.hypot(later.x - iv.x, later.y - iv.y);
          iv.exit = { x: (later.x - iv.x) / len, y: (later.y - iv.y) / len };
        }
      }
    }
    const summarize = (group) => {
      const list = group.members.map((m) => m.iv);
      const bySession = new Map();
      for (const iv of list) bySession.set(iv.session.id, (bySession.get(iv.session.id) || 0) + iv.duration);
      const exits = list.filter((iv) => iv.exit);
      let ex = 0;
      let ey = 0;
      for (const iv of exits) { ex += iv.exit.x; ey += iv.exit.y; }
      const consistency = exits.length ? Math.hypot(ex, ey) / exits.length : 0;
      const names = new Map();
      for (const iv of exits) for (const n of new Set(iv.after)) names.set(n, (names.get(n) || 0) + 1);
      return {
        x: group.x, y: group.y, r: R,
        intervals: list,
        sessions: bySession.size,
        totalTime: list.reduce((t, iv) => t + iv.duration, 0),
        perSession: Array.from(bySession.values()),
        avgPerSession: mean(Array.from(bySession.values())),
        longest: Math.max(...list.map((iv) => iv.duration)),
        quits: list.filter((iv) => iv.quit).length,
        deaths: list.filter((iv) => iv.died).length,
        exits: exits.length,
        exitDirection: consistency >= 0.6 && exits.length >= 2 ? { x: ex / exits.length, y: ey / exits.length, consistency } : null,
        exitEvents: Array.from(names.entries()).sort((a, b) => b[1] - a[1]),
        notes: L.notes.filter((n) => n.x !== null && Math.hypot(n.x - group.x, n.y - group.y) <= R * 1.6),
      };
    };
    const wander = intervals.filter((iv) => iv.kind === 'wander').map((iv) => ({ x: iv.x, y: iv.y, iv }));
    const linger = intervals.filter((iv) => iv.kind === 'linger').map((iv) => ({ x: iv.x, y: iv.y, iv }));
    return {
      intervals,
      spots: A.cluster(wander, R).map(summarize).sort((a, b) => b.totalTime - a.totalTime),
      linger: A.cluster(linger, R).map(summarize).sort((a, b) => b.totalTime - a.totalTime),
    };
  }

  // --- Frame rate -------------------------------------------------------------------

  function perfAnalysis(sessions, L) {
    const samples = sessions.flatMap((s) => s.perf.filter((p) => p.level === L.id).map((p) => Object.assign({ session: s }, p)));
    const fps = samples.map((p) => p.fps);
    const low = samples.filter((p) => p.fps < 30);
    const spots = A.cluster(low.filter((p) => p.x !== null), L.r * 1.5).map((c) => ({
      x: c.x, y: c.y, r: c.r, count: c.members.length,
      sessions: new Set(c.members.map((p) => p.session.id)).size,
      fpsMedian: median(c.members.map((p) => p.fps)),
    }));
    const byGpu = new Map();
    for (const p of samples) {
      const gpu = p.session.gpu || p.session.platform || 'unknown';
      if (!byGpu.has(gpu)) byGpu.set(gpu, []);
      byGpu.get(gpu).push(p.fps);
    }
    const byZone = new Map();
    for (const p of samples) {
      if (p.x === null) continue;
      const zone = A.zoneAt(L, p.x, p.y);
      if (!zone) continue;
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone).push(p);
    }
    const zones = Array.from(byZone.entries()).map(([zone, list]) => {
      const rest = samples.filter((p) => !list.includes(p)).map((p) => p.fps);
      return {
        zone, n: list.length,
        sessions: new Set(list.map((p) => p.session.id)).size,
        median: median(list.map((p) => p.fps)),
        lowShare: list.filter((p) => p.fps < 30).length / list.length,
        elsewhere: median(rest),
      };
    }).sort((a, b) => a.median - b.median);
    return {
      samples,
      count: samples.length,
      median: median(fps),
      p05: quantile(fps, 0.05),
      lowShare: samples.length ? low.length / samples.length : 0,
      spots,
      zones,
      byGpu: Array.from(byGpu.entries()).map(([gpu, list]) => ({ gpu, median: median(list), lowShare: list.filter((f) => f < 30).length / list.length, n: list.length })),
    };
  }

  // --- Build comparison ----------------------------------------------------------------

  // Hotspots are found on both builds together so the same place can be
  // compared like for like.
  A.compare = function (dataset, buildA, buildB) {
    const sa = dataset.sessions.filter((s) => s.build === buildA);
    const sb = dataset.sessions.filter((s) => s.build === buildB);
    const both = A.analyze(dataset, sa.concat(sb));
    const a = A.analyze(dataset, sa);
    const b = A.analyze(dataset, sb);
    const levels = both.levels.map((L) => {
      const La = a.level[L.id];
      const Lb = b.level[L.id];
      const spots = L.deathClusters.slice(0, 4).map((c) => {
        const inBuild = (build, Lx) => {
          const count = c.members.filter((d) => d.session.build === build).length;
          return { count, perVisit: Lx && Lx.visits ? count / Lx.visits : null };
        };
        return { x: c.x, y: c.y, r: c.r, name: A.placeName(L, c.x, c.y, PL.prettyName(c.causes[0][0])), cause: c.causes[0][0], a: inBuild(buildA, La), b: inBuild(buildB, Lb) };
      });
      const stuck = L.stuckSpots.slice(0, 3).map((spot) => {
        // Per visit, so a build where people play longer is not penalised.
        const timeFor = (build, Lx) => {
          const total = spot.intervals.filter((iv) => iv.session.build === build).reduce((t, iv) => t + iv.duration, 0);
          return { total, perVisit: Lx && Lx.visits ? total / Lx.visits : null };
        };
        return { x: spot.x, y: spot.y, r: spot.r, name: A.placeName(L, spot.x, spot.y, 'this area'), a: timeFor(buildA, La), b: timeFor(buildB, Lb) };
      });
      return { id: L.id, name: L.name, a: La || null, b: Lb || null, spots, stuck };
    });
    return { buildA, buildB, a, b, levels };
  };
})();
