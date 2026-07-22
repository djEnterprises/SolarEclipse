#!/usr/bin/env node
/*
 * build_embed.js — bundle the verified core + engine + wrapper into a single
 * self-contained drop-in file: SolarEclipse/embed/solar-background.js
 * One <script> tag, zero dependencies, for the djEnterprises homepage.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'SolarEclipse');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const banner = `/*! SolarEclipse ambient background — bundled drop-in.
 * Verified N-body core (ephemeris + physics) + engine + mount wrapper.
 * Add to any page: load this file with a script tag, then put the
 * data-solar-background attribute on a container or on the body.
 * © djEnterprises. */\n`;

const bundle = banner + [
  read('assets/core/ephemeris.js'),
  read('assets/core/physics.js'),
  read('assets/app/simengine.js'),
  read('embed/_wrapper.js'),
].join('\n');

const dest = path.join(root, 'embed', 'solar-background.js');
fs.writeFileSync(dest, bundle);
console.log('wrote', dest, '(' + Math.round(bundle.length / 1024) + ' KB)');
