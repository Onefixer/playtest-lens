// Playtest Lens - optional "Ask Claude" analysis. Sends aggregated statistics
// (never raw position logs) to Claude with the user's own API key, and
// streams back a written playtest report. Everything else in the dashboard
// works offline; this is the only part that uses the network.
(function () {
  'use strict';
  const PL = (window.PL = window.PL || {});
  const AI = (PL.ai = {});

  // The official Anthropic TypeScript SDK, loaded only when this feature is used.
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.136.0/+esm';
  AI.MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (deepest analysis)' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
  ];
  let sdk = null;
  let current = null;

  const SYSTEM = [
    'You are a senior game designer who analyses playtests for independent developers.',
    'You receive aggregated playtest analytics recorded by Playtest Lens, a Godot plugin: per-level stats, death and stuck hotspots with their surrounding signals, run progression, upgrade choices, frame rate, crashes, tester notes, and the findings of its rule-based insights engine.',
    'Write for the developer of the game. Refer to places by their zone or level names. Separate what the data shows from what you suspect, say how confident you are, and call out where the sample is too small to be sure.',
    'Prefer concrete, cheap design changes the developer can try before the next playtest.',
  ].join(' ');

  AI.buildPayload = function (dataset, analysis, insights, filterText) {
    const round = (x, d) => (x === null || x === undefined ? null : Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0));
    const place = (L, x, y, fallback) => PL.analysis.zoneAt(L, x, y) || fallback || 'unnamed area';
    return {
      game: dataset.game,
      scope: filterText,
      summary: {
        testers: analysis.summary.testers,
        sessions: analysis.summary.sessions,
        playtimeMinutes: round(analysis.summary.playtime / 60, 1),
        medianSessionMinutes: round((analysis.summary.medianSession || 0) / 60, 1),
        runs: analysis.summary.runs,
        winRate: round(analysis.summary.winRate, 2),
        deaths: analysis.summary.deaths,
        possibleCrashes: analysis.summary.crashes,
        builds: analysis.summary.builds,
      },
      levels: analysis.levels.map((L) => ({
        level: L.name,
        visits: L.visits,
        testers: L.visitors,
        completionRate: round(L.completion, 2),
        deathsPerVisit: round(L.deathsPerVisit, 2),
        medianClearSeconds: round(L.durationMedian),
        clearSecondsMiddleHalf: [round(L.durationP25), round(L.durationP75)],
        zones: (L.meta.zones || []).map((z) => z.name),
        deathHotspots: L.deathClusters.slice(0, 3).map((c) => ({
          place: place(L, c.x, c.y, PL.prettyName(c.causes[0][0])),
          deaths: c.count,
          testersAffected: c.sessions,
          causes: c.causes.slice(0, 3).map(([cause, n]) => cause + ' x' + n),
          shareOfLevelDeaths: round(c.count / Math.max(1, L.deathCount), 2),
          deathsPerAffectedTester: round(c.perAffected, 1),
          shareOfAffectedWhoLaterCleared: round(c.passRate, 2),
          medianSecondsNearbyBeforeDeath: round(c.medianInArea, 1),
          shareDyingWithin1_5sOfArriving: round(c.fastShare, 2),
          customEventsWithin3sBefore: c.precededBy.slice(0, 2).map(([name, n]) => name + ' in ' + n + ' deaths'),
          rageQuitsWithin45s: c.rageQuits.length,
          upgradeEffect: c.upgradeEffect ? { without: c.upgradeEffect.id, deathsPerVisitWithout: round(c.upgradeEffect.rateWithout, 2), deathsPerVisitWith: round(c.upgradeEffect.rateWith, 2) } : null,
          medianFpsNearby: round(c.fpsMedian),
        })),
        stuckSpots: L.stuckSpots.slice(0, 2).map((s) => ({
          place: place(L, s.x, s.y),
          testersAffected: s.sessions,
          avgSecondsStuckPerTester: round(s.avgPerSession),
          longestSeconds: round(s.longest),
          quitWhileStuck: s.quits,
          eventsBeforeGettingOut: s.exitEvents.slice(0, 2).map(([name, n]) => name + ' x' + n),
          exitDirectionConsistency: s.exitDirection ? round(s.exitDirection.consistency, 2) : null,
        })),
        quitSpots: L.quitClusters.slice(0, 2).map((q) => ({ place: place(L, q.x, q.y), sessionsEnded: q.count, rightAfterDeath: q.afterDeath })),
        frameRate: L.perf.count ? { medianFps: round(L.perf.median), worst5pctFps: round(L.perf.p05), shareBelow30: round(L.perf.lowShare, 2) } : null,
      })),
      runs: {
        count: analysis.runs.count,
        winRate: round(analysis.runs.winRate, 2),
        medianSeconds: round(analysis.runs.medianDuration),
        outcomes: Object.fromEntries(analysis.runs.outcomes),
        stages: analysis.runs.stages.map((s) => ({ stage: s.label, reached: s.reached, endedThere: s.ended, wonFromThere: s.won })),
      },
      choices: analysis.choices.map((k) => ({
        kind: k.kind,
        options: k.options.map((o) => ({ option: o.name, offered: o.offered, picked: o.picked, winRateWhenPicked: round(o.with.winRate, 2), winRateWhenSkipped: round(o.without.winRate, 2) })),
      })),
      testerNotes: analysis.notes.slice(0, 40).map((n) => ({ level: PL.prettyName(n.level), text: n.text })),
      automaticFindings: insights.slice(0, 15).map((i) => ({ severity: i.severity, title: i.title, finding: i.text })),
    };
  };

  function prompt(payload) {
    return 'Here is the aggregated playtest data for "' + payload.game + '" (' + payload.scope + '):\n\n```json\n' +
      JSON.stringify(payload, null, 1) + '\n```\n\n' +
      'Write a playtest report in Markdown with these sections:\n' +
      '1. **Top problems**: up to five, most important first. For each: what happens and where, why it seems to happen (your best hypotheses), how confident you are, and the evidence.\n' +
      '2. **What to change**: concrete design changes, quick wins first.\n' +
      '3. **What went well**: what is working and should be kept.\n' +
      '4. **Next playtest**: specific questions to answer and things to watch for.\n' +
      'Keep it under about 700 words.';
  }

  AI.run = async function (options) {
    if (!sdk) sdk = await import(SDK_URL);
    const Anthropic = sdk.default || sdk.Anthropic;
    AI.Anthropic = Anthropic;
    const client = new Anthropic({ apiKey: options.apiKey, dangerouslyAllowBrowser: true });
    const params = {
      model: options.model,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt(options.payload) }],
    };
    // Opus and Sonnet can hand a declined request to Anthropic's recommended
    // fallback model server-side. Haiku has no server-side fallback.
    const stream = options.model === 'claude-haiku-5-5'
      ? client.messages.stream(params)
      : client.beta.messages.stream(Object.assign({}, params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }));
    current = stream;
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') options.onText(event.delta.text);
      }
      return await stream.finalMessage();
    } finally {
      current = null;
    }
  };

  AI.cancel = function () {
    if (current) current.abort();
  };

  AI.describeError = function (err) {
    const A = AI.Anthropic;
    if (A) {
      if (err instanceof A.AuthenticationError) return 'Claude did not accept that API key. Check it at console.anthropic.com and try again.';
      if (err instanceof A.PermissionDeniedError) return 'This API key does not have access to that model.';
      if (err instanceof A.RateLimitError) return 'Rate limited. Wait a minute and try again.';
      if (err instanceof A.BadRequestError) return 'The request was rejected: ' + err.message;
      if (err instanceof A.APIConnectionError) return 'Could not reach the Claude API. Check your internet connection.';
      if (err instanceof A.APIUserAbortError) return 'Stopped.';
      if (err instanceof A.APIError) return 'Claude API error' + (err.status ? ' ' + err.status : '') + ': ' + err.message;
    }
    if (String(err && err.message).includes('Failed to fetch') || String(err && err.message).includes('dynamically imported')) {
      return 'Could not load the Anthropic SDK. This feature needs an internet connection.';
    }
    return String((err && err.message) || err);
  };

  // A small, safe Markdown renderer (escapes everything first).
  AI.renderMarkdown = function (text) {
    const esc = PL.esc;
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>');
    const lines = String(text).split('\n');
    const html = [];
    let list = null;
    let para = [];
    const flush = () => {
      if (para.length) { html.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    };
    const closeList = () => { if (list) { html.push('</' + list + '>'); list = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (!line.trim()) { flush(); closeList(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flush(); closeList();
        const level = Math.min(4, m[1].length + 1);
        html.push('<h' + level + '>' + inline(m[2]) + '</h' + level + '>');
      } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
        flush(); closeList(); html.push('<hr>');
      } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        flush();
        if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; }
        html.push('<li>' + inline(m[1]) + '</li>');
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flush();
        if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; }
        html.push('<li>' + inline(m[1]) + '</li>');
      } else {
        if (list) closeList();
        para.push(line.trim());
      }
    }
    flush();
    closeList();
    return html.join('\n');
  };
})();
