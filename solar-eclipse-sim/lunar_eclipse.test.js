"use strict";
/*
 * lunar_eclipse.test.js — behaviour tests for first-principles lunar-eclipse
 * detection. Run with: node --test solar-eclipse-sim/lunar_eclipse.test.js
 *
 * Two layers:
 *   1. lunarEclipseGeometry() classification, using synthetic Sun/Earth/Moon
 *      positions placed by hand at known perpendicular distances from Earth's
 *      shadow axis — proves total / partial / penumbral / miss are told apart.
 *   2. End-to-end: integrate the real 10-body system 5 years from a single
 *      seed and require every in-horizon NASA umbral lunar eclipse to be
 *      predicted with the correct type — zero umbral missed, zero spurious
 *      umbral — sharing the ONE integration loop the solar path already uses.
 */
const test = require("node:test");
const assert = require("node:assert");

const Eph = require("./ephemeris.js");
const Physics = require("./physics.js");
const { NBodySimulation, EclipseDetector, lunarEclipseGeometry } = Physics;

const AU = Eph.AU_KM;

// --- Layer 1: classification from geometry alone -----------------------------
// Earth at 1 AU on the +x axis; Sun at origin; Moon one lunar distance beyond
// Earth along the axis, offset perpendicularly by `dperpKm`. From the numbers
// in physics.js the umbra radius at the Moon is ~4606 km and the penumbra
// ~8183 km; the Moon's own radius is ~1737 km, so the regime boundaries are:
//   total   : dperp <~ 2869 km
//   partial : 2869 km <~ dperp <~ 6344 km
//   penumbral: 6344 km <~ dperp <~ 9920 km
//   miss    : dperp >~ 9920 km
// The chosen sample points sit comfortably inside each regime.
const MOON_DIST_KM = 384400;
function scene(dperpKm) {
  const sun = [0, 0, 0];
  const earth = [1, 0, 0];
  const moon = [1 + MOON_DIST_KM / AU, dperpKm / AU, 0];
  return lunarEclipseGeometry(sun, earth, moon);
}

test("lunarEclipseGeometry is exported as a function", () => {
  assert.strictEqual(
    typeof lunarEclipseGeometry,
    "function",
    `expected Physics.lunarEclipseGeometry to be a function, got ${typeof lunarEclipseGeometry}`,
  );
});

test("Moon deep on the shadow axis classifies as total", () => {
  const g = scene(1000);
  assert.ok(g, "expected an eclipse geometry object, got null");
  assert.strictEqual(
    g.type,
    "total",
    `dperp=1000 km should be total, got ${g && g.type}`,
  );
});

test("Moon straddling the umbra edge classifies as partial", () => {
  const g = scene(4500);
  assert.ok(g, "expected an eclipse geometry object, got null");
  assert.strictEqual(
    g.type,
    "partial",
    `dperp=4500 km should be partial, got ${g && g.type}`,
  );
});

test("Moon in the penumbra only classifies as penumbral", () => {
  const g = scene(8000);
  assert.ok(g, "expected an eclipse geometry object, got null");
  assert.strictEqual(
    g.type,
    "penumbral",
    `dperp=8000 km should be penumbral, got ${g && g.type}`,
  );
});

test("Moon clear of the penumbra is not an eclipse (null)", () => {
  const g = scene(12000);
  assert.strictEqual(
    g,
    null,
    `dperp=12000 km should miss the shadow entirely, got ${JSON.stringify(g)}`,
  );
});

test("Moon on the sunward side of Earth casts no shadow on it (null)", () => {
  const sun = [0, 0, 0];
  const earth = [1, 0, 0];
  const moon = [1 - MOON_DIST_KM / AU, 0, 0]; // between Sun and Earth
  const g = lunarEclipseGeometry(sun, earth, moon);
  assert.strictEqual(
    g,
    null,
    `Moon toward the Sun cannot be in Earth's shadow, got ${JSON.stringify(g)}`,
  );
});

// --- Layer 2: end-to-end against the NASA umbral catalog ---------------------
// The seven umbral lunar eclipses inside the supported 5-year window from
// 2024-01-01 (NASA / Espenak, greatest-eclipse UT date & umbral type).
const UMBRAL = [
  ["2024-09-18", "partial"],
  ["2025-03-14", "total"],
  ["2025-09-07", "total"],
  ["2026-03-03", "total"],
  ["2026-08-28", "partial"],
  ["2028-01-12", "partial"],
  ["2028-07-06", "partial"],
];
// Penumbral-only rows: never graded, but a detection near one is not spurious.
const PENUMBRAL = ["2024-03-25", "2027-02-20", "2027-07-18", "2027-08-17"];

