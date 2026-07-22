/*
 * physics.js — the "first principles" part.
 *
 * After the start epoch, nothing here knows anything about orbits, Kepler,
 * or eclipses-as-a-concept. There is exactly one law:
 *
 *     a_i = Σ_j  G m_j (r_j − r_i) / |r_j − r_i|³
 *
 * integrated with velocity Verlet (symplectic, 2nd order). Solar eclipses
 * fall out of the geometry: whenever the Moon's shadow cone, traced from
 * the Sun through the Moon, sweeps across the Earth.
 */
"use strict";

(function () {
  const Eph =
    typeof module !== "undefined" && module.exports
      ? require("./ephemeris.js")
      : window.Ephemeris;

  const R_SUN = Eph.R_SUN_KM / Eph.AU_KM;
  const R_MOON = Eph.R_MOON_KM / Eph.AU_KM;
  const R_EARTH = Eph.R_EARTH_KM / Eph.AU_KM;

  class NBodySimulation {
    constructor(jd0) {
      const { names, gm, pos, vel } = Eph.buildSystem(jd0);
      this.names = names;
      this.gm = gm;
      this.n = names.length;
      // Flat typed arrays for speed
      this.pos = new Float64Array(this.n * 3);
      this.vel = new Float64Array(this.n * 3);
      this.acc = new Float64Array(this.n * 3);
      for (let i = 0; i < this.n; i++) {
        for (let k = 0; k < 3; k++) {
          this.pos[3 * i + k] = pos[i][k];
          this.vel[3 * i + k] = vel[i][k];
        }
      }
      this.jd = jd0;
      this.computeAccelerations();
      this.e0 = this.totalEnergy();
      this.idx = {
        sun: names.indexOf("Sun"),
        earth: names.indexOf("Earth"),
        moon: names.indexOf("Moon"),
      };
    }

    computeAccelerations() {
      const { n, gm, pos, acc } = this;
      acc.fill(0);
      for (let i = 0; i < n; i++) {
        const xi = pos[3 * i],
          yi = pos[3 * i + 1],
          zi = pos[3 * i + 2];
        for (let j = i + 1; j < n; j++) {
          const dx = pos[3 * j] - xi;
          const dy = pos[3 * j + 1] - yi;
          const dz = pos[3 * j + 2] - zi;
          const r2 = dx * dx + dy * dy + dz * dz;
          const inv = 1 / (r2 * Math.sqrt(r2));
          const fi = gm[j] * inv,
            fj = gm[i] * inv;
          acc[3 * i] += fi * dx;
          acc[3 * i + 1] += fi * dy;
          acc[3 * i + 2] += fi * dz;
          acc[3 * j] -= fj * dx;
          acc[3 * j + 1] -= fj * dy;
          acc[3 * j + 2] -= fj * dz;
        }
      }
    }

    // One velocity-Verlet step of dt days.
    step(dt) {
      const { n, pos, vel, acc } = this;
      const half = dt / 2;
      for (let i = 0; i < 3 * n; i++) {
        vel[i] += acc[i] * half;
        pos[i] += vel[i] * dt;
      }
      this.computeAccelerations();
      for (let i = 0; i < 3 * n; i++) vel[i] += acc[i] * half;
      this.jd += dt;
    }

    totalEnergy() {
      const { n, gm, pos, vel } = this;
      let ke = 0,
        pe = 0;
      for (let i = 0; i < n; i++) {
        const vx = vel[3 * i],
          vy = vel[3 * i + 1],
          vz = vel[3 * i + 2];
        ke += 0.5 * gm[i] * (vx * vx + vy * vy + vz * vz);
        for (let j = i + 1; j < n; j++) {
          const dx = pos[3 * j] - pos[3 * i];
          const dy = pos[3 * j + 1] - pos[3 * i + 1];
          const dz = pos[3 * j + 2] - pos[3 * i + 2];
          pe -= (gm[i] * gm[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
      }
      return ke + pe; // per unit G; ratios are what we report
    }

    energyDrift() {
      return Math.abs((this.totalEnergy() - this.e0) / this.e0);
    }

    body(i) {
      return [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]];
    }
  }

  // --- Solar-eclipse geometry --------------------------------------------------
  //
  // Trace the shadow cone from the Sun through the Moon. At the Earth's
  // distance s beyond the Moon (measured along the Sun→Moon axis):
  //   penumbra radius  rp = R_moon + s·(R_sun + R_moon)/D
  //   umbra radius     ru = R_moon − s·(R_sun − R_moon)/D   (< 0 ⇒ antumbra)
  // An eclipse is visible somewhere on Earth when the Earth's limb reaches
  // the penumbra; it is total/annular when the umbra/antumbra axis region
  // reaches the Earth.
  function solarEclipseGeometry(sun, earth, moon) {
    const ax = moon[0] - sun[0],
      ay = moon[1] - sun[1],
      az = moon[2] - sun[2];
    const D = Math.sqrt(ax * ax + ay * ay + az * az);
    const ux = ax / D,
      uy = ay / D,
      uz = az / D;

    const wx = earth[0] - moon[0],
      wy = earth[1] - moon[1],
      wz = earth[2] - moon[2];
    const s = wx * ux + wy * uy + wz * uz; // Earth's distance beyond Moon along axis
    if (s <= 0) return null; // Moon not between Sun and Earth

    const px = wx - s * ux,
      py = wy - s * uy,
      pz = wz - s * uz;
    const dperp = Math.sqrt(px * px + py * py + pz * pz);

    const rp = R_MOON + (s * (R_SUN + R_MOON)) / D;
    const ru = R_MOON - (s * (R_SUN - R_MOON)) / D;

    if (dperp >= rp + R_EARTH) return null;

    // Central eclipse only when the shadow axis actually intersects the Earth
    let type = "partial";
    if (dperp < R_EARTH) type = ru > 0 ? "total" : "annular";

    return { dperp, s, ru, rp, type, depth: (rp + R_EARTH - dperp) / R_EARTH };
  }

  // --- Lunar-eclipse geometry --------------------------------------------------
  //
  // The mirror image of the solar case: instead of the Moon's shadow falling on
  // the Earth, the EARTH's shadow falls on the Moon. Trace the shadow cone from
  // the Sun through the Earth. At the Moon's distance s beyond the Earth (along
  // the Sun→Earth axis):
  //   penumbra radius  rp = R_earth + s·(R_sun + R_earth)/D
  //   umbra radius     ru = R_earth − s·(R_sun − R_earth)/D
  // The Moon itself has radius R_moon, so with dperp the Moon-centre distance
  // from the shadow axis:
  //   total     — Moon wholly inside the umbra:      dperp ≤ ru − R_moon
  //   partial   — Moon touches the umbra:            dperp <  ru + R_moon
  //   penumbral — Moon reaches only the penumbra:    dperp <  rp + R_moon
  // (Earth's umbra at the Moon is ~4600 km, the penumbra ~8200 km, vs a ~1737 km
  // lunar radius — purely geometric, no atmospheric enlargement.)
  function lunarEclipseGeometry(sun, earth, moon) {
    const ax = earth[0] - sun[0],
      ay = earth[1] - sun[1],
      az = earth[2] - sun[2];
    const D = Math.sqrt(ax * ax + ay * ay + az * az);
    const ux = ax / D,
      uy = ay / D,
      uz = az / D;

    const wx = moon[0] - earth[0],
      wy = moon[1] - earth[1],
      wz = moon[2] - earth[2];
    const s = wx * ux + wy * uy + wz * uz; // Moon's distance beyond Earth along axis
    if (s <= 0) return null; // Moon on the sunward side of Earth

    const px = wx - s * ux,
      py = wy - s * uy,
      pz = wz - s * uz;
    const dperp = Math.sqrt(px * px + py * py + pz * pz);

    const rp = R_EARTH + (s * (R_SUN + R_EARTH)) / D;
    const ru = R_EARTH - (s * (R_SUN - R_EARTH)) / D;

    if (dperp >= rp + R_MOON) return null; // Moon clears even the penumbra

    let type = "penumbral";
    if (dperp < ru + R_MOON) type = dperp <= ru - R_MOON ? "total" : "partial";

    return { dperp, s, ru, rp, type, depth: (rp + R_MOON - dperp) / R_MOON };
  }

  // Streams sim states; collects one event per eclipse (at greatest depth).
  // Solar and lunar events are tracked in the SAME pass through separate active
  // slots so a lunar event can never clobber an in-flight solar one.
  class EclipseDetector {
    constructor() {
      this.events = []; // solar
      this.lunarEvents = []; // lunar
      this._active = null;
      this._lunarActive = null;
    }

    // Fold one geometry reading into a min-separation tracker, flushing the
    // deepest sample as a completed event when the eclipse ends. Returns the
    // completed event (or null).
    _track(g, jd, activeKey, eventsKey) {
      if (g) {
        if (!this[activeKey] || g.dperp < this[activeKey].dperp) {
          this[activeKey] = { jd, ...g };
        }
      } else if (this[activeKey]) {
        this[eventsKey].push(this[activeKey]);
        this[activeKey] = null;
        return this[eventsKey][this[eventsKey].length - 1];
      }
      return null;
    }

    sample(sim) {
      const sun = sim.body(sim.idx.sun);
      const earth = sim.body(sim.idx.earth);
      const moon = sim.body(sim.idx.moon);
      const solar = this._track(
        solarEclipseGeometry(sun, earth, moon),
        sim.jd,
        "_active",
        "events",
      );
      this._track(
        lunarEclipseGeometry(sun, earth, moon),
        sim.jd,
        "_lunarActive",
        "lunarEvents",
      );
      return solar; // preserve the solar-only return contract for existing callers
    }
  }

  const Physics = {
    NBodySimulation,
    EclipseDetector,
    solarEclipseGeometry,
    lunarEclipseGeometry,
    R_SUN,
    R_MOON,
    R_EARTH,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Physics;
  if (typeof window !== "undefined") window.Physics = Physics;
})();
