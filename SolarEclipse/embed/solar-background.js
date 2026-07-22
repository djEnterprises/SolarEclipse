/*! SolarEclipse ambient background — bundled drop-in.
 * Verified N-body core (ephemeris + physics) + engine + mount wrapper.
 * Add to any page: load this file with a script tag, then put the
 * data-solar-background attribute on a container or on the body.
 * © djEnterprises. */
/*
 * ephemeris.js — initial conditions for the solar-system simulation.
 *
 * Planets: JPL approximate Keplerian elements (Standish), valid 1800–2050,
 * J2000 ecliptic frame. The "Earth" entry is the Earth–Moon barycenter (EMB).
 *
 * Moon: truncated ELP-2000/82 series (Meeus, Astronomical Algorithms ch. 47),
 * geocentric ecliptic of date, rotated back to J2000.
 *
 * These analytic series are used ONLY to seed positions and velocities at the
 * chosen start epoch. Everything after t0 is pure Newtonian N-body integration.
 */
"use strict";

(function () {
  const AU_KM = 149597870.7;
  const DEG = Math.PI / 180;

  // Gaussian gravitational constant → GM_sun in AU^3/day^2
  const GM_SUN = 0.01720209895 * 0.01720209895;

  // Sun/body mass ratios (IAU/DE values)
  const MASS_RATIO = {
    Mercury: 6023600,
    Venus: 408523.71,
    Earth: 332946.0487, // Earth alone
    Mars: 3098703.59,
    Jupiter: 1047.348644,
    Saturn: 3497.9018,
    Uranus: 22902.98,
    Neptune: 19412.26,
  };
  const EARTH_MOON_MASS_RATIO = 81.30056;

  // Body radii (km) for eclipse shadow geometry
  const R_SUN_KM = 696000;
  const R_MOON_KM = 1737.4;
  const R_EARTH_KM = 6378.137;

  // --- JPL approximate planetary elements, 1800 AD – 2050 AD ------------------
  // [a (AU), e, I (deg), L (deg), longPeri (deg), longNode (deg)]
  // rates are per Julian century.
  const PLANET_ELEMENTS = [
    {
      name: "Mercury",
      el: [
        0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628,
        48.33076593,
      ],
      rate: [
        0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689,
        -0.12534081,
      ],
    },
    {
      name: "Venus",
      el: [
        0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718,
        76.67984255,
      ],
      rate: [
        0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329,
        -0.27769418,
      ],
    },
    {
      name: "EMB",
      el: [
        1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
      ],
      rate: [
        0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0,
      ],
    },
    {
      name: "Mars",
      el: [
        1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959,
        49.55953891,
      ],
      rate: [
        0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088,
        -0.29257343,
      ],
    },
    {
      name: "Jupiter",
      el: [
        5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983,
        100.47390909,
      ],
      rate: [
        -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668,
        0.20469106,
      ],
    },
    {
      name: "Saturn",
      el: [
        9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831,
        113.66242448,
      ],
      rate: [
        -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216,
        -0.28867794,
      ],
    },
    {
      name: "Uranus",
      el: [
        19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763,
        74.01692503,
      ],
      rate: [
        -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281,
        0.04240589,
      ],
    },
    {
      name: "Neptune",
      el: [
        30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227,
        131.78422574,
      ],
      rate: [
        0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464,
        -0.00508664,
      ],
    },
  ];

  function solveKepler(M, e) {
    // M in radians; Newton–Raphson on E - e sinE = M
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 12; i++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-13) break;
    }
    return E;
  }

  // Heliocentric J2000-ecliptic position (AU) of a planet at Julian date jd.
  function planetPosition(planet, jd) {
    const T = (jd - 2451545.0) / 36525.0;
    const [a0, e0, I0, L0, w0, O0] = planet.el;
    const [ar, er, Ir, Lr, wr, Or] = planet.rate;
    const a = a0 + ar * T;
    const e = e0 + er * T;
    const I = (I0 + Ir * T) * DEG;
    const L = (L0 + Lr * T) * DEG;
    const wBar = (w0 + wr * T) * DEG; // longitude of perihelion
    const O = (O0 + Or * T) * DEG; // longitude of ascending node

    const w = wBar - O; // argument of perihelion
    let M = L - wBar;
    M = (((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

    const E = solveKepler(M, e);
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

    const cw = Math.cos(w),
      sw = Math.sin(w);
    const cO = Math.cos(O),
      sO = Math.sin(O);
    const cI = Math.cos(I),
      sI = Math.sin(I);

    return [
      (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      sw * sI * xp + cw * sI * yp,
    ];
  }

  // --- Moon: truncated ELP series (Meeus ch. 47) -------------------------------
  // Terms: [D, M, M', F, sumL (1e-6 deg), sumR (1e-3 km)]
  const MOON_LR = [
    [0, 0, 1, 0, 6288774, -20905355],
    [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968],
    [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888],
    [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158],
    [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733],
    [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620],
    [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755],
    [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0],
    [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782],
    [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636],
    [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824],
    [1, 0, -1, 0, -5163, -8379],
    [1, 1, 0, 0, 4987, -16675],
    [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445],
    [4, 0, 0, 0, 3861, -11650],
    [2, 0, -3, 0, 3665, 14403],
    [0, 1, -2, 0, -2689, -7003],
    [2, 0, -1, 2, -2602, 0],
    [2, -1, -2, 0, 2390, 10056],
    [1, 0, 1, 0, -2348, 6322],
    [2, -2, 0, 0, 2236, -9884],
  ];

  // Terms: [D, M, M', F, sumB (1e-6 deg)]
  const MOON_B = [
    [0, 0, 0, 1, 5128122],
    [0, 0, 1, 1, 280602],
    [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237],
    [2, 0, -1, 1, 55413],
    [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573],
    [0, 0, 2, 1, 17198],
    [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822],
    [2, -1, 0, -1, 8216],
    [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200],
    [2, 1, 0, -1, -3359],
    [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211],
    [2, -1, -1, -1, 2065],
    [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828],
    [0, 1, 0, 1, -1794],
    [0, 0, 0, 3, -1749],
    [0, 1, -1, 1, -1565],
    [1, 0, 0, 1, -1491],
    [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410],
    [0, 1, 0, -1, -1344],
    [1, 0, 0, -1, -1335],
    [0, 0, 3, 1, 1107],
  ];

  // Geocentric ecliptic position of the Moon at jd, returned in the J2000
  // ecliptic frame (AU).
  function moonGeocentric(jd) {
    const T = (jd - 2451545.0) / 36525.0;
    const Lp = (218.3164477 + 481267.88123421 * T - 0.0015786 * T * T) * DEG;
    const D = (297.8501921 + 445267.1114034 * T - 0.0018819 * T * T) * DEG;
    const M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T * T) * DEG;
    const Mp = (134.9633964 + 477198.8675055 * T + 0.0087414 * T * T) * DEG;
    const F = (93.272095 + 483202.0175233 * T - 0.0036539 * T * T) * DEG;
    const E = 1 - 0.002516 * T - 0.0000074 * T * T;

    let sumL = 0,
      sumR = 0,
      sumB = 0;
    for (const [d, m, mp, f, sl, sr] of MOON_LR) {
      const arg = d * D + m * M + mp * Mp + f * F;
      const eFac = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
      sumL += sl * eFac * Math.sin(arg);
      sumR += sr * eFac * Math.cos(arg);
    }
    for (const [d, m, mp, f, sb] of MOON_B) {
      const arg = d * D + m * M + mp * Mp + f * F;
      const eFac = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
      sumB += sb * eFac * Math.sin(arg);
    }
    // Additive corrections (Venus, Jupiter, flattening)
    const A1 = (119.75 + 131.849 * T) * DEG;
    const A2 = (53.09 + 479264.29 * T) * DEG;
    const A3 = (313.45 + 481266.484 * T) * DEG;
    sumL += 3958 * Math.sin(A1) + 1962 * Math.sin(Lp - F) + 318 * Math.sin(A2);
    sumB +=
      -2235 * Math.sin(Lp) +
      382 * Math.sin(A3) +
      175 * Math.sin(A1 - F) +
      175 * Math.sin(A1 + F) +
      127 * Math.sin(Lp - Mp) -
      115 * Math.sin(Lp + Mp);

    let lambda = Lp + (sumL / 1e6) * DEG; // ecliptic of date
    const beta = (sumB / 1e6) * DEG;
    const distAU = (385000.56 + sumR / 1000) / AU_KM;

    // Rotate ecliptic-of-date longitude back to J2000 (general precession)
    lambda -= (1.396971 * T + 0.0003086 * T * T) * DEG;

    const cb = Math.cos(beta);
    return [
      distAU * cb * Math.cos(lambda),
      distAU * cb * Math.sin(lambda),
      distAU * Math.sin(beta),
    ];
  }

  // Central-difference velocity (AU/day) of any position function of jd.
  function velocityOf(posFn, jd, h = 0.002) {
    const p1 = posFn(jd - h / 2);
    const p2 = posFn(jd + h / 2);
    return [(p2[0] - p1[0]) / h, (p2[1] - p1[1]) / h, (p2[2] - p1[2]) / h];
  }

  /*
   * Build the full N-body system state at Julian date jd0.
   * Returns { names, gm, pos, vel, jd0 } — pos/vel are arrays of [x,y,z]
   * in AU and AU/day, J2000 ecliptic, Sun initially at the origin
   * (total momentum is then removed so the barycenter stays put).
   */
  function buildSystem(jd0) {
    const names = ["Sun"];
    const gm = [GM_SUN];
    const pos = [[0, 0, 0]];
    const vel = [[0, 0, 0]];

    const moonFrac = 1 / (EARTH_MOON_MASS_RATIO + 1); // Moon share of EMB mass

    for (const planet of PLANET_ELEMENTS) {
      const p = planetPosition(planet, jd0);
      const v = velocityOf((t) => planetPosition(planet, t), jd0);
      if (planet.name === "EMB") {
        // Split the barycenter into Earth and Moon using the lunar ephemeris
        const geo = moonGeocentric(jd0);
        const geoV = velocityOf(moonGeocentric, jd0);
        const earthP = p.map((c, i) => c - geo[i] * moonFrac);
        const earthV = v.map((c, i) => c - geoV[i] * moonFrac);
        names.push("Earth");
        gm.push(GM_SUN / MASS_RATIO.Earth);
        pos.push(earthP);
        vel.push(earthV);
        names.push("Moon");
        gm.push(GM_SUN / MASS_RATIO.Earth / EARTH_MOON_MASS_RATIO);
        pos.push(earthP.map((c, i) => c + geo[i]));
        vel.push(earthV.map((c, i) => c + geoV[i]));
      } else {
        names.push(planet.name);
        gm.push(GM_SUN / MASS_RATIO[planet.name]);
        pos.push(p);
        vel.push(v);
      }
    }

    // Zero out total momentum so the system barycenter doesn't drift on screen
    const gmTot = gm.reduce((s, g) => s + g, 0);
    for (let k = 0; k < 3; k++) {
      let pTot = 0;
      for (let i = 0; i < gm.length; i++) pTot += gm[i] * vel[i][k];
      const vBary = pTot / gmTot;
      for (let i = 0; i < gm.length; i++) vel[i][k] -= vBary;
    }

    return { names, gm, pos, vel, jd0 };
  }

  // --- Calendar helpers --------------------------------------------------------
  function dateToJd(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function jdToDate(jd) {
    return new Date((jd - 2440587.5) * 86400000);
  }

  function jdToUTCString(jd) {
    const d = jdToDate(jd);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
    );
  }

  const Ephemeris = {
    AU_KM,
    GM_SUN,
    MASS_RATIO,
    EARTH_MOON_MASS_RATIO,
    R_SUN_KM,
    R_MOON_KM,
    R_EARTH_KM,
    planetPosition,
    moonGeocentric,
    buildSystem,
    dateToJd,
    jdToDate,
    jdToUTCString,
  };

  if (typeof module !== "undefined" && module.exports)
    module.exports = Ephemeris;
  if (typeof window !== "undefined") window.Ephemeris = Ephemeris;
})();

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
("use strict");

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
("use strict");

const AU_KM = 149597870.7;

const BODY_STYLE = {
  Sun: { varName: "--sun", fallback: "#ffd76e", r: 7.0, label: true },
  Mercury: { varName: "--mercury", fallback: "#b9a591", r: 2.2, label: true },
  Venus: { varName: "--venus", fallback: "#e8c97a", r: 3.2, label: true },
  Earth: { varName: "--earth", fallback: "#6db1ff", r: 3.4, label: true },
  Moon: { varName: "--moon", fallback: "#cfd4e2", r: 1.6, label: false },
  Mars: { varName: "--mars", fallback: "#e0764f", r: 2.8, label: true },
  Jupiter: { varName: "--jupiter", fallback: "#d9a96b", r: 5.5, label: true },
  Saturn: { varName: "--saturn", fallback: "#e3cf9b", r: 5.0, label: true },
  Uranus: { varName: "--uranus", fallback: "#9adbe8", r: 4.0, label: true },
  Neptune: { varName: "--neptune", fallback: "#7a96f0", r: 4.0, label: true },
};

function cssVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

class SolarSim {
  constructor(opts) {
    const Eph = window.Ephemeris;
    const Phy = window.Physics;
    this.Eph = Eph;
    this.Phy = Phy;

    this.orbitCanvas = opts.orbitCanvas;
    this.octx = this.orbitCanvas.getContext("2d");
    this.insetCanvas = opts.insetCanvas || null;
    this.ictx = this.insetCanvas ? this.insetCanvas.getContext("2d") : null;

    this.ambient = !!opts.ambient;
    this.onTick = opts.onTick || null;
    this.onEclipse = opts.onEclipse || null;

    this.startDate = opts.startDate || new Date();
    this.jd0 = Eph.dateToJd(this.startDate);
    this.scaleAU = opts.scaleAU || 1.8;
    this.stepsPerFrame = opts.stepsPerFrame || 8;
    this.dt = 1 / 96; // 15-minute timestep, fixed

    this._reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this._build();

    this.playing = false;
    this.jumping = false;
    this.hover = null; // hovered body index
    this.pinned = null; // pinned body index
    this._screen = []; // last-drawn [x,y] (backing px) per body index
    this._bloom = null; // active corona-bloom state {t}
    this._grain = null; // cached film-grain tile
    this.onBloom = opts.onBloom || null;
    this._raf = null;
    this._resize = this._resize.bind(this);
    this._loop = this._loop.bind(this);
    window.addEventListener("resize", this._resize);
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
    this.hover = null;
    this.pinned = null;
    this._bloom = null;
    this._build();
    this._drawOrbit();
    if (this.ictx) this._drawInset();
  }
  reseedToNow() {
    this.reseedTo(new Date());
  }

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

  play() {
    if (!this.playing) {
      this.playing = true;
      if (!this._raf) this._raf = requestAnimationFrame(this._loop);
    }
  }
  pause() {
    this.playing = false;
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
  setScale(au) {
    this.scaleAU = au;
    this.trails.forEach((t) => (t.length = 0));
    this._drawOrbit();
  }
  setStepsPerFrame(n) {
    this.stepsPerFrame = Math.max(1, n | 0);
  }
  render() {
    this._drawOrbit();
    if (this.ictx) this._drawInset();
  }

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
    const sun = s.body(s.idx.sun),
      earth = s.body(s.idx.earth),
      moon = s.body(s.idx.moon);
    const a = [sun[0] - earth[0], sun[1] - earth[1], sun[2] - earth[2]];
    const b = [moon[0] - earth[0], moon[1] - earth[1], moon[2] - earth[2]];
    const na = Math.hypot(...a),
      nb = Math.hypot(...b);
    const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
    const sepDeg = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
    const g = this.Phy.solarEclipseGeometry(sun, earth, moon);
    return {
      sepDeg,
      axisMissKm: g ? Math.round(g.dperp * AU_KM) : null,
      type: g ? g.type : null,
    };
  }

  // --- heliocentric orbit view ------------------------------------------------
  _drawOrbit() {
    const ctx = this.octx,
      W = this.orbitCanvas.width,
      H = this.orbitCanvas.height;
    const dpr = this._dpr || 1;
    const bg = cssVar("--sim-bg", "#06080f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // faint cool vignette so deep space never reads as flat CSS black.
    // Themeable: set --sim-vignette:none to drop it entirely (light hosts), or
    // override the three stops. Dark defaults are unchanged.
    if (cssVar("--sim-vignette", "") !== "none") {
      const vg = ctx.createRadialGradient(
        W * 0.5,
        H * 0.46,
        0,
        W * 0.5,
        H * 0.46,
        Math.hypot(W, H) * 0.6,
      );
      vg.addColorStop(0, cssVar("--sim-vignette-0", "rgba(28,38,66,0.16)"));
      vg.addColorStop(0.55, cssVar("--sim-vignette-1", "rgba(12,17,32,0.05)"));
      vg.addColorStop(1, cssVar("--sim-vignette-2", "rgba(2,3,8,0.55)"));
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    // deterministic multi-depth starfield (3 tiers: far/dim → near/bright)
    const starCol = cssVar("--star", "rgba(233,230,221,0.85)");
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const tiers = [
      { n: (W * H) / (5200 * dpr), size: dpr, a: [0.1, 0.28] },
      { n: (W * H) / (13000 * dpr), size: dpr * 1.5, a: [0.3, 0.62] },
      { n: (W * H) / (52000 * dpr), size: dpr * 2.2, a: [0.65, 0.95] },
    ];
    ctx.fillStyle = starCol;
    for (const t of tiers) {
      for (let i = 0; i < t.n; i++) {
        const x = rnd() * W,
          y = rnd() * H,
          tw = rnd();
        ctx.globalAlpha = t.a[0] + tw * (t.a[1] - t.a[0]);
        ctx.fillRect(x, y, t.size, t.size);
      }
    }
    ctx.globalAlpha = 1;

    const cx = W / 2,
      cy = H / 2;
    const scale = Math.min(W, H) / (2.15 * this.scaleAU);
    const s = this.sim;
    const sunP = s.body(s.idx.sun);
    const toScreen = (p) => [
      cx + (p[0] - sunP[0]) * scale,
      cy - (p[1] - sunP[1]) * scale,
    ];
    this._sunScreen = toScreen(sunP);
    this._screen = new Array(s.n).fill(null);

    for (let i = 0; i < s.n; i++) {
      const name = s.names[i];
      const st = BODY_STYLE[name];
      if (!st) continue;
      if (name === "Moon" && this.scaleAU > 3) continue;
      const color = cssVar(st.varName, st.fallback);

      const t = this.trails[i];
      if (t.length > 2 && name !== "Sun") {
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
      if (name === "Sun") {
        const rad = 30 * dpr;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
        g.addColorStop(0, cssVar("--sun-core", "#fff3c4"));
        g.addColorStop(0.3, color);
        g.addColorStop(1, this._hexA(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, st.r * dpr, 0, 7);
      ctx.fill();
      if (st.label && !this.ambient) {
        ctx.fillStyle = cssVar("--sim-label", "rgba(221,227,242,0.55)");
        ctx.font = `${10.5 * dpr}px ${cssVar("--mono-stack", "ui-monospace, monospace")}`;
        ctx.fillText(name, sx + 8 * dpr, sy - 6 * dpr);
      }
    }

    // crosshair on hovered / pinned body (interactive instrument only)
    if (!this.ambient) {
      const accent = cssVar("--accent", "#D9A441");
      for (const idx of [this.pinned, this.hover]) {
        if (idx == null || !this._screen[idx]) continue;
        const [hx, hy] = this._screen[idx];
        const rr = 13 * dpr;
        ctx.strokeStyle = this._hexA(accent, idx === this.pinned ? 0.95 : 0.6);
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.arc(hx, hy, rr, 0, 7);
        ctx.stroke();
        for (const [ax, ay] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          ctx.beginPath();
          ctx.moveTo(hx + ax * rr, hy + ay * rr);
          ctx.lineTo(hx + ax * (rr + 6 * dpr), hy + ay * (rr + 6 * dpr));
          ctx.stroke();
        }
      }
    }

    // corona bloom — the one permitted flourish, fired from a real totality
    if (this._bloom && this._sunScreen) {
      const b = this._bloom;
      b.t += 1;
      const DUR = 60;
      const p = b.t / DUR;
      const [bx, by] = this._sunScreen;
      const ease = 1 - Math.pow(1 - Math.min(p, 1), 3);
      const maxR = Math.min(W, H) * 0.46;
      // expanding thin ring
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const ringR = ease * maxR;
      ctx.strokeStyle = this._hexA(cssVar("--sun", "#FFD76E"), (1 - p) * 0.9);
      ctx.lineWidth = (1 - p) * 3 * dpr + 0.5 * dpr;
      ctx.beginPath();
      ctx.arc(bx, by, ringR, 0, 7);
      ctx.stroke();
      // central corona bloom
      const cr = (18 + ease * 34) * dpr;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, cr);
      g.addColorStop(
        0,
        this._hexA(cssVar("--sun-core", "#FFF3C4"), (1 - p) * 0.85),
      );
      g.addColorStop(
        0.4,
        this._hexA(cssVar("--sun", "#FFD76E"), (1 - p) * 0.4),
      );
      g.addColorStop(1, this._hexA(cssVar("--sun", "#FFD76E"), 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, cr, 0, 7);
      ctx.fill();
      // the diamond-ring point — brightest early, fixed on the corona edge
      if (p < 0.55) {
        const dr = (16 + ease * 20) * dpr;
        const px = bx + Math.cos(-0.6) * dr,
          py = by + Math.sin(-0.6) * dr;
        const dg = ctx.createRadialGradient(px, py, 0, px, py, 7 * dpr);
        dg.addColorStop(0, this._hexA("#FFFFFF", (0.55 - p) * 1.8));
        dg.addColorStop(1, this._hexA("#FFFFFF", 0));
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.arc(px, py, 7 * dpr, 0, 7);
        ctx.fill();
      }
      ctx.restore();
      if (b.t >= DUR) this._bloom = null;
    }

    // barely-there film grain so gradients never band on deep black
    const grain = this._grainTile();
    if (grain) {
      const pat = ctx.createPattern(grain, "repeat");
      if (pat) {
        ctx.globalAlpha = 0.035;
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }
  }

  _grainTile() {
    if (this._grain) return this._grain;
    const size = 96;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
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
    const px = cssX * dpr,
      py = cssY * dpr;
    let best = null,
      bestD = (24 * dpr) ** 2;
    for (let i = 0; i < (this._screen ? this._screen.length : 0); i++) {
      const sc = this._screen[i];
      if (!sc) continue;
      const d = (sc[0] - px) ** 2 + (sc[1] - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  bodyTelemetry(i) {
    if (i == null) return null;
    const s = this.sim;
    const p = s.body(i),
      sun = s.body(s.idx.sun);
    const distAU = Math.hypot(p[0] - sun[0], p[1] - sun[1], p[2] - sun[2]);
    const vx = s.vel[3 * i],
      vy = s.vel[3 * i + 1],
      vz = s.vel[3 * i + 2];
    const speedKmS = (Math.hypot(vx, vy, vz) * AU_KM) / 86400;
    return { name: s.names[i], distAU, speedKmS };
  }

  pointerMove(cssX, cssY) {
    this.hover = this.hitTest(cssX, cssY);
    return this.bodyTelemetry(this.hover);
  }
  pointerLeave() {
    this.hover = null;
  }
  pointerClick(cssX, cssY) {
    const hit = this.hitTest(cssX, cssY);
    this.pinned = hit != null && hit === this.pinned ? null : hit;
    return this.bodyTelemetry(this.pinned);
  }

  // --- Earth–Moon shadow inset ------------------------------------------------
  _drawInset() {
    const ctx = this.ictx,
      W = this.insetCanvas.width,
      H = this.insetCanvas.height;
    const dpr = this._dpr || 1;
    ctx.fillStyle = cssVar("--inset-bg", "#080b15");
    ctx.fillRect(0, 0, W, H);
    const s = this.sim;
    const earth = s.body(s.idx.earth),
      moon = s.body(s.idx.moon),
      sun = s.body(s.idx.sun);
    const cx = W / 2,
      cy = H / 2;
    const scale = (Math.min(W, H) / 2 - 16 * dpr) / 0.0028;
    const sd = [sun[0] - earth[0], sun[1] - earth[1]];
    const ang = Math.atan2(sd[1], sd[0]);
    const rot = (p) => {
      const dx = p[0] - earth[0],
        dy = p[1] - earth[1];
      const x = dx * Math.cos(-ang) - dy * Math.sin(-ang);
      const y = dx * Math.sin(-ang) + dy * Math.cos(-ang);
      return [cx - x * scale, cy + y * scale];
    };

    // sunlight rays from the left
    ctx.strokeStyle = this._hexA(cssVar("--sun", "#ffd76e"), 0.3);
    ctx.lineWidth = dpr;
    for (let i = 0; i < 4; i++) {
      const y = (H / 5) * (i + 1);
      ctx.beginPath();
      ctx.moveTo(6 * dpr, y);
      ctx.lineTo(26 * dpr, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(26 * dpr, y);
      ctx.lineTo(20 * dpr, y - 3 * dpr);
      ctx.moveTo(26 * dpr, y);
      ctx.lineTo(20 * dpr, y + 3 * dpr);
      ctx.stroke();
    }

    const g = this.Phy.solarEclipseGeometry(sun, earth, moon);
    const geo = this._geometry();
    const [ex, ey] = rot(earth);
    const [mx, my] = rot(moon);

    if (geo.sepDeg < 25) {
      const coneLen = Math.min(W, 90 * dpr);
      ctx.fillStyle = g
        ? this._hexA(cssVar("--accent", "#e8a33d"), 0.3)
        : this._hexA(cssVar("--partial", "#9a8fd1"), 0.14);
      ctx.beginPath();
      ctx.moveTo(mx, my - 2 * dpr);
      ctx.lineTo(mx + coneLen, my - 9 * dpr);
      ctx.lineTo(mx + coneLen, my + 9 * dpr);
      ctx.lineTo(mx, my + 2 * dpr);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = this._hexA(cssVar("--moon", "#cfd4e2"), 0.22);
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(ex, ey, Math.hypot(mx - ex, my - ey), 0, 7);
    ctx.stroke();

    ctx.fillStyle = cssVar("--earth", "#6db1ff");
    ctx.beginPath();
    ctx.arc(ex, ey, 6 * dpr, 0, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.arc(ex, ey, 6 * dpr, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    ctx.fillStyle = g
      ? cssVar("--accent", "#e8a33d")
      : cssVar("--moon", "#cfd4e2");
    ctx.beginPath();
    ctx.arc(mx, my, 2.6 * dpr, 0, 7);
    ctx.fill();
  }

  _hexA(hex, a) {
    hex = (hex || "").trim();
    if (hex.startsWith("rgb"))
      return hex.replace(/rgba?\(([^)]+)\)/, (m, p) => {
        const parts = p
          .split(",")
          .map((x) => x.trim())
          .slice(0, 3);
        return `rgba(${parts.join(",")},${a})`;
      });
    let h = hex.replace("#", "");
    if (h.length === 3)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  destroy() {
    this.pause();
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._resize);
  }
}

if (typeof window !== "undefined") window.SolarSim = SolarSim;

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
("use strict");
(function () {
  function mount(opts) {
    opts = opts || {};
    const host = opts.container || document.body;
    const fullBleed = host === document.body || opts.fullBleed;

    const wrap = document.createElement("div");
    wrap.className = "solar-bg-layer";
    Object.assign(wrap.style, {
      position: fullBleed ? "fixed" : "absolute",
      inset: "0",
      zIndex:
        opts.zIndex != null ? String(opts.zIndex) : fullBleed ? "-1" : "0",
      pointerEvents: "none",
      opacity: String(opts.opacity != null ? opts.opacity : 0.4),
      overflow: "hidden",
    });
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      width: "100%",
      height: "100%",
      display: "block",
    });
    wrap.appendChild(canvas);

    if (fullBleed) {
      document.body.insertBefore(wrap, document.body.firstChild);
    } else {
      const cs = getComputedStyle(host);
      if (cs.position === "static") host.style.position = "relative";
      host.insertBefore(wrap, host.firstChild);
    }

    const reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          onScreen = e.isIntersecting;
          if (!reduce) {
            onScreen ? sim.play() : sim.pause();
          }
        }
      },
      { threshold: 0 },
    );
    io.observe(wrap);
    document.addEventListener("visibilitychange", () => {
      if (reduce) return;
      if (document.hidden) sim.pause();
      else if (onScreen) sim.play();
    });

    return {
      sim,
      element: wrap,
      destroy() {
        sim.destroy();
        io.disconnect();
        wrap.remove();
      },
    };
  }

  function autoInit() {
    document.querySelectorAll("[data-solar-background]").forEach((el) => {
      const isBody = el === document.body;
      mount({
        container: isBody ? document.body : el,
        fullBleed: isBody,
        scaleAU: parseFloat(el.dataset.scale) || 1.9,
        opacity:
          el.dataset.opacity != null ? parseFloat(el.dataset.opacity) : 0.4,
        stepsPerFrame: parseInt(el.dataset.speed) || 5,
      });
    });
  }

  window.SolarBackground = { mount, autoInit };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
})();
