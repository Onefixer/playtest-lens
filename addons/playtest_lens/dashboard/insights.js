// Playtest Lens - the insights engine. Turns the statistics into findings a
// designer can act on: what is happening, where, why it seems to happen, how
// sure we are, and what to try. Runs locally; nothing leaves the browser.
(function () {
  'use strict';
  const PL = (window.PL = window.PL || {});
  const A = PL.analysis;
  const SEVERITY_RANK = { critical: 4, warning: 3, info: 2, good: 1 };

  const pct = (x) => Math.round((x || 0) * 100) + '%';
  const plural = (n, word, many) => n + ' ' + (n === 1 ? word : many || word + 's');
  const quote = (text) => '“' + text + '”';
  const confidenceFor = (n) => (n >= 8 ? 'high' : n >= 4 ? 'medium' : 'low');
  const DIRECTIONS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const direction = (v) => DIRECTIONS[(Math.round(Math.atan2(v.y, v.x) / (Math.PI / 4)) + 8) % 8];

  PL.formatSeconds = function (s) {
    if (s === null || s === undefined || Number.isNaN(s)) return '–';
    if (s < 10) return s.toFixed(1) + ' s';
    if (s < 90) return Math.round(s) + ' s';
    if (s < 3570) {
      const total = Math.round(s);
      const r = total % 60;
      return Math.floor(total / 60) + ' min' + (r ? ' ' + r + ' s' : '');
    }
    const minutes = Math.round(s / 60);
    const m = minutes % 60;
    return Math.floor(minutes / 60) + ' h' + (m ? ' ' + m + ' min' : '');
  };
  const secs = PL.formatSeconds;

  // Tester notes are free text; a few keyword themes let the analyst connect
  // them to what the numbers show ("testers say it lags here").
  const THEMES = [
    { id: 'performance', label: 'lag or frame rate', words: ['lag', 'choppy', 'stutter', 'fps', 'frame rate', 'framerate', 'freez', 'hitch', 'slow down', 'slows down'] },
    { id: 'lost', label: 'getting lost', words: ['lost', 'where do i', 'where to go', 'how do i', 'dead end', 'way forward', 'way out', 'confus', 'no idea where', 'stuck'] },
    { id: 'difficulty', label: 'difficulty', words: ['hard', 'impossible', 'unfair', 'too fast', 'frustrat', 'difficult', 'giving up', 'give up'] },
    { id: 'visibility', label: 'not seeing things', words: ['can’t see', 'can\'t see', 'cannot see', 'too dark', 'hard to see', 'invisible', 'couldn\'t see'] },
    { id: 'bug', label: 'bugs', words: ['bug', 'glitch', 'crash', 'broken', 'fell through', 'clipped'] },
    { id: 'positive', label: 'praise', words: ['fun', 'love', 'great', 'nice', 'cool', 'awesome', 'enjoy'] },
  ];
  PL.noteThemes = function (notes) {
    const counts = THEMES.map((t) => ({ id: t.id, label: t.label, notes: [] }));
    for (const n of notes) {
      const text = n.text.toLowerCase();
      THEMES.forEach((t, i) => { if (t.words.some((w) => text.includes(w))) counts[i].notes.push(n); });
    }
    return counts.filter((c) => c.notes.length).map((c) => Object.assign(c, { count: c.notes.length })).sort((a, b) => b.count - a.count);
  };
  const theme = (notes, id) => PL.noteThemes(notes).find((t) => t.id === id) || null;

  // How a hotspot changed between the last two builds (null when unknown).
  function buildChange(compare, levelId, x, y, r, kind) {
    if (!compare) return null;
    const level = compare.levels.find((l) => l.id === levelId);
    if (!level) return null;
    let best = null;
    for (const spot of kind === 'stuck' ? level.stuck : level.spots) {
      const d = Math.hypot(spot.x - x, spot.y - y);
      if (d <= Math.max(r, spot.r || r) && (!best || d < best.d)) best = { spot, d };
    }
    if (!best) return null;
    const s = best.spot;
    if (kind === 'stuck') {
      if (s.a.perVisit === null || s.b.perVisit === null || s.a.perVisit < 3) return null;
      return { change: (s.b.perVisit - s.a.perVisit) / s.a.perVisit, from: secs(s.a.perVisit), to: secs(s.b.perVisit), build: compare.buildB };
    }
    if (s.a.perVisit === null || s.b.perVisit === null || s.a.count < 4) return null;
    return { change: (s.b.perVisit - s.a.perVisit) / Math.max(s.a.perVisit, 0.01), from: s.a.perVisit.toFixed(2), to: s.b.perVisit.toFixed(2), build: compare.buildB };
  }

  PL.generateInsights = function (dataset, analysis, options) {
    const out = [];
    const compare = options && options.compare;
    for (const L of analysis.levels) {
      deathInsights(L, analysis, out, compare);
      stuckInsights(L, analysis, out, compare);
      quitInsights(L, analysis, out);
      perfInsights(L, out, compare);
      pacingInsight(L, out);
      positiveLevel(L, out);
    }
    progressionInsights(analysis, dataset, out);
    choiceInsights(analysis, out);
    crashInsights(analysis, out);
    earlyQuitInsight(analysis, out);
    if (options && options.compare) compareInsights(options.compare, out);
    notesInsight(analysis, out);
    // A level with open problems is not "playing smoothly", whatever its clear rate.
    const troubled = new Set(out.filter((i) => i.level && i.category !== 'Change' && (i.severity === 'critical' || i.severity === 'warning')).map((i) => i.level));
    const kept = out.filter((i) => !(i.type === 'level_good' && troubled.has(i.level)));
    for (const insight of kept) insight.score = SEVERITY_RANK[insight.severity] * 1000 + (insight.weight || 0);
    return kept.sort((a, b) => b.score - a.score);
  };

  function add(out, insight) {
    insight.id = [insight.type, insight.level || '', insight.loc ? Math.round(insight.loc.x) + ':' + Math.round(insight.loc.y) : out.length].join('|');
    insight.evidence = (insight.evidence || []).filter(Boolean);
    insight.suggestions = Array.from(new Set(insight.suggestions || [])).slice(0, 3);
    out.push(insight);
  }

  // Identical notes from several testers are shown once, with every name.
  function groupNotes(notes) {
    const groups = new Map();
    for (const n of notes) {
      const key = n.text.trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, { text: n.text.trim(), who: new Set(), levels: new Set() });
      groups.get(key).who.add(n.session.label);
      if (n.level) groups.get(key).levels.add(PL.prettyName(n.level));
    }
    return Array.from(groups.values()).sort((a, b) => b.who.size - a.who.size);
  }

  function names(set) {
    const list = Array.from(set);
    return list.slice(0, 3).join(', ') + (list.length > 3 ? ' and ' + (list.length - 3) + ' more' : '');
  }

  function noteEvidence(notes, limit) {
    return groupNotes(notes).slice(0, limit || 2).map((g) => 'Tester note from ' + names(g.who) + ': ' + quote(g.text));
  }

  // --- Deaths ------------------------------------------------------------------

  function deathInsights(L, analysis, out, compare) {
    if (L.deathCount < 3) return;
    const runDeaths = analysis.runs.list.filter((r) => r.outcome === 'death').length;
    let shown = 0;
    for (const c of L.deathClusters) {
      if (shown >= 3) break;
      if (c.count < 3 || c.sessions < 2) continue;
      const share = c.count / L.deathCount;
      if (share < 0.2 && c.count < 6) continue;
      shown++;
      const [cause, causeCount] = c.causes[0];
      const causeName = PL.prettyName(cause);
      const zone = A.zoneAt(L, c.x, c.y);
      const where = zone || causeName.toLowerCase() + ' spot';
      const testerShare = L.visitors ? c.sessions / L.visitors : 0;
      const endShare = runDeaths ? c.runEnders / runDeaths : 0;
      const spotRate = L.visits ? c.count / L.visits : 0;
      let severity = 'info';
      if ((testerShare >= 0.5 && c.perAffected >= 1.5 && spotRate >= 0.25) || endShare >= 0.35 || spotRate >= 0.6) severity = 'critical';
      else if (spotRate >= 0.1 || testerShare >= 0.25 || c.count >= 8) severity = 'warning';
      const change = buildChange(compare, L.id, c.x, c.y, c.r, 'deaths');
      const fixed = change && change.change <= -0.6;
      if (fixed) severity = severity === 'critical' ? 'warning' : 'info';

      const reasons = [];
      const lagNotes = theme(c.notes, 'performance');
      if (lagNotes && lagNotes.count >= 2) {
        reasons.push({ w: 4.3, text: 'testers say it lags here (' + plural(lagNotes.count, 'note') + '), so frame drops may be what makes it hard to dodge', tips: ['Profile this spot with the Godot profiler', 'Check the frame rate on lower-end machines'] });
      }
      const seeNotes = theme(c.notes, 'visibility');
      if (seeNotes && seeNotes.count >= 2) {
        reasons.push({ w: 3.9, text: 'testers say they cannot see the danger (' + plural(seeNotes.count, 'note') + ')', tips: ['Make the hazard readable: contrast, a glow or a sound cue'] });
      }
      if (c.upgradeEffect) {
        const u = c.upgradeEffect;
        const name = PL.prettyName(u.id);
        const often = u.ratio >= 10 ? 'far more often' : u.ratio.toFixed(1) + '× as often';
        reasons.push({ w: 5, text: 'players without ' + name + ' die here ' + often + ' (' + u.rateWithout.toFixed(2) + ' vs ' + u.rateWith.toFixed(2) + ' deaths per visit)', tips: ['Make this spot fair without ' + name + ', or tell players that ' + name + ' helps here', 'Check whether ' + name + ' is close to mandatory for this stage'] });
      }
      if (c.fpsMedian !== null && c.fpsMedian < 30 && (L.perf.median || 60) >= 40) {
        reasons.push({ w: 4.5, text: 'the frame rate drops here (median ' + Math.round(c.fpsMedian) + ' FPS), which makes it hard to react', tips: ['Profile this spot: particles, physics and shaders are the usual suspects'] });
      }
      if (c.precededBy.length && c.precededBy[0][1] / c.count >= 0.6) {
        const [name, k] = c.precededBy[0];
        reasons.push({ w: 4, text: pct(k / c.count) + ' of these deaths come within 3 s of ' + quote(name) + ', so that move seems hard to time or land here', tips: ['Tune the ' + quote(name) + ' timing, distance or landing around this spot', 'Show clearly when it is safe to go'] });
      }
      if (c.perAffected >= 2.2 && (c.passRate === null || c.passRate < 0.6)) {
        reasons.push({ w: 3.6, text: 'it takes many tries to get past: testers who died here did so ' + c.perAffected.toFixed(1) + ' times on average, and only ' + pct(c.passRate || 0) + ' of them ever got past it', tips: ['Add a checkpoint right before this spot', 'Ease the challenge on early attempts, or teach the pattern somewhere safer first'] });
      }
      if (c.fastShare !== null && c.fastShare >= 0.6) {
        reasons.push({ w: 3.4, text: pct(c.fastShare) + ' of deaths happen within 1.5 s of arriving, which leaves almost no time to react', tips: ['Telegraph the danger earlier (a sound, a flash or a longer wind-up)', 'Let players see the hazard before they are committed'] });
      }
      if (c.arrivalRatio !== null && c.arrivalRatio >= 1.4) {
        reasons.push({ w: 3, text: 'players arrive moving fast (' + c.arrivalRatio.toFixed(1) + '× their usual speed), so the hazard may not be visible in time', tips: ['Slow players down before this spot, or make the hazard visible from further away'] });
      }
      if (!reasons.length) {
        reasons.push({ w: 1, text: 'it accounts for ' + pct(share) + ' of all deaths in ' + L.name, tips: ['Watch a replay of a session that died here to see what players are attempting'] });
      }
      reasons.sort((a, b) => b.w - a.w);

      const title = severity === 'critical'
        ? (zone ? zone : causeName) + ' is a wall in ' + L.name
        : 'Death hotspot: ' + (zone || causeName) + ' (' + L.name + ')' + (fixed ? ', much better in ' + change.build : '');
      const lead = share >= 0.4 ? ' far more than anywhere else in ' + L.name : ' in ' + L.name;
      let text = 'Players die at the ' + where + lead + ', seemingly because ' + reasons[0].text + '.';
      if (reasons[1] && reasons[1].w >= 3) text += ' Also, ' + reasons[1].text + '.';
      if (fixed) text += ' Build ' + change.build + ' looks like it fixed most of this: deaths here fell ' + pct(-change.change) + ' (' + change.from + ' → ' + change.to + ' per visit).';
      add(out, {
        type: 'death_hotspot', category: 'Difficulty', severity, level: L.id,
        title, text,
        evidence: [
          plural(c.count, 'death') + ' here (' + pct(share) + ' of ' + L.name + ' deaths) from ' + c.sessions + ' of ' + L.visitors + ' testers',
          'Cause: ' + causeName + (causeCount < c.count ? ' (' + pct(causeCount / c.count) + ')' : ''),
          c.runEnders ? 'Ended ' + plural(c.runEnders, 'run') + (runDeaths ? ' (' + pct(endShare) + ' of all runs lost to deaths)' : '') : '',
          c.passRate !== null ? pct(c.passRate) + ' of testers who died here later cleared ' + L.name : '',
          c.rageQuits.length ? plural(c.rageQuits.length, 'tester') + ' quit within 45 s of dying here' : '',
          c.medianInArea === null ? '' : c.medianInArea < 0.6 ? 'Most deaths happen within half a second of arriving' : 'Median time spent nearby before dying: ' + secs(c.medianInArea),
        ].concat(noteEvidence(c.notes)),
        suggestions: reasons[0].tips.concat(reasons[1] ? reasons[1].tips : []),
        loc: { x: c.x, y: c.y, r: c.r * 1.4 }, layer: 'deaths',
        confidence: confidenceFor(c.sessions), n: c.sessions,
        weight: Math.round(share * 100 + c.count),
      });
    }
  }

  // --- Navigation ------------------------------------------------------------------

  function stuckInsights(L, analysis, out, compare) {
    let shown = 0;
    for (const spot of L.stuckSpots) {
      if (shown >= 2) break;
      if (spot.sessions < 2 || (spot.avgPerSession || 0) < 10) continue;
      shown++;
      const affected = L.visitors ? spot.sessions / L.visitors : 0;
      let severity = 'info';
      if (spot.quits >= 2 || (affected >= 0.5 && spot.avgPerSession >= 25)) severity = 'critical';
      else if (affected >= 0.2 || spot.avgPerSession >= 20) severity = 'warning';
      const zone = A.zoneAt(L, spot.x, spot.y);
      const where = zone || 'one area';
      const reasons = [];
      if (spot.exitEvents.length && spot.exits >= 2 && spot.exitEvents[0][1] / spot.exits >= 0.5) {
        const [name, k] = spot.exitEvents[0];
        reasons.push({ w: 4.5, text: 'players only get out after ' + quote(name) + ' (' + k + ' of ' + spot.exits + ' times), so finding it is the real obstacle', tips: ['Make whatever leads to ' + quote(name) + ' easier to notice', 'Add a hint after about 20 s of wandering here'] });
      }
      if (spot.exitDirection) {
        reasons.push({ w: 4, text: 'the way forward isn’t obvious: almost everyone who gets out leaves heading ' + direction(spot.exitDirection), tips: ['Draw the eye ' + direction(spot.exitDirection) + ' with light, a landmark or movement', 'Check that the way ' + direction(spot.exitDirection) + ' is not hidden or blocked by collision'] });
      }
      if (spot.quits) {
        reasons.push({ w: 3, text: plural(spot.quits, 'tester') + ' gave up while stuck here', tips: ['Consider a hint or a way back after a long time without progress'] });
      }
      const lostNotes = theme(spot.notes, 'lost');
      if (lostNotes && lostNotes.count >= 2 && reasons.length < 2) {
        reasons.push({ w: 3.2, text: 'testers say they are lost here (' + plural(lostNotes.count, 'note') + ')', tips: ['Add a clear visual cue toward the way out'] });
      }
      if (!reasons.length) {
        reasons.push({ w: 1, text: 'they circle the area without making progress', tips: ['Add a clear visual cue toward the way out', 'Check for invisible walls or confusing dead ends'] });
      }
      reasons.sort((a, b) => b.w - a.w);
      const change = buildChange(compare, L.id, spot.x, spot.y, spot.r, 'stuck');
      let after = '';
      if (change && change.change <= -0.4) {
        after = ' Build ' + change.build + ' cut the time lost here by ' + pct(-change.change) + ' (' + change.from + ' → ' + change.to + ' per visit).';
        if (change.change <= -0.6) severity = severity === 'critical' ? 'warning' : 'info';
      } else if (change && change.change >= 0.4) {
        after = ' It got worse in build ' + change.build + ' (' + change.from + ' → ' + change.to + ' per visit).';
      }
      add(out, {
        type: 'stuck_spot', category: 'Navigation', severity, level: L.id,
        title: 'Players get lost in ' + (zone || 'part of ' + L.name) + (zone ? ' (' + L.name + ')' : ''),
        text: spot.sessions + ' of ' + L.visitors + ' testers wandered around ' + (zone ? 'the ' + where : where) + ' for ' + secs(spot.avgPerSession) + ' on average, seemingly because ' + reasons[0].text + '.' + (reasons[1] && reasons[1].w >= 3 ? ' Also, ' + reasons[1].text + '.' : '') + after,
        evidence: [
          plural(spot.intervals.length, 'stuck episode') + ', ' + secs(spot.totalTime) + ' in total',
          'Longest episode: ' + secs(spot.longest),
          spot.quits ? plural(spot.quits, 'session') + ' ended while stuck here' : '',
          spot.deaths ? plural(spot.deaths, 'episode') + ' ended in a death' : '',
        ].concat(noteEvidence(spot.notes)),
        suggestions: reasons[0].tips.concat(reasons[1] ? reasons[1].tips : []),
        loc: { x: spot.x, y: spot.y, r: spot.r }, layer: 'stuck',
        confidence: confidenceFor(spot.sessions), n: spot.sessions,
        weight: Math.round(affected * 100 + spot.avgPerSession),
      });
    }
    const linger = L.lingerSpots[0];
    if (linger && linger.sessions >= 3 && linger.avgPerSession >= 12) {
      const zone = A.zoneAt(L, linger.x, linger.y);
      add(out, {
        type: 'hesitation', category: 'Navigation', severity: 'info', level: L.id,
        title: 'Players hesitate at ' + (zone || 'one spot') + ' (' + L.name + ')',
        text: linger.sessions + ' testers stood still here for ' + secs(linger.avgPerSession) + ' on average while still pressing buttons. They may be waiting for a timing window or unsure what to do next.',
        evidence: [plural(linger.intervals.length, 'pause') + ', longest ' + secs(linger.longest)].concat(noteEvidence(linger.notes)),
        suggestions: ['If this is a timing challenge, make the rhythm easy to read', 'If it is not, add a cue for what to do next'],
        loc: { x: linger.x, y: linger.y, r: linger.r }, layer: 'stuck',
        confidence: confidenceFor(linger.sessions), n: linger.sessions, weight: linger.sessions,
      });
    }
  }

  // --- Retention ------------------------------------------------------------------

  function quitInsights(L, analysis, out) {
    const total = analysis.summary.sessions;
    for (const c of L.quitClusters.slice(0, 2)) {
      if (c.sessions < 2) continue;
      const share = total ? c.count / total : 0;
      const severity = share >= 0.3 && c.count >= 3 ? 'critical' : 'warning';
      const zone = A.zoneAt(L, c.x, c.y);
      const where = zone ? 'the ' + zone : 'the same spot';
      let because;
      const tips = [];
      if (c.afterDeath / c.count >= 0.6 && c.deathCauses.length) {
        const [cause, k] = c.deathCauses[0];
        because = 'they gave up right after dying: ' + k + ' of ' + c.count + ' had just been killed by ' + PL.prettyName(cause).toLowerCase();
        tips.push('Soften the cost of dying to ' + PL.prettyName(cause).toLowerCase() + ' (respawn closer, keep progress)');
      } else {
        const stuckNear = L.stuckSpots.find((s) => Math.hypot(s.x - c.x, s.y - c.y) <= s.r * 1.5);
        if (stuckNear) {
          because = 'they had been wandering around here without finding the way forward';
          tips.push('See the stuck-spot insight for this area');
        } else {
          because = 'this is simply where their sessions ended. Check whether it is a natural stopping point';
        }
      }
      tips.push('Ask these testers what made them stop here');
      add(out, {
        type: 'quit_hotspot', category: 'Retention', severity, level: L.id,
        title: 'Testers quit at ' + (zone || 'one spot in ' + L.name) + (zone ? ' (' + L.name + ')' : ''),
        text: c.count + ' of ' + total + ' sessions ended at ' + where + ' in ' + L.name + ', seemingly because ' + because + '.',
        evidence: [
          'Quit after ' + secs(c.medianSessionTime) + ' of play (median)',
          c.afterDeath ? c.afterDeath + ' of ' + c.count + ' quit within 45 s of a death' : '',
        ].concat(noteEvidence(c.notes)),
        suggestions: tips,
        loc: { x: c.x, y: c.y, r: c.r * 1.2 }, layer: 'quits',
        confidence: confidenceFor(c.sessions), n: c.sessions, weight: Math.round(share * 100),
      });
    }
  }

  function earlyQuitInsight(analysis, out) {
    const total = analysis.summary.sessions;
    const early = analysis.sessions.filter((s) => s.clean && s.activeTime < 120);
    if (total < 4 || early.length / total < 0.25) return;
    add(out, {
      type: 'early_quits', category: 'Retention', severity: 'warning',
      title: plural(early.length, 'session') + ' ended within 2 minutes',
      text: pct(early.length / total) + ' of sessions lasted under 2 minutes, seemingly because the first minutes do not hook players or something blocks them early.',
      evidence: early.slice(0, 4).map((s) => s.label + ': ' + secs(s.activeTime) + (s.end.level ? ', quit in ' + PL.prettyName(s.end.level) : '')),
      suggestions: ['Watch the first two minutes of these sessions', 'Get players to the fun part faster'],
      confidence: confidenceFor(early.length), n: early.length, weight: early.length,
    });
  }

  // --- Performance and stability ------------------------------------------------------

  // Frame drops matter where they happen, even when the level average is fine.
  function perfInsights(L, out, compare) {
    const P = L.perf;
    if (P.count < 10) return;
    const worst = P.zones.find((z) => z.n >= 4) || null;
    const zoneBad = !!worst && worst.median < 30;
    const spot = P.spots[0];
    const spotBad = !!spot && spot.count >= 5 && spot.sessions >= 3;
    if (!(P.lowShare >= 0.08 || zoneBad || spotBad)) return;
    const zone = zoneBad ? worst.zone : spot ? A.zoneAt(L, spot.x, spot.y) : null;
    let because = 'it happened to everyone who went there, so it is probably the content in this area rather than one machine';
    if (P.byGpu.length > 1) {
      const sorted = P.byGpu.slice().sort((a, b) => b.lowShare - a.lowShare);
      if (sorted[0].lowShare >= 2 * (sorted[1].lowShare + 0.01)) because = 'it mostly happens on ' + sorted[0].gpu;
    }
    let text;
    if (zoneBad) {
      text = 'In the ' + worst.zone + ' the frame rate drops to a median of ' + Math.round(worst.median) + ' FPS (' + worst.n + ' samples from ' + plural(worst.sessions, 'tester') + '), against ' + Math.round(worst.elsewhere || P.median) + ' FPS in the rest of ' + L.name + ', and ' + because + '.';
    } else if (spotBad) {
      text = 'In the ' + (zone || 'same spot') + ' the frame rate falls to about ' + Math.round(spot.fpsMedian) + ' FPS (' + plural(spot.count, 'sample') + ' below 30 FPS from ' + plural(spot.sessions, 'tester') + '), while the rest of ' + L.name + ' runs at about ' + Math.round(P.median) + ' FPS, and ' + because + '.';
    } else {
      text = pct(P.lowShare) + ' of frame-rate samples in ' + L.name + ' are below 30 FPS' + (spot ? ' (median ' + Math.round(spot.fpsMedian) + ' FPS at the worst spot)' : '') + ', and ' + because + '.';
    }
    let severity = P.lowShare >= 0.25 || (zoneBad && worst.median < 20) ? 'critical' : 'warning';
    if (compare && spot) {
      // Did the newest build fix it? Count drops near the spot in each build.
      const lowNear = (an) => {
        const Lx = an.level[L.id];
        return Lx ? Lx.perf.samples.filter((p) => p.fps < 30 && p.x !== null && Math.hypot(p.x - spot.x, p.y - spot.y) <= spot.r * 2).length : 0;
      };
      const before = lowNear(compare.a);
      const after = lowNear(compare.b);
      const visitsAfter = compare.b.level[L.id] ? compare.b.level[L.id].visits : 0;
      if (before >= 3 && after === 0 && visitsAfter >= 5) {
        text += ' Build ' + compare.buildB + ' seems to have fixed it: there were no drops there in ' + visitsAfter + ' visits.';
        severity = 'info';
      }
    }
    const zr = zone ? (L.meta.zones || []).find((z) => z.name === zone) : null;
    const loc = zr ? { x: zr.rect[0] + zr.rect[2] / 2, y: zr.rect[1] + zr.rect[3] / 2, r: Math.max(zr.rect[2], zr.rect[3]) / 2 } : spot ? { x: spot.x, y: spot.y, r: spot.r } : null;
    const lag = theme(L.notes, 'performance');
    add(out, {
      type: 'performance', category: 'Performance', severity, level: L.id,
      title: 'Frame rate drops in ' + (zone ? zone + ' (' + L.name + ')' : L.name),
      text,
      evidence: [
        'Median ' + Math.round(P.median) + ' FPS across ' + P.count + ' samples in ' + L.name + ', worst 5% ' + Math.round(P.p05) + ' FPS',
        zoneBad ? pct(worst.lowShare) + ' of samples in the ' + worst.zone + ' are below 30 FPS' : '',
        lag ? plural(lag.count, 'tester note') + ' mention lag in ' + L.name : '',
      ].concat(lag ? noteEvidence(lag.notes, 1) : []).concat(P.byGpu.length > 1 ? P.byGpu.slice(0, 3).map((g) => g.gpu + ': median ' + Math.round(g.median) + ' FPS (' + g.n + ' samples)') : []),
      suggestions: ['Profile this area with the Godot profiler and visual profiler', 'Look for particle counts, overdraw, physics bodies and per-frame scripts here'],
      loc, layer: 'perf',
      confidence: confidenceFor(zoneBad ? worst.sessions : new Set(P.samples.map((p) => p.session.id)).size), n: zoneBad ? worst.n : P.count,
      weight: Math.round((zoneBad ? 60 - worst.median : P.lowShare * 100)),
    });
  }

  function crashInsights(analysis, out) {
    const total = analysis.summary.sessions;
    const crashed = analysis.sessions.filter((s) => !s.clean);
    if (!crashed.length) {
      if (total >= 5) {
        add(out, {
          type: 'stability', category: 'Stability', severity: 'good',
          title: 'No crashes in ' + plural(total, 'session'),
          text: 'Every session ended with a clean exit.',
          evidence: [], suggestions: [], confidence: confidenceFor(total), n: total, weight: 0,
        });
      }
      return;
    }
    const levels = A.countBy(crashed, (s) => s.end.level || '');
    const [topLevel] = levels[0];
    const L = topLevel ? analysis.level[topLevel] : null;
    const first = crashed.find((s) => s.end.level === topLevel);
    const zone = L && first && first.end.x !== null ? A.zoneAt(L, first.end.x, first.end.y) : null;
    const lastFps = crashed.map((s) => s.perf.length ? s.perf[s.perf.length - 1].fps : null).filter((f) => f !== null);
    const lowBefore = lastFps.length && A.median(lastFps) < 30;
    let text = crashed.length + ' of ' + total + ' sessions ended without a clean exit' + (L ? ', ' + (levels[0][1] === crashed.length ? 'all' : 'mostly') + ' in ' + L.name + (zone ? ' around ' + zone : '') : '') + '. That usually means a crash or a forced close';
    text += lowBefore ? ', and the frame rate was low just before (median ' + Math.round(A.median(lastFps)) + ' FPS), which points at a heavy effect in that area.' : '.';
    const zoneFps = L && zone ? L.perf.zones.find((z) => z.zone === zone) : null;
    const dropSpot = L && first && first.end.x !== null ? L.perf.spots.find((p) => Math.hypot(p.x - first.end.x, p.y - first.end.y) <= Math.max(p.r, L.r) * 2) : null;
    if (!lowBefore && ((zoneFps && zoneFps.median < 30) || (dropSpot && dropSpot.count >= 3))) {
      const fps = zoneFps && zoneFps.median < 30 ? zoneFps.median : dropSpot.fpsMedian;
      text += ' ' + (zone ? 'The ' + zone : 'That spot') + ' is also where the frame rate drops (about ' + Math.round(fps) + ' FPS), so a heavy effect there is a good first suspect.';
    }
    add(out, {
      type: 'crash', category: 'Stability', severity: crashed.length >= 2 || crashed.length / total >= 0.1 ? 'critical' : 'warning', level: topLevel || undefined,
      title: plural(crashed.length, 'possible crash', 'possible crashes'),
      text,
      evidence: crashed.slice(0, 5).map((s) => s.label + ' · build ' + s.build + ' · ' + secs(s.duration) + ' in' + (s.end.level ? ' · ' + PL.prettyName(s.end.level) : '')),
      suggestions: ['Check these testers’ logs (user://logs/godot.log) for errors', 'Try to reproduce in ' + (L ? L.name : 'the same place') + ' with the same build'],
      loc: first && first.end.x !== null && L ? { x: first.end.x, y: first.end.y, r: L.r * 1.5 } : null, layer: 'quits',
      confidence: confidenceFor(crashed.length), n: crashed.length, weight: crashed.length * 10,
    });
  }

  // --- Levels and progression ------------------------------------------------------------

  function positiveLevel(L, out) {
    if (L.visits < 4 || L.completion === null || L.completion < 0.85 || (L.deathsPerVisit || 0) > 0.3) return;
    add(out, {
      type: 'level_good', category: 'Difficulty', severity: 'good', level: L.id,
      title: L.name + ' plays smoothly',
      text: pct(L.completion) + ' of visits end with a clear, with ' + (L.deathsPerVisit || 0).toFixed(2) + ' deaths per visit and a median clear time of ' + secs(L.durationMedian) + '.',
      evidence: [L.visits + ' visits by ' + L.visitors + ' testers'],
      suggestions: [], confidence: confidenceFor(L.visitors), n: L.visitors, weight: L.visits,
    });
  }

  function pacingInsight(L, out) {
    if (L.durations.length < 5 || !(L.durationP25 > 0) || L.durationP75 / L.durationP25 < 2.5) return;
    const spot = L.stuckSpots[0];
    const zone = spot ? A.zoneAt(L, spot.x, spot.y) : null;
    add(out, {
      type: 'pacing', category: 'Pacing', severity: 'info', level: L.id,
      title: L.name + ' pacing varies a lot',
      text: 'The middle half of clears take between ' + secs(L.durationP25) + ' and ' + secs(L.durationP75) + '. Some players breeze through while others spend much longer' + (spot ? ', mostly around ' + (zone || 'one area') : '') + '.',
      evidence: ['Median clear time ' + secs(L.durationMedian) + ' over ' + plural(L.durations.length, 'clear')],
      suggestions: ['Find out what the slow players are doing differently (see Heatmaps and session replays)'],
      loc: spot ? { x: spot.x, y: spot.y, r: spot.r } : null, layer: 'moves',
      confidence: confidenceFor(L.durations.length), n: L.durations.length, weight: 1,
    });
  }

  function progressionInsights(analysis, dataset, out) {
    const R = analysis.runs;
    if (R.count >= 5 && R.stages.length >= 2) {
      for (const st of R.stages) {
        if (st.reached < 4) continue;
        const others = R.stages.filter((o) => o !== st && o.reached >= 3);
        if (!others.length) continue;
        const otherRate = A.mean(others.map((o) => o.dropRate));
        if (st.dropRate < 0.35 || st.dropRate < 1.6 * otherRate) continue;
        const L = analysis.levels.find((l) => l.name.toLowerCase() === st.label.toLowerCase() || l.id === st.label);
        const c = L && L.deathClusters[0];
        const place = c ? A.zoneAt(L, c.x, c.y) || PL.prettyName(c.causes[0][0]).toLowerCase() : null;
        add(out, {
          type: 'difficulty_spike', category: 'Progression', severity: st.dropRate >= 0.5 ? 'critical' : 'warning', level: L ? L.id : undefined,
          title: 'Difficulty spike at ' + st.label,
          text: pct(st.dropRate) + ' of runs that reach ' + st.label + ' end there, ' + (otherRate >= 0.05 ? (st.dropRate / otherRate).toFixed(1) + '× the rate of other stages' : 'while runs almost never end at the other stages') + (place ? '. The biggest killer there is the ' + place : '') + '.',
          evidence: [st.reached + ' runs reached ' + st.label + ', ' + st.ended + ' ended there, ' + st.won + ' won from there'].concat(others.map((o) => o.label + ': ' + pct(o.dropRate) + ' of runs end there')),
          suggestions: ['Smooth the jump in difficulty, or give players a chance to prepare before ' + st.label, 'Check whether an upgrade is effectively required to survive ' + st.label],
          loc: c ? { x: c.x, y: c.y, r: c.r * 1.4 } : null, layer: 'deaths',
          confidence: confidenceFor(st.reached), n: st.reached, weight: Math.round(st.dropRate * 100),
        });
      }
    }
    if (R.count >= 8 && R.winRate === 0) {
      add(out, {
        type: 'no_wins', category: 'Progression', severity: 'warning',
        title: 'No tester has won a run yet',
        text: 'None of ' + R.count + ' runs ended in a win. Unless the game is meant to be this hard, players may be missing something they need.',
        evidence: R.outcomes.map(([o, n]) => PL.prettyName(o) + ': ' + n), suggestions: ['Make sure the goal is clear', 'Lower the difficulty of the final stage for testing'],
        confidence: confidenceFor(R.count), n: R.count, weight: R.count,
      });
    }
  }

  function choiceInsights(analysis, out) {
    for (const kind of analysis.choices) {
      for (const o of kind.options) {
        if (o.offered >= 8 && o.pickRate <= 0.12) {
          add(out, {
            type: 'choice_rare', category: 'Balance', severity: 'info',
            title: o.name + ' is rarely picked',
            text: 'Players picked ' + o.name + ' only ' + o.picked + ' of ' + o.offered + ' times it was offered (' + pct(o.pickRate) + '), seemingly because it looks weaker than the other options or its effect is unclear.',
            evidence: kind.options.filter((x) => x !== o).map((x) => x.name + ': picked ' + pct(x.pickRate) + ' of the time'),
            suggestions: ['Make its effect clearer in the description', 'Buff it, or replace it with something more exciting'],
            confidence: confidenceFor(o.offered), n: o.offered, weight: o.offered,
          });
        }
        const w = o.with;
        const wo = o.without;
        if (w.n >= 4 && wo.n >= 4 && w.winRate !== null && wo.winRate !== null) {
          const diff = w.winRate - wo.winRate;
          const lift = wo.progress ? (w.progress - wo.progress) / wo.progress : 0;
          if (diff >= 0.25 || lift >= 0.25) {
            add(out, {
              type: 'choice_strong', category: 'Balance', severity: 'warning',
              title: o.name + ' may be overpowered',
              text: 'Runs that picked ' + o.name + ' won ' + pct(w.winRate) + ' of the time versus ' + pct(wo.winRate) + ' when it was offered but skipped, so it seems to decide whether a run succeeds.',
              evidence: ['Won ' + w.wins + ' of ' + w.n + ' runs that picked it, ' + wo.wins + ' of ' + wo.n + ' that skipped it'],
              suggestions: ['Check whether a later stage is balanced around ' + o.name, 'Bring the other options up, or tone ' + o.name + ' down'],
              confidence: confidenceFor(Math.min(w.n, wo.n)), n: w.n + wo.n, weight: Math.round(diff * 100),
            });
          } else if (diff <= -0.25 || lift <= -0.2) {
            // Skipping an option means picking another one. If the players who
            // skipped it for anything but the strongest option did no better,
            // the gap is that option's strength, not a weak pick.
            const strong = kind.options
              .filter((x) => x !== o && x.with.winRate !== null && x.without.winRate !== null && x.with.winRate - x.without.winRate >= 0.25)
              .sort((a, b) => (b.with.winRate - b.without.winRate) - (a.with.winRate - a.without.winRate))[0];
            let rest = null;
            if (strong) {
              let n = 0;
              let wins = 0;
              for (const [alt, row] of Object.entries(o.skippedOutcomes)) {
                if (alt !== strong.id) { n += row.n; wins += row.wins; }
              }
              if (n >= 6 && Math.abs(wins / n - w.winRate) <= 0.12) rest = { n, rate: wins / n };
            }
            const strongRow = strong ? o.skippedOutcomes[strong.id] : null;
            let because = '.';
            if (rest) {
              because = ', but the gap comes from ' + strong.name + ': players who skipped ' + o.name + ' for anything else won ' + pct(rest.rate) + ' of ' + rest.n + ' runs, close to the ' + pct(w.winRate) + ' with ' + o.name + '.';
            } else if (strongRow && strongRow.n / Math.max(1, wo.n) >= 0.35) {
              because = ', partly because many players who skipped it took ' + strong.name + ' instead, which wins ' + pct(strong.with.winRate) + ' of its runs.';
            }
            const alternatives = Object.entries(o.skippedOutcomes).sort((a, b) => b[1].n - a[1].n)
              .map(([alt, row]) => 'Skipped for ' + PL.prettyName(alt) + ': won ' + row.wins + ' of ' + row.n + ' (' + pct(row.wins / row.n) + ')');
            add(out, {
              type: 'choice_weak', category: 'Balance', severity: 'info',
              title: rest ? o.name + ' only looks weak next to ' + strong.name : o.name + ' may be a trap pick',
              text: 'Runs that picked ' + o.name + ' did worse (' + pct(w.winRate) + ' wins) than runs that skipped it (' + pct(wo.winRate) + ')' + because,
              evidence: ['Won ' + w.wins + ' of ' + w.n + ' runs that picked it'].concat(alternatives),
              suggestions: ['Make sure what ' + o.name + ' does is worth giving up the alternatives'],
              confidence: confidenceFor(Math.min(w.n, wo.n)), n: w.n + wo.n, weight: Math.round(-diff * 100),
            });
          }
        }
      }
    }
  }

  // --- Builds --------------------------------------------------------------------------

  function compareInsights(cmp, out) {
    const A_ = cmp.buildA;
    const B_ = cmp.buildB;
    for (const level of cmp.levels) {
      for (const spot of level.spots) {
        if (spot.a.perVisit === null || spot.b.perVisit === null || spot.a.count + spot.b.count < 6) continue;
        const change = (spot.b.perVisit - spot.a.perVisit) / Math.max(spot.a.perVisit, 0.01);
        if (Math.abs(change) < 0.4) continue;
        const better = change < 0;
        add(out, {
          type: 'change_deaths', category: 'Change', severity: better ? 'good' : 'warning', level: level.id,
          title: (better ? 'Improved in ' : 'Regression in ') + B_ + ': deaths at ' + spot.name + (better ? ' fell ' : ' rose ') + pct(Math.abs(change)),
          text: 'Deaths at ' + spot.name + ' in ' + level.name + ' went from ' + spot.a.perVisit.toFixed(2) + ' to ' + spot.b.perVisit.toFixed(2) + ' per visit between build ' + A_ + ' and ' + B_ + '.',
          evidence: [spot.a.count + ' deaths in ' + A_ + ', ' + spot.b.count + ' in ' + B_],
          suggestions: better ? [] : ['Compare what changed in ' + level.name + ' between these builds'],
          loc: { x: spot.x, y: spot.y, r: spot.r * 1.4 }, layer: 'deaths',
          confidence: confidenceFor(spot.a.count + spot.b.count), n: spot.a.count + spot.b.count, weight: Math.round(Math.abs(change) * 100),
        });
      }
      for (const spot of level.stuck) {
        if (spot.a.perVisit === null || spot.b.perVisit === null || spot.a.total + spot.b.total < 30) continue;
        const change = (spot.b.perVisit - spot.a.perVisit) / Math.max(spot.a.perVisit, 0.5);
        if (Math.abs(change) < 0.4) continue;
        const better = change < 0;
        add(out, {
          type: 'change_stuck', category: 'Change', severity: better ? 'good' : 'warning', level: level.id,
          title: (better ? 'Improved in ' : 'Regression in ') + B_ + ': time lost in ' + spot.name + (better ? ' fell ' : ' rose ') + pct(Math.abs(change)),
          text: 'Testers spent ' + secs(spot.a.perVisit) + ' stuck there per visit to ' + level.name + ' in ' + A_ + ', and ' + secs(spot.b.perVisit) + ' in ' + B_ + '.',
          evidence: [secs(spot.a.total) + ' in total in ' + A_ + ', ' + secs(spot.b.total) + ' in ' + B_], suggestions: [],
          loc: { x: spot.x, y: spot.y, r: spot.r }, layer: 'stuck',
          confidence: 'medium', n: 0, weight: Math.round(Math.abs(change) * 80),
        });
      }
      if (level.a && level.b && level.a.perf.count >= 10 && level.b.perf.count >= 10) {
        const d = level.b.perf.lowShare - level.a.perf.lowShare;
        if (Math.abs(d) >= 0.08) {
          add(out, {
            type: 'change_perf', category: 'Change', severity: d < 0 ? 'good' : 'warning', level: level.id,
            title: (d < 0 ? 'Smoother in ' : 'Slower in ') + B_ + ': ' + level.name + ' frame rate',
            text: 'Samples below 30 FPS in ' + level.name + ' went from ' + pct(level.a.perf.lowShare) + ' in ' + A_ + ' to ' + pct(level.b.perf.lowShare) + ' in ' + B_ + '.',
            evidence: ['Median ' + Math.round(level.a.perf.median) + ' → ' + Math.round(level.b.perf.median) + ' FPS'], suggestions: [],
            confidence: 'medium', n: level.a.perf.count + level.b.perf.count, weight: Math.round(Math.abs(d) * 100),
          });
        }
      }
    }
    const ra = cmp.a.runs;
    const rb = cmp.b.runs;
    if (ra.count >= 5 && rb.count >= 5 && Math.abs(rb.winRate - ra.winRate) >= 0.15) {
      const better = rb.winRate > ra.winRate;
      add(out, {
        type: 'change_wins', category: 'Change', severity: better ? 'good' : 'warning',
        title: 'Win rate ' + (better ? 'up' : 'down') + ' in ' + B_ + ': ' + pct(ra.winRate) + ' → ' + pct(rb.winRate),
        text: pct(rb.winRate) + ' of runs were won in build ' + B_ + ', compared with ' + pct(ra.winRate) + ' in ' + A_ + '.',
        evidence: [ra.count + ' runs in ' + A_ + ', ' + rb.count + ' in ' + B_], suggestions: [],
        confidence: confidenceFor(Math.min(ra.count, rb.count)), n: ra.count + rb.count, weight: 50,
      });
    }
    const ca = cmp.a.summary;
    const cb = cmp.b.summary;
    if (ca.crashes && !cb.crashes && cb.sessions >= 3) {
      add(out, {
        type: 'change_crashes', category: 'Change', severity: 'good',
        title: 'No crashes in ' + B_ + ' (' + ca.crashes + ' in ' + A_ + ')',
        text: 'All ' + cb.sessions + ' sessions on build ' + B_ + ' ended cleanly.',
        evidence: [], suggestions: [], confidence: confidenceFor(cb.sessions), n: cb.sessions, weight: 30,
      });
    }
  }

  function notesInsight(analysis, out) {
    const notes = analysis.notes;
    if (!notes.length) return;
    const themes = PL.noteThemes(notes).slice(0, 3);
    const about = themes.length ? ' Most are about ' + themes.map((t) => t.label + ' (' + t.count + ')').join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' : '';
    add(out, {
      type: 'notes', category: 'Feedback', severity: 'info',
      title: plural(notes.length, 'tester note'),
      text: 'Testers left these notes during play (F8). Each one is pinned on the heatmap where it was written.' + about,
      evidence: groupNotes(notes).slice(0, 8).map((g) => quote(g.text) + ' — ' + names(g.who) + (g.levels.size ? ' (' + Array.from(g.levels).join(', ') + ')' : '')),
      suggestions: [], confidence: confidenceFor(new Set(notes.map((n) => n.session.id)).size), n: notes.length, weight: 0,
      layer: 'notes',
    });
  }

  // --- Export ----------------------------------------------------------------------------

  PL.insightsToMarkdown = function (insights, dataset, context) {
    const lines = ['# Playtest insights: ' + dataset.game, '', context, ''];
    const label = { critical: 'Critical', warning: 'Warning', info: 'Info', good: 'Good news' };
    for (const i of insights) {
      lines.push('## ' + label[i.severity] + ': ' + i.title, '', i.text, '');
      if (i.evidence.length) { lines.push('Evidence:'); for (const e of i.evidence) lines.push('- ' + e); lines.push(''); }
      if (i.suggestions.length) { lines.push('Try:'); for (const s of i.suggestions) lines.push('- ' + s); lines.push(''); }
      lines.push('_Confidence: ' + i.confidence + (i.n ? ' (based on ' + i.n + ')' : '') + '_', '');
    }
    return lines.join('\n');
  };
})();
