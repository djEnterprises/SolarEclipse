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
'use strict';

(function () {

const Eph = (typeof module !== 'undefined' && module.exports)
  ? require('./ephemeris.js')
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
    this.idx = { sun: names.indexOf('Sun'), earth: names.indexOf('Earth'), moon: names.indexOf('Moon') };
  }

  computeAccelerations() {
    const { n, gm, pos, acc } = this;
    acc.fill(0);
    for (let i = 0; i < n; i++) {
      const xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2];
      for (let j = i + 1; j < n; j++) {
        const dx = pos[3 * j] - xi;
        const dy = pos[3 * j + 1] - yi;
        const dz = pos[3 * j + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz;
        const inv = 1 / (r2 * Math.sqrt(r2));
        const fi = gm[j] * inv, fj = gm[i] * inv;
        acc[3 * i] += fi * dx; acc[3 * i + 1] += fi * dy; acc[3 * i + 2] += fi * dz;
        acc[3 * j] -= fj * dx; acc[3 * j + 1] -= fj * dy; acc[3 * j + 2] -= fj * dz;
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
    let ke = 0, pe = 0;
    for (let i = 0; i < n; i++) {
      const vx = vel[3 * i], vy = vel[3 * i + 1], vz = vel[3 * i + 2];
      ke += 0.5 * gm[i] * (vx * vx + vy * vy + vz * vz);
      for (let j = i + 1; j < n; j++) {
        const dx = pos[3 * j] - pos[3 * i];
        const dy = pos[3 * j + 1] - pos[3 * i + 1];
        const dz = pos[3 * j + 2] - pos[3 * i + 2];
        pe -= gm[i] * gm[j] / Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  const ax = moon[0] - sun[0], ay = moon[1] - sun[1], az = moon[2] - sun[2];
  const D = Math.sqrt(ax * ax + ay * ay + az * az);
  const ux = ax / D, uy = ay / D, uz = az / D;

  const wx = earth[0] - moon[0], wy = earth[1] - moon[1], wz = earth[2] - moon[2];
  const s = wx * ux + wy * uy + wz * uz;       // Earth's distance beyond Moon along axis
  if (s <= 0) return null;                      // Moon not between Sun and Earth

  const px = wx - s * ux, py = wy - s * uy, pz = wz - s * uz;
  const dperp = Math.sqrt(px * px + py * py + pz * pz);

  const rp = R_MOON + s * (R_SUN + R_MOON) / D;
  const ru = R_MOON - s * (R_SUN - R_MOON) / D;

  if (dperp >= rp + R_EARTH) return null;

  // Central eclipse only when the shadow axis actually intersects the Earth
  let type = 'partial';
  if (dperp < R_EARTH) type = ru > 0 ? 'total' : 'annular';

  return { dperp, s, ru, rp, type, depth: (rp + R_EARTH - dperp) / R_EARTH };
}

// Streams sim states; collects one event per eclipse (at greatest depth).
class EclipseDetector {
  constructor() {
    this.events = [];
    this._active = null;
  }

  sample(sim) {
    const g = solarEclipseGeometry(sim.body(sim.idx.sun), sim.body(sim.idx.earth), sim.body(sim.idx.moon));
    if (g) {
      if (!this._active || g.dperp < this._active.dperp) {
        this._active = { jd: sim.jd, ...g };
      }
    } else if (this._active) {
      this.events.push(this._active);
      this._active = null;
      return this.events[this.events.length - 1];
    }
    return null;
  }
}

const Physics = { NBodySimulation, EclipseDetector, solarEclipseGeometry, R_SUN, R_MOON, R_EARTH };

if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
if (typeof window !== 'undefined') window.Physics = Physics;

})();
