// Playtest Lens - heatmaps drawn over the captured level map.
(function () {
  'use strict';
  const PL = (window.PL = window.PL || {});

  // Each layer is one entity, so it keeps one categorical hue (single-hue
  // density ramps: transparent where nothing happened, solid where most did).
  PL.LAYERS = [
    { id: 'moves', label: 'Movement', color: '--s1', hint: 'Where players spend their time' },
    { id: 'deaths', label: 'Deaths', color: '--s8', hint: 'Where players die' },
    { id: 'stuck', label: 'Stuck', color: '--s4', hint: 'Where players wander without progress' },
    { id: 'quits', label: 'Quits & crashes', color: '--s7', hint: 'Where sessions ended mid-level' },
    { id: 'perf', label: 'Low FPS', color: '--s2', hint: 'Where the frame rate fell below 30' },
    { id: 'events', label: 'Custom events', color: '--s3', hint: 'PlaytestLens.event() calls' },
    { id: 'items', label: 'Pickups', color: '--s6', hint: 'PlaytestLens.item() calls' },
    { id: 'notes', label: 'Tester notes', color: '--s5', hint: 'Notes testers left with F8' },
  ];
  const DRAW_ORDER = ['moves', 'items', 'events', 'perf', 'stuck', 'quits', 'deaths'];

  function cssColor(name) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888';
    const hex = raw.replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }

  class Heatmap {
    constructor(container) {
      this.container = container;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'heat-canvas';
      this.canvas.setAttribute('role', 'img');
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.data = null;
      this.layers = new Set(['deaths', 'notes']);
      this.options = { radius: 1, intensity: 1, zones: true, points: false };
      this.view = { scale: 1, ox: 0, oy: 0 };
      this.highlight = null;
      this.replayT = null;
      this.cache = new Map();
      this.onSelect = null;
      this._drag = null;
      this._observer = new ResizeObserver(() => this.resize());
      this._observer.observe(container);
      this._bind();
    }

    destroy() {
      this._observer.disconnect();
      this.canvas.remove();
    }

    setData(data) {
      this.data = data;
      this.cache.clear();
      this.view = { scale: 1, ox: 0, oy: 0 };
      this.highlight = null;
      this.resize();
    }

    setLayers(layers) { this.layers = new Set(layers); this.render(); }
    setOption(key, value) { this.options[key] = value; if (key === 'radius' || key === 'intensity') this.cache.clear(); this.render(); }
    refreshTheme() { this.cache.clear(); this.render(); }

    focus(loc) {
      this.highlight = loc;
      if (!loc || !this.data) { this.render(); return; }
      const e = this.data.extent;
      const rPx = (loc.r / e.w) * this.cssW;
      const scale = Math.max(1, Math.min(3.5, Math.min(this.cssW, this.cssH) / (rPx * 6)));
      const [sx, sy] = this._base(loc.x, loc.y);
      this.view.scale = scale;
      this.view.ox = this.cssW / 2 - sx * scale;
      this.view.oy = this.cssH / 2 - sy * scale;
      this._clamp();
      this.render();
    }

    resetView() { this.view = { scale: 1, ox: 0, oy: 0 }; this.render(); }

    resize() {
      if (!this.data) return;
      const e = this.data.extent;
      const width = this.container.clientWidth || 600;
      const aspect = e.h / e.w;
      let w = width;
      let h = width * aspect;
      const maxH = Math.max(300, window.innerHeight * 0.7);
      if (h > maxH) { h = maxH; w = h / aspect; }
      const dpr = window.devicePixelRatio || 1;
      this.cssW = w;
      this.cssH = h;
      this.dpr = dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this._clamp();
      this.render();
    }

    // World position to unzoomed canvas pixels, and the reverse.
    _base(x, y) {
      const e = this.data.extent;
      return [((x - e.x) / e.w) * this.cssW, ((y - e.y) / e.h) * this.cssH];
    }
    _world(px, py) {
      const e = this.data.extent;
      const bx = (px - this.view.ox) / this.view.scale;
      const by = (py - this.view.oy) / this.view.scale;
      return [e.x + (bx / this.cssW) * e.w, e.y + (by / this.cssH) * e.h];
    }
    _len(worldLength) { return (worldLength / this.data.extent.w) * this.cssW; }

    _clamp() {
      const v = this.view;
      v.scale = Math.max(1, Math.min(8, v.scale));
      v.ox = Math.min(0, Math.max(this.cssW - this.cssW * v.scale, v.ox));
      v.oy = Math.min(0, Math.max(this.cssH - this.cssH * v.scale, v.oy));
    }

    render() {
      if (!this.data || !this.cssW) return;
      const ctx = this.ctx;
      const d = this.data;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      ctx.save();
      ctx.translate(this.view.ox, this.view.oy);
      ctx.scale(this.view.scale, this.view.scale);
      const heatOn = DRAW_ORDER.some((l) => this.layers.has(l));
      if (d.map && d.map.ready) {
        ctx.drawImage(d.map.img, 0, 0, this.cssW, this.cssH);
        if (heatOn) { ctx.fillStyle = 'rgba(6, 9, 14, 0.42)'; ctx.fillRect(0, 0, this.cssW, this.cssH); }
      } else {
        this._drawBlank(ctx);
      }
      if (this.options.zones) this._drawZones(ctx);
      for (const layer of DRAW_ORDER) {
        if (!this.layers.has(layer)) continue;
        const img = this._density(layer);
        if (img) {
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, 0, 0, this.cssW, this.cssH);
        }
      }
      if (this.options.points) this._drawPoints(ctx);
      if (this.layers.has('notes')) this._drawNotes(ctx);
      this._drawHotspots(ctx);
      if (d.replay) this._drawReplay(ctx);
      ctx.restore();
    }

    _drawBlank(ctx) {
      ctx.fillStyle = '#121820';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      const step = this.cssW / 24;
      for (let x = step; x < this.cssW; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.cssH); ctx.stroke(); }
      for (let y = step; y < this.cssH; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.cssW, y); ctx.stroke(); }
      if (this.data.bounds) {
        const [x, y, w, h] = this.data.bounds;
        const [sx, sy] = this._base(x, y);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(sx, sy, this._len(w), (h / this.data.extent.h) * this.cssH);
      }
    }

    _drawZones(ctx) {
      const zones = this.data.zones || [];
      if (!zones.length) return;
      ctx.lineWidth = 1 / this.view.scale;
      ctx.font = 600 + ' ' + 11 / this.view.scale + 'px system-ui, sans-serif';
      for (const z of zones) {
        const [x, y, w, h] = z.rect;
        const [sx, sy] = this._base(x, y);
        const sw = this._len(w);
        const sh = (h / this.data.extent.h) * this.cssH;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.strokeRect(sx, sy, sw, sh);
        const label = z.name;
        const tw = ctx.measureText(label).width;
        const pad = 3 / this.view.scale;
        ctx.fillStyle = 'rgba(8,10,14,0.72)';
        ctx.fillRect(sx, sy - 15 / this.view.scale, tw + pad * 2, 14 / this.view.scale);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillText(label, sx + pad, sy - 4 / this.view.scale);
      }
    }

    _density(layer) {
      const pts = (this.data.layers[layer] || []);
      if (!pts.length) return null;
      const key = layer + '|' + this.options.radius + '|' + this.options.intensity;
      if (this.cache.has(key)) return this.cache.get(key);
      const e = this.data.extent;
      const gw = 360;
      const gh = Math.max(1, Math.round((gw * e.h) / e.w));
      const grid = new Float32Array(gw * gh);
      // Sparse layers (a few dozen deaths) need a wider kernel than movement.
      const spread = layer === 'moves' ? 0.016 : layer === 'stuck' ? 0.02 : 0.028;
      const rc = Math.max(2, Math.round(gw * spread * this.options.radius));
      const sigma = rc / 2;
      const kernel = [];
      for (let dy = -rc; dy <= rc; dy++) {
        for (let dx = -rc; dx <= rc; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= rc * rc) kernel.push(dx, dy, Math.exp(-d2 / (2 * sigma * sigma)));
        }
      }
      for (const p of pts) {
        const gx = Math.round(((p.x - e.x) / e.w) * gw);
        const gy = Math.round(((p.y - e.y) / e.h) * gh);
        if (gx < -rc || gy < -rc || gx > gw + rc || gy > gh + rc) continue;
        const w = p.w || 1;
        for (let k = 0; k < kernel.length; k += 3) {
          const x = gx + kernel[k];
          const y = gy + kernel[k + 1];
          if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
          grid[y * gw + x] += w * kernel[k + 2];
        }
      }
      const values = [];
      for (let i = 0; i < grid.length; i += 3) if (grid[i] > 0) values.push(grid[i]);
      values.sort((a, b) => a - b);
      const norm = values.length ? values[Math.floor(values.length * 0.985)] || values[values.length - 1] : 1;
      const [r, g, b] = cssColor(PL.LAYERS.find((l) => l.id === layer).color);
      const off = document.createElement('canvas');
      off.width = gw;
      off.height = gh;
      const octx = off.getContext('2d');
      const img = octx.createImageData(gw, gh);
      for (let i = 0; i < grid.length; i++) {
        const v = Math.min(1, (grid[i] / norm) * this.options.intensity);
        if (v < 0.03) continue;
        const lift = v * v * 0.35;
        img.data[i * 4] = r + (255 - r) * lift;
        img.data[i * 4 + 1] = g + (255 - g) * lift;
        img.data[i * 4 + 2] = b + (255 - b) * lift;
        img.data[i * 4 + 3] = Math.pow(v, 0.5) * 240;
      }
      octx.putImageData(img, 0, 0);
      this.cache.set(key, off);
      return off;
    }

    _drawPoints(ctx) {
      const s = 1 / this.view.scale;
      const mark = (list, color, shape) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * s;
        for (const p of list) {
          const [x, y] = this._base(p.x, p.y);
          ctx.beginPath();
          if (shape === 'x') { ctx.moveTo(x - 4 * s, y - 4 * s); ctx.lineTo(x + 4 * s, y + 4 * s); ctx.moveTo(x + 4 * s, y - 4 * s); ctx.lineTo(x - 4 * s, y + 4 * s); }
          else ctx.rect(x - 3.5 * s, y - 3.5 * s, 7 * s, 7 * s);
          ctx.stroke();
        }
      };
      if (this.layers.has('deaths')) mark(this.data.layers.deaths || [], 'rgb(' + cssColor('--s8') + ')', 'x');
      if (this.layers.has('quits')) mark(this.data.layers.quits || [], 'rgb(' + cssColor('--s7') + ')', 'square');
    }

    _drawNotes(ctx) {
      const s = 1 / this.view.scale;
      const color = 'rgb(' + cssColor('--s5') + ')';
      for (const n of this.data.layers.notes || []) {
        const [x, y] = this._base(n.x, n.y);
        ctx.beginPath();
        ctx.arc(x, y - 9 * s, 6 * s, 0, Math.PI * 2);
        ctx.moveTo(x - 4 * s, y - 6 * s);
        ctx.lineTo(x, y);
        ctx.lineTo(x + 4 * s, y - 6 * s);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5 * s;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    _drawHotspots(ctx) {
      const s = 1 / this.view.scale;
      const rings = (this.data.hotspots || []).slice();
      if (this.highlight) rings.push(Object.assign({ highlight: true }, this.highlight));
      for (const h of rings) {
        const [x, y] = this._base(h.x, h.y);
        const r = Math.max(10 * s, this._len(h.r));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.lineWidth = (h.highlight ? 5 : 4) * s;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.stroke();
        ctx.lineWidth = (h.highlight ? 2.5 : 1.75) * s;
        ctx.strokeStyle = h.highlight ? '#ffffff' : 'rgba(255,255,255,0.85)';
        ctx.stroke();
        if (h.rank) {
          const bx = x + r * 0.72;
          const by = y - r * 0.72;
          ctx.beginPath();
          ctx.arc(bx, by, 9 * s, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.fillStyle = '#0b0b0b';
          ctx.font = '700 ' + 11 * s + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(h.rank), bx, by + 0.5 * s);
          ctx.textAlign = 'start';
          ctx.textBaseline = 'alphabetic';
        }
      }
    }

    _drawReplay(ctx) {
      const rp = this.data.replay;
      const s = 1 / this.view.scale;
      const until = this.replayT === null ? Infinity : this.replayT;
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = 'rgba(' + cssColor('--s1').join(',') + ',0.95)';
      ctx.lineJoin = 'round';
      let started = false;
      let head = null;
      let prev = null;
      ctx.beginPath();
      for (const p of rp.points) {
        if (p.t > until) break;
        const [x, y] = this._base(p.x, p.y);
        if (!started || (prev && (p.t - prev.t > 3 || Math.hypot(p.x - prev.x, p.y - prev.y) > rp.jump))) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        started = true;
        prev = p;
        head = [x, y];
      }
      ctx.stroke();
      for (const d of rp.deaths) {
        if (d.t > until) continue;
        const [x, y] = this._base(d.x, d.y);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3.5 * s;
        ctx.beginPath(); ctx.moveTo(x - 5 * s, y - 5 * s); ctx.lineTo(x + 5 * s, y + 5 * s); ctx.moveTo(x + 5 * s, y - 5 * s); ctx.lineTo(x - 5 * s, y + 5 * s); ctx.stroke();
        ctx.strokeStyle = 'rgb(' + cssColor('--s8') + ')';
        ctx.lineWidth = 2 * s;
        ctx.stroke();
      }
      if (head) {
        ctx.beginPath();
        ctx.arc(head[0], head[1], 6 * s, 0, Math.PI * 2);
        ctx.fillStyle = 'rgb(' + cssColor('--s1') + ')';
        ctx.fill();
        ctx.lineWidth = 2 * s;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    // --- Interaction ---------------------------------------------------------------

    _bind() {
      const c = this.canvas;
      c.addEventListener('wheel', (e) => {
        if (!this.data) return;
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const v = this.view;
        const next = Math.max(1, Math.min(8, v.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
        v.ox = px - ((px - v.ox) * next) / v.scale;
        v.oy = py - ((py - v.oy) * next) / v.scale;
        v.scale = next;
        this._clamp();
        this.render();
      }, { passive: false });
      c.addEventListener('mousedown', (e) => { this._drag = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, moved: false }; });
      window.addEventListener('mouseup', (e) => {
        const drag = this._drag;
        this._drag = null;
        if (drag && !drag.moved && e.target === c) this._click(e);
      });
      c.addEventListener('mousemove', (e) => {
        if (this._drag) {
          const dx = e.clientX - this._drag.x;
          const dy = e.clientY - this._drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) this._drag.moved = true;
          this.view.ox = this._drag.ox + dx;
          this.view.oy = this._drag.oy + dy;
          this._clamp();
          this.render();
          PL.charts.hideTip();
          return;
        }
        this._hover(e);
      });
      c.addEventListener('mouseleave', () => PL.charts.hideTip());
      c.addEventListener('dblclick', () => this.resetView());
    }

    _hit(e) {
      if (!this.data) return null;
      const rect = this.canvas.getBoundingClientRect();
      const [wx, wy] = this._world(e.clientX - rect.left, e.clientY - rect.top);
      const tol = (12 / this.view.scale / this.cssW) * this.data.extent.w;
      if (this.layers.has('notes')) {
        for (const n of this.data.layers.notes || []) {
          if (Math.hypot(n.x - wx, n.y - (wy + tol * 0.6)) <= tol) return { kind: 'note', item: n };
        }
      }
      let best = null;
      for (const h of this.data.hotspots || []) {
        const d = Math.hypot(h.x - wx, h.y - wy);
        if (d <= Math.max(h.r, tol) && (!best || d < best.d)) best = { kind: 'hotspot', item: h, d };
      }
      if (best) return best;
      if (this.options.points && this.layers.has('deaths')) {
        for (const p of this.data.layers.deaths || []) {
          if (Math.hypot(p.x - wx, p.y - wy) <= tol * 0.7) return { kind: 'death', item: p };
        }
      }
      return null;
    }

    _hover(e) {
      const hit = this._hit(e);
      this.canvas.style.cursor = hit ? 'pointer' : this.view.scale > 1 ? 'grab' : 'default';
      if (!hit) { PL.charts.hideTip(); return; }
      let html = '';
      if (hit.kind === 'note') html = '<b>Tester note</b><br>“' + PL.esc(hit.item.text) + '”<br><span class="tip-muted">' + PL.esc(hit.item.who || '') + '</span>';
      else if (hit.kind === 'hotspot') html = hit.item.tip;
      else html = '<b>Death: ' + PL.esc(PL.prettyName(hit.item.cause || '')) + '</b><br><span class="tip-muted">' + PL.esc(hit.item.who || '') + '</span>';
      PL.charts.showTip(html, e.clientX, e.clientY);
    }

    _click(e) {
      const hit = this._hit(e);
      if (hit && hit.kind === 'hotspot' && this.onSelect) this.onSelect(hit.item);
    }
  }

  PL.Heatmap = Heatmap;
})();
