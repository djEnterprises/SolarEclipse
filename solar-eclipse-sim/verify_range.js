#!/usr/bin/env node
/*
 * verify_range.js — wide-baseline accuracy audit of the N-body core.
 *
 * Integrates a full decade from a single seed epoch and scores every solar
 * eclipse the bare physics produces against the published NASA five-
 * millennium catalog (Espenak/Meeus). Reports match rate, type accuracy,
 * timing error growth, and energy conservation.
 *
 *   node verify_range.js [startDate] [years]
 */
"use strict";

const Eph = require("./ephemeris.js");
const { NBodySimulation, EclipseDetector } = require("./physics.js");

// NASA solar-eclipse canon, 2021–2030 (UT calendar date of greatest eclipse).
// hybrid = total/annular transition; our classifier reports whichever the
// shadow axis yields at greatest eclipse, which we accept as correct.
const CATALOG = [
  ["2021-06-10", "annular"],
  ["2021-12-04", "total"],
  ["2022-04-30", "partial"],
  ["2022-10-25", "partial"],
  ["2023-04-20", "hybrid"],
  ["2023-10-14", "annular"],
  ["2024-04-08", "total"],
  ["2024-10-02", "annular"],
  ["2025-03-29", "partial"],
  ["2025-09-21", "partial"],
  ["2026-02-17", "annular"],
  ["2026-08-12", "total"],
  ["2027-02-06", "annular"],
  ["2027-08-02", "total"],
  ["2028-01-26", "annular"],
  ["2028-07-22", "total"],
  ["2029-01-14", "partial"],
  ["2029-06-12", "partial"],
  ["2029-07-11", "partial"],
  ["2029-12-05", "partial"],
  ["2030-06-01", "annular"],
  ["2030-11-25", "total"],
];

// NASA lunar-eclipse canon, 2024–2028 (UT calendar date of greatest eclipse,
// umbral type). Umbral rows (total/partial) are GRADED and gate CI; penumbral-
// only rows are photometrically subtle, may sit at/beyond a 15-min-step shadow-
// cone test's resolution, and are documented-not-graded (never fail CI, and a
// detection within ±1.5 d of one is classified penumbral, not spurious).
const LUNAR_CATALOG = [
  ["2024-03-25", "penumbral"],
  ["2024-09-18", "partial"],
  ["2025-03-14", "total"],
  ["2025-09-07", "total"],
  ["2026-03-03", "total"],
  ["2026-08-28", "partial"],
  ["2027-02-20", "penumbral"],
  ["2027-07-18", "penumbral"],
  ["2027-08-17", "penumbral"],
  ["2028-01-12", "partial"],
  ["2028-07-06", "partial"],
  // Horizon boundary: 2028-12-31 12:00 UT falls just past jd0 + years·365.25
  // for the seed 2024-01-01, 5 years — the horizon filter governs it, exactly
  // as with the solar path; not counted unless the window reaches it.
  ["2028-12-31", "total"],
];
const UMBRAL_TYPES = new Set(["total", "partial"]);

const startArg = process.argv[2] || "2021-01-01";
const years = parseFloat(process.argv[3] || "10");
const jd0 = Eph.dateToJd(new Date(startArg + "T00:00:00Z"));
const dt = 1 / 96;
const steps = Math.round((years * 365.25) / dt);

console.log("═".repeat(74));
console.log(
  `  WIDE-BASELINE ACCURACY AUDIT — seed ${startArg}, ${years}-year integration`,
);
console.log("═".repeat(74));

