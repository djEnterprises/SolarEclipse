# AGENTS.md — operating manual for coding agents (and humans)

Ground truth for making changes in this repo. Run the gate before you start and
before you finish; if it's red, your change isn't done.

## The one command

```
node solar-eclipse-sim/verify_range.js 2024-01-01 5
```

Exit 0 means: every NASA-cataloged solar eclipse in the five-year window predicted
(10/10), correct type, zero missed, zero spurious. It completes in well under a
second. `npm run verify` is an alias.

## Invariants CI enforces (`.github/workflows/verify.yml`)

1. **The catalog audit passes** (command above).
2. **The two core copies are byte-identical.** The physics lives twice, on purpose:
   `solar-eclipse-sim/{ephemeris,physics}.js` (Node harness) and
   `SolarEclipse/assets/core/{ephemeris,physics}.js` (browser showcase). The files
   carry dual browser/CommonJS export guards so the same bytes work in both worlds.
   Edit one, then copy it over the other — CI diffs the pairs.
3. **The embed bundle is reproducible from source.**
   `SolarEclipse/embed/solar-background.js` is a build artifact. After touching
   `assets/core/*`, `assets/app/simengine.js`, or `embed/_wrapper.js`, run:

   ```
   node solar-eclipse-sim/build_embed.js    # npm run build:embed
   ```

   and commit the rebuilt bundle, or CI fails the byte-exact diff.

## House rules

- **Zero runtime dependencies.** No frameworks, no installs, no build tooling
  beyond the two Node scripts above. Plain scripts, Node ≥ 18.
- **Nothing about eclipses is ever hardcoded into detection code.** Events must
  emerge from gravity + shadow geometry. NASA catalog dates exist only inside the
  verification harness, as the answer key — never as an input to prediction.
- Don't touch the integrator (velocity Verlet), the fixed 15-minute timestep, the
  ephemeris seeding, or energy accounting unless that is explicitly the task.
  `energyDrift()` over the 5-year run currently reports ~1.2e-11 relative.
- `SolarEclipse/data/eclipses.json` is generated output
  (`node solar-eclipse-sim/export_dataset.js`) — regenerate it, never hand-edit it.
- Honesty over polish: measured numbers only. If a capability is partial (e.g.
  penumbral events near the resolution limit), document the measured behavior
  rather than rounding it up to "works."

## Layout

| Path | What it is |
| --- | --- |
| `solar-eclipse-sim/` | Node harness: `verify_range.js` (CI gate), `export_dataset.js`, `build_embed.js`, standalone instrument page |
| `SolarEclipse/` | The web showcase, live at [djenterprises.ai/SolarEclipse](https://www.djenterprises.ai/SolarEclipse) — relative paths, works from any static server |
| `SolarEclipse/assets/core/` | The portable physics (DOM-free) — the copy pair of `solar-eclipse-sim/` |
| `SolarEclipse/embed/` | Drop-in ambient background; `solar-background.js` is built, `_wrapper.js` is source |
