/*
 * simengine.js — the reusable SolarEclipse simulation instrument.
 *
 * Wraps the verified N-body core (assets/core/*.js) and renders it into
 * Canvas elements. Colors are read from CSS custom properties so the visual
 * design lives entirely in the stylesheet — this module is theme-agnostic.
 *
 * Public API:
 *   const sim = new SolarSim({
 *     orbitCanvas, insetCanvas?,        // HTMLCanvasElement(s)
 *     startDate?,                        // Date; defaults to now
 *     scaleAU?,                          // initial view radius in AU (default 1.8)
 *     ambient?,                          // true = decorative hero mode (no readouts)
 *     onTick?(state), onEclipse?(event)  // callbacks
 *   });
 *   sim.play(); sim.pause(); sim.toggle();
 *   sim.setScale(au); sim.setStepsPerFrame(n);
 *   sim.predictNextEclipse();            // fast-forwards; fires onEclipse
 *   sim.reseedToNow();                   // re-sync the epoch to today
 *   sim.destroy();
 */
'use strict';

const AU_KM = 149597870.7;

const BODY_STYLE = {
  Sun:     { varName: '--sun',     fallback: '#ffd76e', r: 7.0, label: true },
  Mercury: { varName: '--mercury', fallback: '#b9a591', r: 2.2, label: true },
  Venus:   { varName: '--venus',   fallback: '#e8c97a', r: 3.2, label: true },
  Earth:   { varName: '--earth',   fallback: '#6db1ff', r: 3.4, label: true },
  Moon:    { varName: '--moon',    fallback: '#cfd4e2', r: 1.6, label: false },
  Mars:    { varName: '--mars',    fallback: '#e0764f', r: 2.8, label: true },
  Jupiter: { varName: '--jupiter', fallback: '#d9a96b', r: 5.5, label: true },
  Saturn:  { varName: '--saturn',  fallback: '#e3cf9b', r: 5.0, label: true },
  Uranus:  { varName: '--uranus',  fallback: '#9adbe8', r: 4.0, label: true },
  Neptune: { varName: '--neptune', fallback: '#7a96f0', r: 4.0, label: true },
};

function cssVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

class SolarSim {
  constructor(opts) {
    const Eph = window.Ephemeris;
    const Phy = window.Physics;
    this.Eph = Eph; this.Phy = Phy;

    this.orbitCanvas = opts.orbitCanvas;
    this.octx = this.orbitCanvas.getContext('2d');
    this.insetCanvas = opts.insetCanvas || null;
    this.ictx = this.insetCanvas ? this.insetCanvas.getContext('2d') : null;

    this.ambient = !!opts.ambient;
    this.onTick = opts.onTick || null;
    this.onEclipse = opts.onEclipse || null;

    this.startDate = opts.startDate || new Date();
    this.jd0 = Eph.dateToJd(this.startDate);
    this.scaleAU = opts.scaleAU || 1.8;
    this.stepsPerFrame = opts.stepsPerFrame || 8;
    this.dt = 1 / 96; // 15-minute timestep, fixed

    this._reduceMotion = typeof window !== 'undefined' &&
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this._build();

    this.playing = false;
    this.jumping = false;
    this.hover = null;        // hovered body index
    this.pinned = null;       // pinned body index
    this._screen = [];        // last-drawn [x,y] (backing px) per body index
    this._bloom = null;       // active corona-bloom state {t}
    this._grain = null;       // cached film-grain tile
    this.onBloom = opts.onBloom || null;
    this._raf = null;
    this._resize = this._resize.bind(this);
    this._loop = this._loop.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
    // Render one frame immediately so the canvas is never blank.
    this._drawOrbit();
    if (this.ictx) this._drawInset();
  }

  _build() {
    const { NBodySimulation, EclipseDetector } = this.Phy;
    this.sim = new NBodySimulation(this.jd0);
    this.detector = new EclipseDetector();
    this.trails = this.sim.names.map(() => []);
    this.TRAIL_MAX = this.ambient ? 1400 : 900;
  }

