#!/usr/bin/env node
/*
 * predict.js — headless verification.
 *
 * Seeds the N-body system at a start date (default: today), integrates
 * forward with velocity Verlet, and prints every solar eclipse the bare
 * physics produces — then scores the predictions against the published
 * eclipse canon (Espenak/NASA five-millennium catalog dates).
 *
 *   node predict.js [startDate] [years]
 *   node predict.js 2026-06-09 3
 */
'use strict';

const Eph = require('./ephemeris.js');
const { NBodySimulation, EclipseDetector } = require('./physics.js');

// Published solar eclipses (NASA catalog), for scoring only — the simulation
// never sees these.
const CATALOG = [
  { date: '2026-02-17', type: 'annular' },
  { date: '2026-08-12', type: 'total' },
  { date: '2027-02-06', type: 'annular' },
  { date: '2027-08-02', type: 'total' },
  { date: '2028-01-26', type: 'annular' },
  { date: '2028-07-22', type: 'total' },
  { date: '2029-01-14', type: 'partial' },
  { date: '2029-06-12', type: 'partial' },
  { date: '2029-07-11', type: 'partial' },
  { date: '2029-12-05', type: 'partial' },
  { date: '2030-06-01', type: 'annular' },
  { date: '2030-11-25', type: 'total' },
];

const startArg = process.argv[2];
const years = parseFloat(process.argv[3] || '3');
const startDate = startArg ? new Date(startArg + 'T00:00:00Z') : new Date();
const jd0 = Eph.dateToJd(startDate);
const dt = 1 / 96; // 15-minute timestep
const steps = Math.round((years * 365.25) / dt);

console.log('─'.repeat(72));
console.log('  SOLAR SYSTEM FROM FIRST PRINCIPLES — N-BODY ECLIPSE PREDICTION');
console.log('─'.repeat(72));
console.log(`  Bodies      : Sun + 8 planets + Moon (10), pairwise gravity`);
console.log(`  Integrator  : velocity Verlet, dt = 15 min (${steps.toLocaleString()} steps)`);
console.log(`  Start epoch : ${startDate.toISOString().slice(0, 10)}  (JD ${jd0.toFixed(2)})`);
console.log(`  Horizon     : ${years} years`);
console.log('─'.repeat(72));

const t0 = Date.now();
const sim = new NBodySimulation(jd0);
const detector = new EclipseDetector();

const predicted = [];
for (let i = 0; i < steps; i++) {
  sim.step(dt);
  const ev = detector.sample(sim);
  if (ev) {
    predicted.push(ev);
    console.log(`  ☉ ${Eph.jdToUTCString(ev.jd)}   ${ev.type.toUpperCase().padEnd(7)}  ` +
                `axis miss ${(ev.dperp * Eph.AU_KM).toFixed(0).padStart(6)} km`);
  }
}
const elapsed = (Date.now() - t0) / 1000;

console.log('─'.repeat(72));
console.log(`  Integration finished in ${elapsed.toFixed(1)} s · ` +
            `relative energy drift ${sim.energyDrift().toExponential(2)}`);
console.log('─'.repeat(72));
console.log('  SCORE vs published NASA eclipse catalog:');

let matched = 0, missed = 0;
const horizonEnd = jd0 + years * 365.25;
for (const c of CATALOG) {
  const cJd = Eph.dateToJd(new Date(c.date + 'T12:00:00Z'));
  if (cJd < jd0 || cJd > horizonEnd) continue;
  const hit = predicted.find((p) => Math.abs(p.jd - cJd) < 1.5);
  if (hit) {
    matched++;
    const dtHours = (hit.jd - cJd) * 24;
    const typeOk = hit.type === c.type ? '' : `  (sim says ${hit.type}, catalog ${c.type})`;
    console.log(`    ✓ ${c.date} ${c.type.padEnd(7)} — predicted within ${Math.abs(dtHours).toFixed(1)} h${typeOk}`);
  } else {
    missed++;
    console.log(`    ✗ ${c.date} ${c.type.padEnd(7)} — NOT predicted`);
  }
}
const spurious = predicted.filter((p) =>
  !CATALOG.some((c) => Math.abs(Eph.dateToJd(new Date(c.date + 'T12:00:00Z')) - p.jd) < 1.5));
console.log('─'.repeat(72));
console.log(`  ${matched} matched · ${missed} missed · ${spurious.length} spurious`);
if (spurious.length) {
  for (const p of spurious) console.log(`    ? spurious: ${Eph.jdToUTCString(p.jd)} ${p.type}`);
}
process.exitCode = missed === 0 && spurious.length === 0 ? 0 : 1;
