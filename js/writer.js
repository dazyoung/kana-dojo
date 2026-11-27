// Handwriting pad: stroke-order animation + stroke-by-stroke checking against KanjiVG data.
// Works with mouse, touch, Apple Pencil and Wacom pens (Pointer Events, pressure-aware).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const N = 32; // sample points per stroke
  const SIZE = 109; // KanjiVG coordinate space
  const THRESH = { strict: 9, normal: 13, relaxed: 18 };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------- geometry ----------
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function polyLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    return L;
  }
  function resample(pts, n) {
    const L = polyLen(pts);
    if (L === 0) return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));
    const step = L / (n - 1);
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let acc = 0;
    let prev = pts[0];
    for (let i = 1; i < pts.length && out.length < n; i++) {
      let cur = pts[i];
      let d = dist(prev, cur);
      while (acc + d >= step && out.length < n) {
        const t = (step - acc) / d;
        const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
        out.push(q);
        prev = q;
        d = dist(prev, cur);
        acc = 0;
      }
      acc += d;
      prev = cur;
    }
    while (out.length < n) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    return out;
  }
  const centroid = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
  const spread = (p, c) => Math.sqrt(p.reduce((s, q) => s + (q.x - c.x) ** 2 + (q.y - c.y) ** 2, 0) / p.length);
  const meanDist = (a, b) => a.reduce((s, q, i) => s + dist(q, b[i]), 0) / a.length;

  // Does a user stroke (already resampled) match a reference stroke?
  // Accept if close in place, or if the shape matches with modest offset/scale (for writing from memory).
  function fits(ref, usr, T, placeOnly) {
    const r = ref.pts;
    if (meanDist(r, usr) < T) return true;
    if (placeOnly || ref.len < 18) return false;
    const cR = centroid(r), cU = centroid(usr);
    const sR = spread(r, cR), sU = spread(usr, cU);
    const scale = sU / sR;
    if (scale < 0.6 || scale > 1.6 || dist(cR, cU) > T * 2) return false;
    const k = sR / sU;
    let sum = 0;
    for (let i = 0; i < r.length; i++) {
      sum += Math.hypot((usr[i].x - cU.x) * k + cR.x - r[i].x, (usr[i].y - cU.y) * k + cR.y - r[i].y);
    }
    return sum / r.length < T * 0.7;
  }

  // Was the stroke drawn end-to-start? Compares endpoints after aligning centroids.
  // Skipped for strokes whose start and end nearly meet (loops), where it's ambiguous.
  function reversed(r, usr) {
    const a = r[0], b = r[r.length - 1];
    if (dist(a, b) < 5) return false;
    const cR = centroid(r), cU = centroid(usr);
    const s = { x: usr[0].x - cU.x + cR.x, y: usr[0].y - cU.y + cR.y };
    const e = { x: usr[usr.length - 1].x - cU.x + cR.x, y: usr[usr.length - 1].y - cU.y + cR.y };
    return dist(s, b) + dist(e, a) < dist(s, a) + dist(e, b);
  }

  // Sample reference paths with the browser's SVG engine (cached).
  const cache = new Map();
  let measureSvg = null;
  function samplePath(d) {
    if (cache.has(d)) return cache.get(d);
    if (!measureSvg) {
      measureSvg = el('svg', { style: 'position:absolute;width:0;height:0;visibility:hidden', 'aria-hidden': 'true' });
      document.body.appendChild(measureSvg);
    }
    const p = el('path', { d }, measureSvg);
    const len = p.getTotalLength();
    const pts = [];
    for (let i = 0; i < N; i++) {
      const q = p.getPointAtLength((len * i) / (N - 1));
      pts.push({ x: q.x, y: q.y });
    }
    p.remove();
    const res = { pts, len };
    cache.set(d, res);
    return res;
  }

  class Writer {
    // opts: { onStroke(result), onComplete(summary), leniency: () => 'normal' }
    constructor(host, opts = {}) {
      this.host = host;
      this.opts = opts;
      host.classList.add('writer');
      host.innerHTML = '';
      const svg = (this.svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'w-svg' }, host));
      const grid = el('g', { class: 'w-grid' }, svg);
      el('line', { x1: 54.5, y1: 2, x2: 54.5, y2: 107 }, grid);
      el('line', { x1: 2, y1: 54.5, x2: 107, y2: 54.5 }, grid);
      this.gGuide = el('g', { class: 'w-guide' }, svg);
      this.gDots = el('g', { class: 'w-dots' }, svg);
      this.gDone = el('g', { class: 'w-done' }, svg);
      this.gAnim = el('g', { class: 'w-anim' }, svg);
      this.gHint = el('g', { class: 'w-hint' }, svg);
      this.gNums = el('g', { class: 'w-nums' }, svg);
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'w-ink';
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.penSeen = false;
      this.active = null;
      this.animToken = 0;

      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this.onDown(e));
      c.addEventListener('pointermove', (e) => this.onMove(e));
      c.addEventListener('pointerup', (e) => this.onUp(e));
      c.addEventListener('pointercancel', (e) => this.onUp(e, true));
      // A stroke that runs off the pad must still end. Normally pointer capture keeps the events
      // coming to the canvas, but if capture fails or is lost the release happens elsewhere, and
      // without these the pad would wait for it forever and ignore every new stroke.
      c.addEventListener('lostpointercapture', (e) => this.onUp(e));
      this.onWinUp = (e) => this.onUp(e);
      this.onWinCancel = (e) => this.onUp(e, true);
      window.addEventListener('pointerup', this.onWinUp);
      window.addEventListener('pointercancel', this.onWinCancel);
      c.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false }); // stop iOS scroll/zoom
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
      this.resize();
    }

    destroy() {
      this.ro.disconnect();
      this.animToken++;
      window.removeEventListener('pointerup', this.onWinUp);
      window.removeEventListener('pointercancel', this.onWinCancel);
    }

    get n() { return this.strokes ? this.strokes.length : 0; }

    // guide: true (full), 'faint', 'dots' (only where each stroke starts) or false.
    load(ch, { mode = 'trace', guide = mode === 'trace', numbers = false } = {}) {
      this.animToken++;
      this.ch = ch;
      this.strokes = (window.STROKES || {})[ch] || null;
      this.mode = this.strokes ? mode : (mode === 'view' ? 'view' : 'free');
      this.idx = 0;
      this.misses = 0;
      this.hints = 0;
      this.strokeMisses = 0;
      this.hintShown = false;
      this.userStrokes = [];
      this.done = false;
      [this.gGuide, this.gDots, this.gDone, this.gAnim, this.gHint, this.gNums].forEach((g) => g.replaceChildren());
      this.clearInk();
      this.host.classList.toggle('is-view', this.mode === 'view');
      this.host.classList.remove('guide-faint');
      if (!this.strokes) return;
      this.strokes.forEach((d) => el('path', { d }, this.gGuide));
      this.setGuide(guide);
      if (numbers) this.showNumbers();
    }

    setGuide(on) {
      this.guideOn = on;
      this.gGuide.style.display = on && on !== 'dots' ? '' : 'none';
      this.host.classList.toggle('guide-faint', on === 'faint');
      this.gDots.replaceChildren();
      if (on === 'dots' && this.strokes) {
        this.strokes.forEach((d) => { const p = samplePath(d).pts[0]; el('circle', { cx: p.x, cy: p.y, r: 2.6 }, this.gDots); });
      }
    }

    showNumbers() {
      this.gNums.replaceChildren();
      this.strokes.forEach((d, i) => {
        const p = samplePath(d).pts[0];
        el('circle', { cx: p.x, cy: p.y, r: 4.3 }, this.gNums);
        el('text', { x: p.x, y: p.y + 2.1 }, this.gNums).textContent = i + 1;
      });
    }

    // Draw one stroke into a group, optionally animated. Resolves when done (or cancelled).
    async drawStroke(group, i, cls, ms) {
      const d = this.strokes[i];
      const path = el('path', { d, class: cls || '' }, group);
      if (!ms) return path;
      const len = samplePath(d).len + 2;
      path.style.strokeDasharray = `${len} ${len}`;
      const anim = path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: ms, easing: 'cubic-bezier(.4,0,.4,1)', fill: 'forwards' });
      try { await anim.finished; } catch (e) { /* cancelled */ }
      return path;
    }

    // Stroke-order animation of the whole character.
    async animate(speed = 1) {
      if (!this.strokes) return;
      const token = ++this.animToken;
      this.gAnim.replaceChildren();
      for (let i = 0; i < this.n; i++) {
        const ms = Math.max(280, Math.min(900, samplePath(this.strokes[i]).len * 9)) / speed;
        await this.drawStroke(this.gAnim, i, '', ms);
        if (token !== this.animToken) return;
        await new Promise((r) => setTimeout(r, 120 / speed));
        if (token !== this.animToken) return;
      }
    }
    clearAnim() { this.animToken++; this.gAnim.replaceChildren(); }

    // Show the next expected stroke.
    hint(auto) {
      if (!this.strokes || this.done) return;
      if (!this.hintShown) this.hints++;
      this.hintShown = true;
      this.gHint.replaceChildren();
      const p = samplePath(this.strokes[this.idx]).pts[0];
      this.drawStroke(this.gHint, this.idx, '', 600);
      el('circle', { cx: p.x, cy: p.y, r: 3.2, class: 'start' }, this.gHint);
      if (this.opts.onHint) this.opts.onHint({ auto: !!auto, idx: this.idx });
    }

    // Reveal the rest of the character (used for "show answer").
    async reveal() {
      if (!this.strokes) { this.setGuide(true); return; }
      this.done = true;
      this.gHint.replaceChildren();
      const token = ++this.animToken;
      for (let i = this.idx; i < this.n; i++) {
        await this.drawStroke(this.gDone, i, 'revealed', 380);
        if (token !== this.animToken) return;
      }
    }

    // ---------- input ----------
    resize() {
      const w = this.host.clientWidth;
      if (!w) return;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(w * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.scale = w / SIZE;
      this.redrawInk();
    }
    clearInk() {
      clearTimeout(this.badTimer);
      this.badTimer = null;
      const w = this.host.clientWidth;
      this.ctx.clearRect(0, 0, w, w);
    }
    redrawInk() {
      this.clearInk();
      (this.userStrokes || []).forEach((s) => this.drawPts(s));
    }
    inkColor(bad) {
      const cs = getComputedStyle(this.host);
      return (bad ? cs.getPropertyValue('--bad') : cs.getPropertyValue('--ink')).trim() || '#222';
    }
    drawSeg(a, b, color) {
      const s = this.scale;
      const ctx = this.ctx;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4.4 * (0.55 + b.p * 0.9) * s;
      ctx.beginPath();
      ctx.moveTo(a.x * s, a.y * s);
      ctx.lineTo(b.x * s, b.y * s);
      ctx.stroke();
    }
    drawPts(pts, bad) {
      const color = this.inkColor(bad);
      for (let i = 1; i < pts.length; i++) this.drawSeg(pts[i - 1], pts[i], color);
    }
    pointFrom(e) {
      const r = this.canvas.getBoundingClientRect();
      const p = e.pointerType === 'mouse' || !e.pressure ? 0.5 : e.pressure;
      return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE, p };
    }
    onDown(e) {
      // A finished pad can hand the pen to whatever comes next (a drill's next round) instead of ignoring it.
      if (this.done && this.opts.onDownWhenDone) this.opts.onDownWhenDone();
      if (this.mode === 'view' || this.done || this.disabled) return;
      if (e.pointerType === 'pen') this.penSeen = true;
      else if (e.pointerType === 'touch' && this.penSeen) return; // palm rejection once a pen is in use
      if (this.active !== null) {
        // A second finger while one is drawing is ignored. Otherwise the previous stroke ended
        // without us seeing its release (a pen or mouse has only one pointer), so finish it now.
        if (e.pointerType === 'touch' && Date.now() - this.lastEvent < 500) return;
        this.onUp({ pointerId: this.active });
      }
      e.preventDefault();
      if (this.badTimer) this.redrawInk();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      this.active = e.pointerId;
      this.lastEvent = Date.now();
      this.color = this.inkColor(false);
      this.pts = [this.pointFrom(e)];
    }
    onMove(e) {
      if (e.pointerId !== this.active) return;
      // Pen or mouse moving with nothing pressed: it was lifted and we missed the release. A pen must
      // also show no pressure, so a light stroke isn't cut short if its button state flickers.
      if (e.pointerType !== 'touch' && e.buttons === 0 && !(e.pointerType === 'pen' && e.pressure > 0)) return this.onUp(e);
      e.preventDefault();
      this.lastEvent = Date.now();
      const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      for (const ev of evs.length ? evs : [e]) {
        const q = this.pointFrom(ev);
        const prev = this.pts[this.pts.length - 1];
        if (dist(prev, q) < 0.15) continue;
        this.pts.push(q);
        this.drawSeg(prev, q, this.color);
      }
    }
    onUp(e, cancelled) {
      if (this.active === null || e.pointerId !== this.active) return;
      this.active = null;
      try { if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      const pts = this.pts;
      this.pts = null;
      if (cancelled || !pts || pts.length < 2 || polyLen(pts) < 1.5) { this.redrawInk(); return; }
      this.finishStroke(pts);
    }

    // Feed a stroke programmatically (used by tests). pts in 0..109 units.
    feed(pts) { this.finishStroke(pts.map((p) => ({ p: 0.5, ...p }))); }

    finishStroke(pts) {
      if (this.done || this.mode === 'view') return;
      if (this.mode === 'free') {
        this.userStrokes.push(pts);
        this.redrawInk();
        if (this.opts.onStroke) this.opts.onStroke({ ok: true, free: true, count: this.userStrokes.length });
        return;
      }
      const res = this.match(pts);
      if (res.ok) {
        this.redrawInk();
        this.gHint.replaceChildren();
        this.drawStroke(this.gDone, this.idx, 'pop');
        this.idx++;
        this.strokeMisses = 0;
        this.hintShown = false;
        if (this.opts.onStroke) this.opts.onStroke({ ok: true, idx: this.idx, n: this.n });
        if (this.idx >= this.n) {
          this.done = true;
          if (this.opts.onComplete) this.opts.onComplete({ misses: this.misses, hints: this.hints, n: this.n });
        }
      } else {
        this.misses++;
        this.strokeMisses++;
        this.redrawInk();
        this.drawPts(pts, true);
        this.badTimer = setTimeout(() => this.redrawInk(), 650);
        if (this.opts.onStroke) this.opts.onStroke({ ok: false, kind: res.kind, other: res.other, idx: this.idx, n: this.n });
        if (this.strokeMisses >= 2 && !this.hintShown) this.hint(true);
      }
    }

    match(pts) {
      const T = THRESH[(this.opts.leniency && this.opts.leniency()) || 'normal'] || THRESH.normal;
      const usr = resample(pts, N);
      const ref = samplePath(this.strokes[this.idx]);
      const later = [];
      for (let j = this.idx + 1; j < this.n; j++) later.push([j, samplePath(this.strokes[j])]);
      if (fits(ref, usr, T)) {
        if (reversed(ref.pts, usr)) return { ok: false, kind: 'direction' };
        // A later stroke that fits much better (e.g. parallel lines in き) means wrong order.
        const d = meanDist(ref.pts, usr);
        for (const [j, r] of later) {
          const dj = meanDist(r.pts, usr);
          if (dj < T && dj < d * 0.5 && meanDist(ref.pts, r.pts) >= 8 && !reversed(r.pts, usr)) {
            return { ok: false, kind: 'order', other: j };
          }
        }
        return { ok: true };
      }
      if (fits(ref, usr.slice().reverse(), T)) return { ok: false, kind: 'direction' };
      for (const [j, r] of later) {
        if (fits(r, usr, T, true)) return { ok: false, kind: 'order', other: j };
      }
      return { ok: false, kind: 'shape' };
    }

    // For free mode: clear user ink.
    clearUser() { this.userStrokes = []; this.redrawInk(); }

    // Reference points for a stroke (used by tests).
    static refPoints(ch, i) { return samplePath(window.STROKES[ch][i]).pts; }
  }

  window.Writer = Writer;
})();
