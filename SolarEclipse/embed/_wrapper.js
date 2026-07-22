/*
 * solar-background wrapper — turns the verified N-body engine into a
 * one-line ambient background for any page (e.g. the djEnterprises homepage).
 *
 * Usage: load the bundled solar-background.js, then mark a target element
 * with the data-solar-background attribute. A bare <div data-solar-background>
 * fills its container; putting the attribute on <body> fills the viewport
 * behind the page. Tunable via the data-* options below.
 *
 * Options via data-* attributes:
 *   data-scale    view radius in AU (default 1.9 — the inner solar system)
 *   data-opacity  0..1 (default 0.4)
 *   data-speed    sim steps per frame (default 5; higher = faster orbits)
 *
 * Behaviour: ambient (no labels/controls), pauses when scrolled off-screen
 * or the tab is hidden, and renders a single correct static frame under
 * prefers-reduced-motion. Reads colours from CSS custom properties, so it
 * adopts the host page's palette (falls back to the SolarEclipse defaults).
 */
'use strict';
(function () {
  function mount(opts) {
    opts = opts || {};
    const host = opts.container || document.body;
    const fullBleed = host === document.body || opts.fullBleed;

    const wrap = document.createElement('div');
    wrap.className = 'solar-bg-layer';
    Object.assign(wrap.style, {
      position: fullBleed ? 'fixed' : 'absolute',
      inset: '0',
      zIndex: opts.zIndex != null ? String(opts.zIndex) : (fullBleed ? '-1' : '0'),
      pointerEvents: 'none',
      opacity: String(opts.opacity != null ? opts.opacity : 0.4),
      overflow: 'hidden',
    });
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
    wrap.appendChild(canvas);

    if (fullBleed) {
      document.body.insertBefore(wrap, document.body.firstChild);
    } else {
      const cs = getComputedStyle(host);
      if (cs.position === 'static') host.style.position = 'relative';
      host.insertBefore(wrap, host.firstChild);
    }

    const reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const sim = new window.SolarSim({
      orbitCanvas: canvas,
      ambient: true,
      scaleAU: opts.scaleAU || 1.9,
      stepsPerFrame: opts.stepsPerFrame || 5,
      startDate: opts.startDate || new Date(),
    });
    if (!reduce) sim.play();

    // pause when off-screen or tab hidden — this is background, not a headline act
    let onScreen = true;
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        onScreen = e.isIntersecting;
        if (!reduce) { onScreen ? sim.play() : sim.pause(); }
      }
    }, { threshold: 0 });
    io.observe(wrap);
    document.addEventListener('visibilitychange', () => {
      if (reduce) return;
      if (document.hidden) sim.pause(); else if (onScreen) sim.play();
    });

    return { sim, element: wrap, destroy() { sim.destroy(); io.disconnect(); wrap.remove(); } };
  }

  function autoInit() {
    document.querySelectorAll('[data-solar-background]').forEach((el) => {
      const isBody = el === document.body;
      mount({
        container: isBody ? document.body : el,
        fullBleed: isBody,
        scaleAU: parseFloat(el.dataset.scale) || 1.9,
        opacity: el.dataset.opacity != null ? parseFloat(el.dataset.opacity) : 0.4,
        stepsPerFrame: parseInt(el.dataset.speed) || 5,
      });
    });
  }

  window.SolarBackground = { mount, autoInit };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
