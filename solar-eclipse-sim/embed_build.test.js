"use strict";
/*
 * embed_build.test.js — the committed embed bundle must be byte-exactly
 * reproducible from source via build_embed.js. AGENTS invariant 3 and the CI
 * "Embed bundle is reproducible from source" gate check exactly this; a bundle
 * that was hand-edited or run through a formatter after building diverges from
 * build_embed.js's raw concatenation and reddens the verify gate. This test is
 * the fast local guard for that regression class.
 *
 * Run with: node --test solar-eclipse-sim/embed_build.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(__dirname, "build_embed.js");
const BUNDLE = path.join(ROOT, "SolarEclipse", "embed", "solar-background.js");

test("committed embed bundle is byte-identical to build_embed.js output", () => {
  const committed = fs.readFileSync(BUNDLE);
  let rebuilt;
  try {
    // Run the REAL build script (it overwrites BUNDLE), capture the result,
    // then restore the committed bytes so the working tree is left untouched.
    execFileSync("node", [BUILD], { stdio: "ignore" });
    rebuilt = fs.readFileSync(BUNDLE);
  } finally {
    fs.writeFileSync(BUNDLE, committed);
  }
  assert.ok(
    committed.equals(rebuilt),
    `SolarEclipse/embed/solar-background.js is not reproducible from source: ` +
      `committed=${committed.length} bytes, build_embed.js output=${rebuilt.length} bytes. ` +
      `Rebuild with 'node solar-eclipse-sim/build_embed.js' and commit the result ` +
      `(do not reformat the generated bundle).`,
  );
});
