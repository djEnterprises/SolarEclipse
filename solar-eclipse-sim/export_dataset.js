#!/usr/bin/env node
/*
 * export_dataset.js — emit the verification dataset the website renders.
 * Runs the real N-body integration and pairs each predicted eclipse with the
 * matching NASA-catalog entry. Output: data/eclipses.json (predictions are
 * generated, not hand-typed — the site shows what the physics actually did).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Eph = require('./ephemeris.js');
const { NBodySimulation, EclipseDetector } = require('./physics.js');

const CATALOG = [
  ['2024-04-08', 'total'],   ['2024-10-02', 'annular'],
  ['2025-03-29', 'partial'], ['2025-09-21', 'partial'],
  ['2026-02-17', 'annular'], ['2026-08-12', 'total'],
  ['2027-02-06', 'annular'], ['2027-08-02', 'total'],
  ['2028-01-26', 'annular'], ['2028-07-22', 'total'],
];

const seed = '2024-01-01';
const years = 5;
const jd0 = Eph.dateToJd(new Date(seed + 'T00:00:00Z'));
const dt = 1 / 96;
const steps = Math.round((years * 365.25) / dt);

const sim = new NBodySimulation(jd0);
const det = new EclipseDetector();
const predicted = [];
for (let i = 0; i < steps; i++) { sim.step(dt); const ev = det.sample(sim); if (ev) predicted.push(ev); }

let sumErr = 0, maxErr = 0, typeOk = 0;
const rows = CATALOG.map(([date, type]) => {
  const cJd = Eph.dateToJd(new Date(date + 'T12:00:00Z'));
  const hit = predicted.find((p) => Math.abs(p.jd - cJd) < 1.5);
  if (!hit) return { catalogDate: date, catalogType: type, predicted: null };
  const errH = (hit.jd - cJd) * 24;
  sumErr += Math.abs(errH); maxErr = Math.max(maxErr, Math.abs(errH));
  const tOk = hit.type === type;
  if (tOk) typeOk++;
  return {
    catalogDate: date, catalogType: type,
    predictedUTC: Eph.jdToUTCString(hit.jd),
    predictedType: hit.type,
    axisMissKm: Math.round(hit.dperp * Eph.AU_KM),
    timingErrorHours: +errH.toFixed(1),
    typeMatch: tOk,
  };
});

const out = {
  meta: {
    seedEpoch: seed,
    horizonYears: years,
    integrationSteps: steps,
    timestepMinutes: 15,
    bodies: sim.names,
    matched: rows.filter((r) => r.predicted !== null || r.predictedUTC).length,
    total: CATALOG.length,
    correctType: typeOk,
    meanTimingErrorHours: +(sumErr / CATALOG.length).toFixed(1),
    maxTimingErrorHours: +maxErr.toFixed(1),
    energyDriftRelative: sim.energyDrift(),
  },
  eclipses: rows,
};
const dest = path.join(__dirname, '..', 'SolarEclipse', 'data', 'eclipses.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log('wrote', dest);
console.log(JSON.stringify(out.meta, null, 2));
