# SolarEclipse — web showcase

The solar system from first principles: a 10-body Newtonian simulation that
predicts real solar eclipses, verified against the NASA catalog. Self-contained,
framework-free, zero dependencies, zero network calls. Live at
**[djenterprises.ai/SolarEclipse](https://www.djenterprises.ai/SolarEclipse)**,
and built to port cleanly to iOS.

## What's here

```
SolarEclipse/
├── index.html                 ← the single-page showcase (open directly)
├── assets/
│   ├── core/                  ← the verified physics — ALSO the iOS port source
│   │   ├── ephemeris.js       ← one-time initial conditions (JPL elements + ELP-2000 Moon)
│   │   └── physics.js         ← N-body velocity-Verlet integrator + shadow-cone eclipse detection
│   ├── app/
│   │   ├── simengine.js       ← reusable SolarSim instrument (theme-agnostic; reads CSS vars)
│   │   └── site.js            ← page interactions (nav, scroll reveals, controls)
│   └── styles.css             ← all design tokens + layout
└── data/
    └── eclipses.json          ← the verification scorecard (generated from a real sim run)
```

Everything uses **relative paths**, so the folder works at any URL prefix.

## Deploying it anywhere

Drop this folder on any static host and it serves at `/SolarEclipse/` — every
internal path is relative, so it also works at any other prefix, from `file://`,
or offline. One caveat learned in production: if your host serves extensionless
"clean URLs" **without** a trailing slash (Vercel with `cleanUrls: true` +
`trailingSlash: false`), the page resolves at `/SolarEclipse` and relative asset
paths break — either add a redirect to the slashed form or rewrite the asset
references root-absolute, which is exactly what the deployed copy on
djenterprises.ai does.

No build step. No env vars. No secrets. It is pure static output and makes no
outbound requests, so it is safe to serve from any host and satisfies a strict CSP.

## Regenerate the verification data

`data/eclipses.json` is produced by the real simulation, not hand-typed:

```
node ../solar-eclipse-sim/export_dataset.js
```

## Path to iOS

`assets/core/` is the portable, verified physics and is intentionally free of
DOM/UI code. Two routes to the iOS app:

1. **Fast:** wrap `index.html` in a `WKWebView` (bundle the folder, load
   locally — it already works offline). Ships in an afternoon.
2. **Native:** port `core/ephemeris.js` + `core/physics.js` to Swift
   (`simd`, `Double`), drive a SwiftUI `Canvas`, and regression-check the port
   against `../solar-eclipse-sim/verify_range.js` output — same seeds, same
   catalog, same pass bar — so the Swift core provably matches this one.

## Honesty note

Accuracy is best within ~5 years of the seed epoch; the app defaults to a
near-term horizon and offers an epoch re-sync. It predicts *that*, *when*, and
the *type* of an eclipse — never the ground path. See the site's own
"What it can't do" section; every number shown is measured, not marketing.
