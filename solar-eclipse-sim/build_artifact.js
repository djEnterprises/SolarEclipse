#!/usr/bin/env node
/*
 * build_artifact.js — inline the multi-file SolarEclipse site into ONE
 * self-contained HTML body for publishing as a live preview (claude.ai
 * Artifact). Source of truth stays the multi-file SolarEclipse/ folder;
 * this is a generated preview build.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'SolarEclipse');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('assets/styles.css');
const ephemeris = read('assets/core/ephemeris.js');
const physics = read('assets/core/physics.js');
const simengine = read('assets/app/simengine.js');
const site = read('assets/app/site.js');
const data = read('data/eclipses.json');

// pull the <body> inner markup out of index.html, drop external <script src> + <link>
let html = read('index.html');
let body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
body = body.replace(/<script src="[^"]*"><\/script>\s*/g, '').trim();

const out = `<style>
${css}
</style>

${body}

<script>${ephemeris}</script>
<script>${physics}</script>
<script>window.__ECLIPSE_DATA__ = ${data};</script>
<script>${simengine}</script>
<script>${site}</script>
`;

const dest = path.join(__dirname, '..', 'SolarEclipse', 'preview.artifact.html');
fs.writeFileSync(dest, out);
console.log('wrote', dest, '(' + Math.round(out.length / 1024) + ' KB)');