test("5-year integration matches every in-horizon NASA umbral lunar eclipse", () => {
  const jd0 = Eph.dateToJd(new Date("2024-01-01T00:00:00Z"));
  const years = 5;
  const dt = 1 / 96;
  const steps = Math.round((years * 365.25) / dt);
  const horizonEnd = jd0 + years * 365.25;

  const sim = new NBodySimulation(jd0);
  const det = new EclipseDetector();
  const solarBefore = det.events.length;
  for (let i = 0; i < steps; i++) {
    sim.step(dt);
    det.sample(sim);
  }

  const lunar = det.lunarEvents;
  assert.ok(
    Array.isArray(lunar),
    "EclipseDetector must expose a lunarEvents array",
  );

  // The single loop must still produce the solar events too (shared pass).
  assert.ok(
    det.events.length > solarBefore,
    "solar events must still be detected in the same integration loop",
  );

  const cJd = (d) => Eph.dateToJd(new Date(d + "T12:00:00Z"));

  let matched = 0,
    typeOk = 0,
    missed = 0,
    maxErrH = 0;
  for (const [date, type] of UMBRAL) {
    const j = cJd(date);
    if (j < jd0 || j > horizonEnd) continue; // horizon filter, like the solar path
    const hit = lunar.find((p) => Math.abs(p.jd - j) < 1.5);
    if (hit) {
      matched++;
      maxErrH = Math.max(maxErrH, Math.abs((hit.jd - j) * 24));
      if (hit.type === type) typeOk++;
      else assert.fail(`${date}: expected type ${type}, detected ${hit.type}`);
    } else {
      missed++;
      assert.fail(
        `${date} ${type}: no umbral lunar eclipse detected within ±1.5 d`,
      );
    }
  }

  const inHorizonUmbral = UMBRAL.filter(
    ([d]) => cJd(d) >= jd0 && cJd(d) <= horizonEnd,
  ).length;
  assert.strictEqual(
    inHorizonUmbral,
    7,
    `expected 7 in-horizon umbral rows, got ${inHorizonUmbral}`,
  );
  assert.strictEqual(matched, 7, `expected 7 umbral matched, got ${matched}`);
  assert.strictEqual(
    typeOk,
    7,
    `expected 7 correct umbral types, got ${typeOk}`,
  );
  assert.strictEqual(missed, 0, `expected 0 umbral missed, got ${missed}`);
  assert.ok(
    maxErrH < 36,
    `umbral timing error should be < 36 h, got ${maxErrH.toFixed(1)} h`,
  );

  // No spurious UMBRAL detection: every detected total/partial event must sit
  // within ±1.5 d of a catalog row (umbral OR penumbral). Penumbral detections
  // are never spurious and never graded.
  const allCatJd = [...UMBRAL.map(([d]) => d), ...PENUMBRAL].map(cJd);
  const spuriousUmbral = lunar.filter(
    (p) =>
      (p.type === "total" || p.type === "partial") &&
      !allCatJd.some((cj) => Math.abs(cj - p.jd) < 1.5),
  );
  assert.strictEqual(
    spuriousUmbral.length,
    0,
    `expected 0 spurious umbral detections, got ${spuriousUmbral.length}: ` +
      spuriousUmbral.map((p) => Eph.jdToUTCString(p.jd)).join(", "),
  );
});

test("lunar tracking never clobbers an overlapping solar event slot", () => {
  // A solar and a lunar eclipse fall in the same fortnight (2024-09 pair).
  // Detecting the lunar event must not drop the solar one, so both arrays grow.
  const jd0 = Eph.dateToJd(new Date("2024-01-01T00:00:00Z"));
  const dt = 1 / 96;
  const steps = Math.round((5 * 365.25) / dt);
  const sim = new NBodySimulation(jd0);
  const det = new EclipseDetector();
  for (let i = 0; i < steps; i++) {
    sim.step(dt);
    det.sample(sim);
  }
  assert.ok(
    det.events.length >= 10,
    `expected >=10 solar events, got ${det.events.length}`,
  );
  assert.ok(
    det.lunarEvents.length >= 7,
    `expected >=7 lunar events, got ${det.lunarEvents.length}`,
  );
});
