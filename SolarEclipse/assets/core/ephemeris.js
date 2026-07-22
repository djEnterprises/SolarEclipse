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
'use strict';

(function () {

const AU_KM = 149597870.7;
const DEG = Math.PI / 180;

// Gaussian gravitational constant → GM_sun in AU^3/day^2
const GM_SUN = 0.01720209895 * 0.01720209895;

// Sun/body mass ratios (IAU/DE values)
const MASS_RATIO = {
  Mercury: 6023600,
  Venus: 408523.71,
  Earth: 332946.0487,   // Earth alone
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
  { name: 'Mercury',
    el:   [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  { name: 'Venus',
    el:   [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
  { name: 'EMB',
    el:   [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  { name: 'Mars',
    el:   [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  { name: 'Jupiter',
    el:   [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  { name: 'Saturn',
    el:   [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  { name: 'Uranus',
    el:   [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  { name: 'Neptune',
    el:   [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
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
  const wBar = (w0 + wr * T) * DEG;   // longitude of perihelion
  const O = (O0 + Or * T) * DEG;      // longitude of ascending node

  const w = wBar - O;                  // argument of perihelion
  let M = L - wBar;
  M = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(w), sw = Math.sin(w);
  const cO = Math.cos(O), sO = Math.sin(O);
  const cI = Math.cos(I), sI = Math.sin(I);

  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    (sw * sI) * xp + (cw * sI) * yp,
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
  const F = (93.2720950 + 483202.0175233 * T - 0.0036539 * T * T) * DEG;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  let sumL = 0, sumR = 0, sumB = 0;
  for (const [d, m, mp, f, sl, sr] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const eFac = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sumL += sl * eFac * Math.sin(arg);
    sumR += sr * eFac * Math.cos(arg);
  }
  for (const [d, m, mp, f, sb] of MOON_B) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const eFac = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sumB += sb * eFac * Math.sin(arg);
  }
  // Additive corrections (Venus, Jupiter, flattening)
  const A1 = (119.75 + 131.849 * T) * DEG;
  const A2 = (53.09 + 479264.290 * T) * DEG;
  const A3 = (313.45 + 481266.484 * T) * DEG;
  sumL += 3958 * Math.sin(A1) + 1962 * Math.sin(Lp - F) + 318 * Math.sin(A2);
  sumB += -2235 * Math.sin(Lp) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F)
        + 175 * Math.sin(A1 + F) + 127 * Math.sin(Lp - Mp) - 115 * Math.sin(Lp + Mp);

  let lambda = Lp + (sumL / 1e6) * DEG;     // ecliptic of date
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
  const names = ['Sun'];
  const gm = [GM_SUN];
  const pos = [[0, 0, 0]];
  const vel = [[0, 0, 0]];

  const moonFrac = 1 / (EARTH_MOON_MASS_RATIO + 1); // Moon share of EMB mass

  for (const planet of PLANET_ELEMENTS) {
    const p = planetPosition(planet, jd0);
    const v = velocityOf((t) => planetPosition(planet, t), jd0);
    if (planet.name === 'EMB') {
      // Split the barycenter into Earth and Moon using the lunar ephemeris
      const geo = moonGeocentric(jd0);
      const geoV = velocityOf(moonGeocentric, jd0);
      const earthP = p.map((c, i) => c - geo[i] * moonFrac);
      const earthV = v.map((c, i) => c - geoV[i] * moonFrac);
      names.push('Earth');
      gm.push(GM_SUN / MASS_RATIO.Earth);
      pos.push(earthP);
      vel.push(earthV);
      names.push('Moon');
      gm.push((GM_SUN / MASS_RATIO.Earth) / EARTH_MOON_MASS_RATIO);
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
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const Ephemeris = {
  AU_KM, GM_SUN, MASS_RATIO, EARTH_MOON_MASS_RATIO,
  R_SUN_KM, R_MOON_KM, R_EARTH_KM,
  planetPosition, moonGeocentric, buildSystem,
  dateToJd, jdToDate, jdToUTCString,
};

if (typeof module !== 'undefined' && module.exports) module.exports = Ephemeris;
if (typeof window !== 'undefined') window.Ephemeris = Ephemeris;

})();
