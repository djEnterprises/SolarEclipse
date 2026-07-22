/*
 * site.js — page interactions for the SolarEclipse showcase.
 *  - the persistent "live figure": hero → docked, one running integrator
 *  - scroll reveals + active-nav tracking (IntersectionObserver)
 *  - the interactive instrument (chapter 05)
 *  - the verification table, rendered from data/eclipses.json
 * Framework-free. Respects prefers-reduced-motion. Pauses off-screen sims.
 */
'use strict';

(function () {
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------------- persistent hero → docked live figure ---------------- */
  const stage = document.getElementById('heroOrbit');
  const stageEl = document.getElementById('stage');
  let hero = null;
  if (stage && window.SolarSim) {
    hero = new window.SolarSim({
      orbitCanvas: stage,
      ambient: true,
      scaleAU: 1.8,
      stepsPerFrame: reduceMotion ? 1 : 6,
      onTick: (s) => {
        const e = document.getElementById('hudEpoch');
        const st = document.getElementById('hudStep');
        const dr = document.getElementById('hudDrift');
        if (e) e.textContent = hero.startDate.toISOString().slice(0, 10);
        if (st) st.textContent = Math.round(s.elapsedDays * 96).toLocaleString();
        if (dr) dr.textContent = s.energyDrift.toExponential(1);
        const live = document.getElementById('liveDrift');
        if (live) live.textContent = s.energyDrift.toExponential(2);
      },
    });
    if (!reduceMotion) hero.play(); else hero._drawOrbit();
    window.SolarEclipse = Object.assign(window.SolarEclipse || {}, { hero });

    // dock on scroll past the hero
    const heroSection = document.querySelector('.hero');
    const dockObs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        stageEl.classList.toggle('is-docked', en.intersectionRatio < 0.35);
      }
    }, { threshold: [0, 0.35, 1] });
    if (heroSection) dockObs.observe(heroSection);

    // pause the ambient figure while the interactive instrument owns the screen
    const instSection = document.querySelector('.instrument-wrap');
    if (instSection) {
      const pauseObs = new IntersectionObserver((entries) => {
        for (const en of entries) {
          stageEl.classList.toggle('is-hidden', en.isIntersecting);
          if (en.isIntersecting) hero.pause(); else if (!reduceMotion) hero.play();
        }
      }, { threshold: 0.2 });
      pauseObs.observe(instSection);
    }
  }

  /* ---------------- scroll reveals + chapter active state ---------------- */
  const revealObs = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) { en.target.classList.add('in-view'); revealObs.unobserve(en.target); }
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => revealObs.observe(el));
  document.querySelectorAll('.chapter').forEach((el) => {
    new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) e.target.classList.add('in-view');
    }, { threshold: 0.4 }).observe(el);
  });

  // active nav link
  const navLinks = Array.from(document.querySelectorAll('.topbar nav a'));
  const idToLink = {};
  navLinks.forEach((a) => { idToLink[a.getAttribute('href').slice(1)] = a; });
  const navObs = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const link = idToLink[en.target.id];
      if (link && en.isIntersecting) {
        navLinks.forEach((l) => l.classList.remove('active'));
        link.classList.add('active');
      }
    }
  }, { threshold: 0.5 });
  ['method', 'simulation', 'verification', 'caveats'].forEach((id) => {
    const el = document.getElementById(id); if (el) navObs.observe(el);
  });

  /* ---------------- interactive instrument (chapter 05) ------------------ */
  const instOrbit = document.getElementById('instOrbit');
  const instInset = document.getElementById('instInset');
  let inst = null;

  const CATALOG = [ // NASA dates, for the ✓ badge only; never fed to the sim
    '1919-05-29', '2017-08-21', '2045-08-12', // famous eclipses reachable via the picker
    '2024-04-08', '2024-10-02', '2025-03-29', '2025-09-21', '2026-02-17',
    '2026-08-12', '2027-02-06', '2027-08-02', '2028-01-26', '2028-07-22',
    '2029-01-14', '2029-06-12', '2029-07-11', '2029-12-05', '2030-06-01', '2030-11-25',
  ];
  function catalogMatch(jd) {
    const Eph = window.Ephemeris;
    for (const d of CATALOG) {
      if (Math.abs(Eph.dateToJd(new Date(d + 'T12:00:00Z')) - jd) < 1.5) return d;
    }
    return null;
  }

  function speedFromSlider(v) { return Math.max(1, Math.round(Math.exp(Math.log(560) * v / 100))); }
  function speedLabel(steps) {
    const dps = steps * (1 / 96) * 60;
    return dps >= 1 ? `${dps.toFixed(0)} d/s` : `${(dps * 24).toFixed(1)} h/s`;
  }

  function initInstrument() {
    if (inst || !instOrbit || !window.SolarSim) return;
    const bannerEl = document.getElementById('instBanner');
    let bannerTimer = null;

    inst = new window.SolarSim({
      orbitCanvas: instOrbit,
      insetCanvas: instInset,
      scaleAU: 1.8,
      stepsPerFrame: speedFromSlider(34),
      onTick: (s) => {
        const d = s.date;
        document.getElementById('instDate').textContent =
          `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
        document.getElementById('instSub').textContent =
          `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC · JD ${s.jd.toFixed(1)} · ΔE/E ${s.energyDrift.toExponential(1)}`;
      },
      onEclipse: (ev) => {
        const cat = catalogMatch(ev.jd);
        const log = document.getElementById('instLog');
        const row = document.createElement('div');
        row.className = 'ev';
        row.innerHTML =
          `<span class="chip ${ev.type}">${ev.type}</span>` +
          `<span class="when">${ev.dateUTC}</span>` +
          `<span class="meta">axis miss ${ev.axisMissKm.toLocaleString()} km` +
          (cat ? ` · <span class="ok">✓ NASA catalog ${cat}</span>` : '') + `</span>`;
        log.prepend(row);
        while (log.children.length > 6) log.removeChild(log.lastChild);
        bannerEl.textContent = `☉ ${ev.type.toUpperCase()} SOLAR ECLIPSE — ${ev.dateUTC}` + (cat ? '  ·  ✓ verified' : '');
        bannerEl.classList.add('show');
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 6000);
        if (ev.type === 'total') inst.triggerBloom(); // the one flourish, from a real totality
        if (navigator.vibrate && !reduceMotion) navigator.vibrate(18);
      },
    });

    window.SolarEclipse = Object.assign(window.SolarEclipse || {}, { instrument: inst });
    document.getElementById('rate').textContent = speedLabel(inst.stepsPerFrame);
    const playBtn = document.getElementById('btnPlay');
    if (reduceMotion) { playBtn.textContent = '▶ Play'; }
    else { inst.play(); }

    playBtn.addEventListener('click', () => {
      inst.toggle(); playBtn.textContent = inst.playing ? '❚❚ Pause' : '▶ Play';
    });
    document.getElementById('speed').addEventListener('input', (e) => {
      const n = speedFromSlider(+e.target.value);
      inst.setStepsPerFrame(n);
      document.getElementById('rate').textContent = speedLabel(n);
    });
    const inner = document.getElementById('scaleInner');
    const full = document.getElementById('scaleFull');
    inner.addEventListener('click', () => { inst.setScale(1.8); inner.classList.add('active'); full.classList.remove('active'); });
    full.addEventListener('click', () => { inst.setScale(31); full.classList.add('active'); inner.classList.remove('active'); });

    const predictBtn = document.getElementById('btnPredict');
    predictBtn.addEventListener('click', () => {
      predictBtn.disabled = true; predictBtn.textContent = '… integrating';
      inst.predictNextEclipse(() => {
        predictBtn.disabled = false; predictBtn.textContent = '⏩ Predict next eclipse';
        playBtn.textContent = inst.playing ? '❚❚ Pause' : '▶ Play';
      });
    });
    document.getElementById('btnReseed').addEventListener('click', () => {
      inst.reseedToNow();
      document.getElementById('instLog').innerHTML = '';
    });

    // jump to a famous historical eclipse: seed ~20 days before, then seek it
    const jump = document.getElementById('jumpEclipse');
    jump.addEventListener('change', () => {
      const v = jump.value;
      jump.selectedIndex = 0;
      if (!v) return;
      const target = new Date(v + 'T12:00:00Z');
      inst.reseedTo(new Date(target.getTime() - 20 * 86400000));
      document.getElementById('instLog').innerHTML = '';
      predictBtn.disabled = true; predictBtn.textContent = '… seeking';
      inst.predictNextEclipse(() => {
        predictBtn.disabled = false; predictBtn.textContent = '⏩ Predict next eclipse';
        playBtn.textContent = inst.playing ? '❚❚ Pause' : '▶ Play';
      });
    });

    // crosshair hover telemetry + click-to-pin — makes it an instrument
    const tip = document.getElementById('instTip');
    const showTip = (tel, x, y) => {
      if (!tel) { tip.classList.remove('show'); return; }
      tip.innerHTML = `<b>${tel.name}</b>&nbsp; ${tel.distAU.toFixed(3)} AU &nbsp;·&nbsp; ${tel.speedKmS.toFixed(1)} km/s`;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      tip.classList.add('show');
    };
    const localXY = (e) => {
      const r = instOrbit.getBoundingClientRect();
      const t = e.touches && e.touches[0] ? e.touches[0] : e;
      return [t.clientX - r.left, t.clientY - r.top];
    };
    instOrbit.addEventListener('mousemove', (e) => {
      const [x, y] = localXY(e);
      const tel = inst.pointerMove(x, y);
      showTip(tel, x + 14, y + 16);
      instOrbit.style.cursor = tel ? 'crosshair' : 'default';
      if (!inst.playing) inst.render();
    });
    instOrbit.addEventListener('mouseleave', () => {
      inst.pointerLeave(); tip.classList.remove('show'); if (!inst.playing) inst.render();
    });
    instOrbit.addEventListener('click', (e) => {
      const [x, y] = localXY(e);
      const tel = inst.pointerClick(x, y);
      showTip(tel, x + 14, y + 16);
      if (!inst.playing) inst.render();
    });
  }

  // build the instrument only when it first scrolls near view (saves CPU)
  const instWrap = document.querySelector('.instrument-wrap');
  if (instWrap) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { initInstrument(); io.disconnect(); }
      }
    }, { rootMargin: '400px' });
    io.observe(instWrap);
  }

  /* ---------------- verification table from real dataset ---------------- */
  // Multi-file build fetches the JSON; the single-file preview injects it inline.
  (window.__ECLIPSE_DATA__ ? Promise.resolve(window.__ECLIPSE_DATA__) : fetch('data/eclipses.json').then((r) => r.json()))
    .then((data) => {
      const m = data.meta;
      const intro = document.getElementById('vintro');
      if (intro) intro.innerHTML =
        `Seed the model at <strong>${m.seedEpoch}</strong> and run it forward ${m.horizonYears} years ` +
        `(<span class="num">${m.integrationSteps.toLocaleString()}</span> steps at a ${m.timestepMinutes}-minute interval), ` +
        `then compare against the NASA five-millennium solar eclipse catalog. These numbers are generated by the real integration, not typed in by hand.`;

      const sc = document.getElementById('scorecard');
      if (sc) sc.innerHTML = [
        [`${m.matched}/${m.total}`, 'eclipses predicted'],
        [`${m.correctType}/${m.total}`, 'correct type'],
        [`${m.meanTimingErrorHours} h`, 'mean timing error'],
        [`${m.energyDriftRelative.toExponential(1)}`, 'energy drift ΔE/E'],
      ].map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

      const tb = document.getElementById('vrows');
      if (tb) tb.innerHTML = data.eclipses.map((e) => {
        const t = e.predictedType || e.catalogType;
        const dt = (e.timingErrorHours != null)
          ? `${e.timingErrorHours > 0 ? '+' : ''}${e.timingErrorHours} h` : '—';
        return `<tr>
          <td>${e.catalogDate}</td>
          <td><span class="chip ${e.catalogType}">${e.catalogType}</span></td>
          <td>${e.predictedUTC || '<span class="err">missed</span>'}</td>
          <td>${e.predictedType ? `<span class="chip ${e.predictedType}">${e.predictedType}</span>` : '—'}</td>
          <td class="err">${dt}</td>
          <td class="err">${e.axisMissKm != null ? e.axisMissKm.toLocaleString() + ' km' : '—'}</td>
        </tr>`;
      }).join('');
    })
    .catch(() => {
      const tb = document.getElementById('vrows');
      if (tb) tb.innerHTML = '<tr><td colspan="6" class="err">Run this from a server (fetch blocked on file://). See the numbers in the copy above.</td></tr>';
    });
})();