const sim = new NBodySimulation(jd0);
const det = new EclipseDetector();
const predicted = [];
const t0 = Date.now();
for (let i = 0; i < steps; i++) {
  sim.step(dt);
  const ev = det.sample(sim);
  if (ev) predicted.push(ev);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

let matched = 0,
  typeOk = 0,
  missed = 0;
let maxErrH = 0,
  sumErrH = 0;
const horizonEnd = jd0 + years * 365.25;
const typeEquiv = (sim, cat) =>
  sim === cat || (cat === "hybrid" && (sim === "total" || sim === "annular"));

for (const [date, type] of CATALOG) {
  const cJd = Eph.dateToJd(new Date(date + "T12:00:00Z"));
  if (cJd < jd0 || cJd > horizonEnd) continue;
  const hit = predicted.find((p) => Math.abs(p.jd - cJd) < 1.5);
  if (hit) {
    matched++;
    const errH = Math.abs((hit.jd - cJd) * 24);
    maxErrH = Math.max(maxErrH, errH);
    sumErrH += errH;
    const tok = typeEquiv(hit.type, type);
    if (tok) typeOk++;
    console.log(
      `  ✓ ${date} ${type.padEnd(8)} → ${hit.type.padEnd(8)} ${tok ? "" : "⚠ type"} `,
    );
  } else {
    missed++;
    console.log(`  ✗ ${date} ${type.padEnd(8)} — NOT predicted`);
  }
}
const inHorizon = CATALOG.filter(([d]) => {
  const j = Eph.dateToJd(new Date(d + "T12:00:00Z"));
  return j >= jd0 && j <= horizonEnd;
}).length;
const spurious = predicted.filter(
  (p) =>
    !CATALOG.some(
      ([d]) => Math.abs(Eph.dateToJd(new Date(d + "T12:00:00Z")) - p.jd) < 1.5,
    ),
);

console.log("─".repeat(74));
console.log(`  Catalog eclipses in horizon : ${inHorizon}`);
console.log(
  `  Predicted (matched)         : ${matched}   (${missed} missed, ${spurious.length} spurious)`,
);
console.log(`  Correct type                : ${typeOk}/${matched}`);
console.log(
  `  Timing error vs catalog     : mean ${(sumErrH / matched).toFixed(1)} h, max ${maxErrH.toFixed(1)} h`,
);
console.log(
  `  Energy drift (relative)     : ${sim.energyDrift().toExponential(2)}`,
);
console.log(
  `  Compute time                : ${secs} s for ${steps.toLocaleString()} steps`,
);
console.log("═".repeat(74));

// --- Lunar section -----------------------------------------------------------
// Same convention as the solar path: compare each catalog row at 12:00 UT to
// the deepest predicted event within ±1.5 d, over the same horizon window and
// the SAME single integration loop (det.lunarEvents was filled above).
console.log("");
console.log(
  "  LUNAR ECLIPSES — Earth's shadow on the Moon (same integration loop)",
);
console.log("─".repeat(74));

const lunarPredicted = det.lunarEvents;
let lMatched = 0,
  lTypeOk = 0,
  lUmbralMissed = 0;
let lMaxErrH = 0,
  lSumErrH = 0;

for (const [date, type] of LUNAR_CATALOG) {
  const cJd = Eph.dateToJd(new Date(date + "T12:00:00Z"));
  if (cJd < jd0 || cJd > horizonEnd) continue;
  const graded = UMBRAL_TYPES.has(type);
  const hit = lunarPredicted.find((p) => Math.abs(p.jd - cJd) < 1.5);
  const tag = graded ? "umbral    " : "penumbral*";
  if (hit) {
    const errH = Math.abs((hit.jd - cJd) * 24);
    if (graded) {
      lMatched++;
      lMaxErrH = Math.max(lMaxErrH, errH);
      lSumErrH += errH;
      const tok = hit.type === type;
      if (tok) lTypeOk++;
      console.log(
        `  ✓ ${date} ${tag} ${type.padEnd(9)} → ${hit.type.padEnd(9)} ${tok ? "" : "⚠ type"}`,
      );
    } else {
      console.log(
        `  · ${date} ${tag} ${type.padEnd(9)} → ${hit.type.padEnd(9)} (documented, not graded)`,
      );
    }
  } else if (graded) {
    lUmbralMissed++;
    console.log(`  ✗ ${date} ${tag} ${type.padEnd(9)} — NOT predicted`);
  } else {
    console.log(
      `  · ${date} ${tag} ${type.padEnd(9)} — not detected (documented, not graded)`,
    );
  }
}

const lunarInHorizon = LUNAR_CATALOG.filter(([d, t]) => {
  const j = Eph.dateToJd(new Date(d + "T12:00:00Z"));
  return UMBRAL_TYPES.has(t) && j >= jd0 && j <= horizonEnd;
}).length;

// Spurious: a predicted lunar event with no catalog row (umbral OR penumbral)
// within ±1.5 d. Only umbral-typed spurious detections gate CI; a stray
// penumbral grazing detection is reported but never fails (honesty clause).
const lunarSpurious = lunarPredicted.filter(
  (p) =>
    !LUNAR_CATALOG.some(
      ([d]) => Math.abs(Eph.dateToJd(new Date(d + "T12:00:00Z")) - p.jd) < 1.5,
    ),
);
const spuriousUmbral = lunarSpurious.filter((p) => UMBRAL_TYPES.has(p.type));

console.log("─".repeat(74));
console.log(`  Umbral catalog in horizon   : ${lunarInHorizon}`);
console.log(
  `  Umbral predicted (matched)  : ${lMatched}   (${lUmbralMissed} missed, ${spuriousUmbral.length} spurious umbral)`,
);
console.log(`  Correct umbral type         : ${lTypeOk}/${lMatched}`);
console.log(
  `  Umbral timing vs catalog    : mean ${lMatched ? (lSumErrH / lMatched).toFixed(1) : "—"} h, max ${lMaxErrH.toFixed(1)} h`,
);
console.log(
  `  Penumbral detections (info) : ${lunarPredicted.filter((p) => p.type === "penumbral").length}  * documented, never gates CI`,
);
if (lunarSpurious.length) {
  console.log(
    `  Spurious lunar (info)       : ${lunarSpurious.map((p) => `${Eph.jdToUTCString(p.jd)} [${p.type}]`).join(", ")}`,
  );
}
console.log("═".repeat(74));

const solarFail = missed !== 0 || spurious.length !== 0;
const lunarFail = lUmbralMissed !== 0 || spuriousUmbral.length !== 0;
process.exitCode = solarFail || lunarFail ? 1 : 0;