  reseedTo(date) {
    this.startDate = date instanceof Date ? date : new Date(date);
    this.jd0 = this.Eph.dateToJd(this.startDate);
    this.hover = null; this.pinned = null; this._bloom = null;
    this._build();
    this._drawOrbit();
    if (this.ictx) this._drawInset();
  }
  reseedToNow() { this.reseedTo(new Date()); }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = this.orbitCanvas;
    c.width = Math.max(1, c.clientWidth * dpr);
    c.height = Math.max(1, c.clientHeight * dpr);
    if (this.insetCanvas) {
      const i = this.insetCanvas;
      i.width = Math.max(1, i.clientWidth * dpr);
      i.height = Math.max(1, i.clientHeight * dpr);
    }
    this._dpr = dpr;
    this._drawOrbit();
    if (this.ictx) this._drawInset();
  }

  play() { if (!this.playing) { this.playing = true; if (!this._raf) this._raf = requestAnimationFrame(this._loop); } }
  pause() { this.playing = false; }
  toggle() { this.playing ? this.pause() : this.play(); }
  setScale(au) { this.scaleAU = au; this.trails.forEach((t) => (t.length = 0)); this._drawOrbit(); }
  setStepsPerFrame(n) { this.stepsPerFrame = Math.max(1, n | 0); }
  render() { this._drawOrbit(); if (this.ictx) this._drawInset(); }

  _pushTrails() {
    const s = this.sim;
    for (let i = 0; i < s.n; i++) {
      const t = this.trails[i];
      t.push([s.pos[3 * i], s.pos[3 * i + 1]]);
      if (t.length > this.TRAIL_MAX) t.shift();
    }
  }

  _advance(steps) {
    let event = null;
    for (let k = 0; k < steps; k++) {
      this.sim.step(this.dt);
      const ev = this.detector.sample(this.sim);
      if (ev) event = ev;
      if ((k & 3) === 0) this._pushTrails();
    }
    if (event && this.onEclipse) this.onEclipse(this._eclipseInfo(event));
    return event;
  }

  _eclipseInfo(ev) {
    return {
      jd: ev.jd,
      dateUTC: this.Eph.jdToUTCString(ev.jd),
      type: ev.type,
      axisMissKm: Math.round(ev.dperp * AU_KM),
    };
  }

  // Fast-forward the physics (chunked so the UI stays responsive) to the next eclipse.
  predictNextEclipse(onDone) {
    if (this.jumping) return;
    this.jumping = true;
    const wasPlaying = this.playing;
    this.playing = false;
    const chunk = () => {
      let found = null;
      for (let s = 0; s < 9000 && !found; s++) {
        this.sim.step(this.dt);
        found = this.detector.sample(this.sim);
        if (s % 48 === 0) this._pushTrails();
      }
      this._drawOrbit();
      if (this.ictx) this._drawInset();
      this._emitTick();
      if (found) {
        this.jumping = false;
        const info = this._eclipseInfo(found);
        if (this.onEclipse) this.onEclipse(info);
        if (onDone) onDone(info);
        if (wasPlaying) this.play();
      } else {
        requestAnimationFrame(chunk);
      }
    };
    requestAnimationFrame(chunk);
  }

  _loop() {
    this._raf = null;
    if (this.playing && !this.jumping) {
      const steps = this._reduceMotion && this.ambient ? 1 : this.stepsPerFrame;
      this._advance(steps);
    }
    this._drawOrbit();
    if (this.ictx) this._drawInset();
    this._emitTick();
    if (this.playing) this._raf = requestAnimationFrame(this._loop);
  }

  _emitTick() {
    if (!this.onTick) return;
    const d = this.Eph.jdToDate(this.sim.jd);
    this.onTick({
      date: d,
      jd: this.sim.jd,
      elapsedDays: this.sim.jd - this.jd0,
      energyDrift: this.sim.energyDrift(),
      geometry: this._geometry(),
    });
  }

  _geometry() {
    const s = this.sim;
    const sun = s.body(s.idx.sun), earth = s.body(s.idx.earth), moon = s.body(s.idx.moon);
    const a = [sun[0] - earth[0], sun[1] - earth[1], sun[2] - earth[2]];
    const b = [moon[0] - earth[0], moon[1] - earth[1], moon[2] - earth[2]];
    const na = Math.hypot(...a), nb = Math.hypot(...b);
    const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
    const sepDeg = Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
    const g = this.Phy.solarEclipseGeometry(sun, earth, moon);
    return { sepDeg, axisMissKm: g ? Math.round(g.dperp * AU_KM) : null, type: g ? g.type : null };
  }

  // --- heliocentric orbit view ------------------------------------------------
  _drawOrbit() {
    const ctx = this.octx, W = this.orbitCanvas.width, H = this.orbitCanvas.height;
    const dpr = this._dpr || 1;
    const bg = cssVar('--sim-bg', '#06080f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // faint cool vignette so deep space never reads as flat CSS black.
    // Themeable: set --sim-vignette:none to drop it entirely (light hosts), or
    // override the three stops. Dark defaults are unchanged.
    if (cssVar('--sim-vignette', '') !== 'none') {
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.46, 0, W * 0.5, H * 0.46, Math.hypot(W, H) * 0.6);
      vg.addColorStop(0, cssVar('--sim-vignette-0', 'rgba(28,38,66,0.16)'));
      vg.addColorStop(0.55, cssVar('--sim-vignette-1', 'rgba(12,17,32,0.05)'));
      vg.addColorStop(1, cssVar('--sim-vignette-2', 'rgba(2,3,8,0.55)'));
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }

    // deterministic multi-depth starfield (3 tiers: far/dim → near/bright)
    const starCol = cssVar('--star', 'rgba(233,230,221,0.85)');
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const tiers = [
      { n: (W * H) / (5200 * dpr), size: dpr, a: [0.10, 0.28] },
      { n: (W * H) / (13000 * dpr), size: dpr * 1.5, a: [0.30, 0.62] },
      { n: (W * H) / (52000 * dpr), size: dpr * 2.2, a: [0.65, 0.95] },
    ];
    ctx.fillStyle = starCol;
    for (const t of tiers) {
      for (let i = 0; i < t.n; i++) {
        const x = rnd() * W, y = rnd() * H, tw = rnd();
        ctx.globalAlpha = t.a[0] + tw * (t.a[1] - t.a[0]);
        ctx.fillRect(x, y, t.size, t.size);
      }
    }
    ctx.globalAlpha = 1;

    const cx = W / 2, cy = H / 2;
    const scale = Math.min(W, H) / (2.15 * this.scaleAU);
    const s = this.sim;
    const sunP = s.body(s.idx.sun);
    const toScreen = (p) => [cx + (p[0] - sunP[0]) * scale, cy - (p[1] - sunP[1]) * scale];
    this._sunScreen = toScreen(sunP);
    this._screen = new Array(s.n).fill(null);

    for (let i = 0; i < s.n; i++) {
      const name = s.names[i];
      const st = BODY_STYLE[name];
      if (!st) continue;
      if (name === 'Moon' && this.scaleAU > 3) continue;
      const color = cssVar(st.varName, st.fallback);

      const t = this.trails[i];
      if (t.length > 2 && name !== 'Sun') {
        ctx.beginPath();
        for (let k = 0; k < t.length; k++) {
          const [sx, sy] = toScreen(t[k]);
          k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
        }
        ctx.strokeStyle = this._hexA(color, 0.28);
        ctx.lineWidth = dpr;
        ctx.stroke();
      }

      const [sx, sy] = toScreen(s.body(i));
      if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
      this._screen[i] = [sx, sy];
      if (name === 'Sun') {
        const rad = 30 * dpr;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
        g.addColorStop(0, cssVar('--sun-core', '#fff3c4'));
        g.addColorStop(0.3, color);
        g.addColorStop(1, this._hexA(color, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 7); ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(sx, sy, st.r * dpr, 0, 7); ctx.fill();
      if (st.label && !this.ambient) {
        ctx.fillStyle = cssVar('--sim-label', 'rgba(221,227,242,0.55)');
        ctx.font = `${10.5 * dpr}px ${cssVar('--mono-stack', 'ui-monospace, monospace')}`;
        ctx.fillText(name, sx + 8 * dpr, sy - 6 * dpr);
      }
    }

    // crosshair on hovered / pinned body (interactive instrument only)
    if (!this.ambient) {
      const accent = cssVar('--accent', '#D9A441');
      for (const idx of [this.pinned, this.hover]) {
        if (idx == null || !this._screen[idx]) continue;
        const [hx, hy] = this._screen[idx];
        const rr = 13 * dpr;
        ctx.strokeStyle = this._hexA(accent, idx === this.pinned ? 0.95 : 0.6);
        ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.arc(hx, hy, rr, 0, 7); ctx.stroke();
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.beginPath();
          ctx.moveTo(hx + ax * rr, hy + ay * rr);
          ctx.lineTo(hx + ax * (rr + 6 * dpr), hy + ay * (rr + 6 * dpr));
          ctx.stroke();
        }
      }
    }

    // corona bloom — the one permitted flourish, fired from a real totality
    if (this._bloom && this._sunScreen) {
      const b = this._bloom; b.t += 1;
      const DUR = 60;
      const p = b.t / DUR;
      const [bx, by] = this._sunScreen;
      const ease = 1 - Math.pow(1 - Math.min(p, 1), 3);
      const maxR = Math.min(W, H) * 0.46;
      // expanding thin ring
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const ringR = ease * maxR;
      ctx.strokeStyle = this._hexA(cssVar('--sun', '#FFD76E'), (1 - p) * 0.9);
      ctx.lineWidth = (1 - p) * 3 * dpr + 0.5 * dpr;
      ctx.beginPath(); ctx.arc(bx, by, ringR, 0, 7); ctx.stroke();
      // central corona bloom
      const cr = (18 + ease * 34) * dpr;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, cr);
      g.addColorStop(0, this._hexA(cssVar('--sun-core', '#FFF3C4'), (1 - p) * 0.85));
      g.addColorStop(0.4, this._hexA(cssVar('--sun', '#FFD76E'), (1 - p) * 0.4));
      g.addColorStop(1, this._hexA(cssVar('--sun', '#FFD76E'), 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, cr, 0, 7); ctx.fill();
      // the diamond-ring point — brightest early, fixed on the corona edge
      if (p < 0.55) {
        const dr = (16 + ease * 20) * dpr;
        const px = bx + Math.cos(-0.6) * dr, py = by + Math.sin(-0.6) * dr;
        const dg = ctx.createRadialGradient(px, py, 0, px, py, 7 * dpr);
        dg.addColorStop(0, this._hexA('#FFFFFF', (0.55 - p) * 1.8));
        dg.addColorStop(1, this._hexA('#FFFFFF', 0));
        ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(px, py, 7 * dpr, 0, 7); ctx.fill();
      }
      ctx.restore();
      if (b.t >= DUR) this._bloom = null;
    }

    // barely-there film grain so gradients never band on deep black
    const grain = this._grainTile();
    if (grain) {
      const pat = ctx.createPattern(grain, 'repeat');
      if (pat) { ctx.globalAlpha = 0.035; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }
  }

  _grainTile() {
    if (this._grain) return this._grain;
    const size = 96;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    let seed = 987654321;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const v = 120 + (seed % 135);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this._grain = c;
    return c;
  }

  triggerBloom() {
    if (this._reduceMotion) return;
    this._bloom = { t: 0 };
    if (this.onBloom) this.onBloom();
  }

  // pointer telemetry: nearest body to (cssX, cssY) within a hit radius
  hitTest(cssX, cssY) {
    const dpr = this._dpr || 1;
    const px = cssX * dpr, py = cssY * dpr;
    let best = null, bestD = (24 * dpr) ** 2;
    for (let i = 0; i < (this._screen ? this._screen.length : 0); i++) {
      const sc = this._screen[i]; if (!sc) continue;
      const d = (sc[0] - px) ** 2 + (sc[1] - py) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  bodyTelemetry(i) {
    if (i == null) return null;
    const s = this.sim;
    const p = s.body(i), sun = s.body(s.idx.sun);
    const distAU = Math.hypot(p[0] - sun[0], p[1] - sun[1], p[2] - sun[2]);
    const vx = s.vel[3 * i], vy = s.vel[3 * i + 1], vz = s.vel[3 * i + 2];
    const speedKmS = Math.hypot(vx, vy, vz) * AU_KM / 86400;
    return { name: s.names[i], distAU, speedKmS };
  }

  pointerMove(cssX, cssY) { this.hover = this.hitTest(cssX, cssY); return this.bodyTelemetry(this.hover); }
  pointerLeave() { this.hover = null; }
  pointerClick(cssX, cssY) {
    const hit = this.hitTest(cssX, cssY);
    this.pinned = (hit != null && hit === this.pinned) ? null : hit;
    return this.bodyTelemetry(this.pinned);
  }

  // --- Earth–Moon shadow inset ------------------------------------------------
  _drawInset() {
    const ctx = this.ictx, W = this.insetCanvas.width, H = this.insetCanvas.height;
    const dpr = this._dpr || 1;
    ctx.fillStyle = cssVar('--inset-bg', '#080b15');
    ctx.fillRect(0, 0, W, H);
    const s = this.sim;
    const earth = s.body(s.idx.earth), moon = s.body(s.idx.moon), sun = s.body(s.idx.sun);
    const cx = W / 2, cy = H / 2;
    const scale = (Math.min(W, H) / 2 - 16 * dpr) / 0.0028;
    const sd = [sun[0] - earth[0], sun[1] - earth[1]];
    const ang = Math.atan2(sd[1], sd[0]);
    const rot = (p) => {
      const dx = p[0] - earth[0], dy = p[1] - earth[1];
      const x = dx * Math.cos(-ang) - dy * Math.sin(-ang);
      const y = dx * Math.sin(-ang) + dy * Math.cos(-ang);
      return [cx - x * scale, cy + y * scale];
    };

    // sunlight rays from the left
    ctx.strokeStyle = this._hexA(cssVar('--sun', '#ffd76e'), 0.30);
    ctx.lineWidth = dpr;
    for (let i = 0; i < 4; i++) {
      const y = (H / 5) * (i + 1);
      ctx.beginPath(); ctx.moveTo(6 * dpr, y); ctx.lineTo(26 * dpr, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(26 * dpr, y); ctx.lineTo(20 * dpr, y - 3 * dpr);
      ctx.moveTo(26 * dpr, y); ctx.lineTo(20 * dpr, y + 3 * dpr); ctx.stroke();
    }

    const g = this.Phy.solarEclipseGeometry(sun, earth, moon);
    const geo = this._geometry();
    const [ex, ey] = rot(earth);
    const [mx, my] = rot(moon);

    if (geo.sepDeg < 25) {
      const coneLen = Math.min(W, 90 * dpr);
      ctx.fillStyle = g ? this._hexA(cssVar('--accent', '#e8a33d'), 0.30)
                        : this._hexA(cssVar('--partial', '#9a8fd1'), 0.14);
      ctx.beginPath();
      ctx.moveTo(mx, my - 2 * dpr);
      ctx.lineTo(mx + coneLen, my - 9 * dpr);
      ctx.lineTo(mx + coneLen, my + 9 * dpr);
      ctx.lineTo(mx, my + 2 * dpr);
      ctx.closePath(); ctx.fill();
    }

    ctx.strokeStyle = this._hexA(cssVar('--moon', '#cfd4e2'), 0.22);
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(ex, ey, Math.hypot(mx - ex, my - ey), 0, 7); ctx.stroke();

    ctx.fillStyle = cssVar('--earth', '#6db1ff');
    ctx.beginPath(); ctx.arc(ex, ey, 6 * dpr, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(ex, ey, 6 * dpr, -Math.PI / 2, Math.PI / 2); ctx.fill();

    ctx.fillStyle = g ? cssVar('--accent', '#e8a33d') : cssVar('--moon', '#cfd4e2');
    ctx.beginPath(); ctx.arc(mx, my, 2.6 * dpr, 0, 7); ctx.fill();
  }

  _hexA(hex, a) {
    hex = (hex || '').trim();
    if (hex.startsWith('rgb')) return hex.replace(/rgba?\(([^)]+)\)/, (m, p) => {
      const parts = p.split(',').map((x) => x.trim()).slice(0, 3); return `rgba(${parts.join(',')},${a})`;
    });
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  destroy() {
    this.pause();
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
  }
}

if (typeof window !== 'undefined') window.SolarSim = SolarSim;
