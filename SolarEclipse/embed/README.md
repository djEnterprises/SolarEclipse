# SolarEclipse ambient background — drop-in

Put the inner solar system behind any page (e.g. the djEnterprises homepage)
as a calm, self-contained ambient background. One file, zero dependencies,
zero network calls.

## Use it

Copy `solar-background.js` to the site and add:

```html
<!-- full-bleed behind the whole page -->
<body data-solar-background data-opacity="0.4">
  …your content (give it position: relative / a z-index above the background)…
  <script src="/path/to/solar-background.js"></script>
</body>
```

or mount it into a specific hero container:

```html
<section class="hero">
  <div data-solar-background data-scale="1.9" data-opacity="0.5"></div>
  …hero content…
</section>
<script src="/path/to/solar-background.js"></script>
```

or drive it from JS:

```js
SolarBackground.mount({ container: document.getElementById('bg'), scaleAU: 1.9, opacity: 0.5 });
```

### Options (`data-*` or `mount()` keys)

| attribute | key | default | meaning |
| --- | --- | --- | --- |
| `data-scale` | `scaleAU` | `1.9` | view radius in AU (1.9 ≈ the inner solar system) |
| `data-opacity` | `opacity` | `0.4` | layer opacity |
| `data-speed` | `stepsPerFrame` | `5` | orbit speed |

## Behaviour

- **Ambient**: no labels, no controls — it's background, not a headline act.
- **Efficient**: pauses when scrolled off-screen or the tab is hidden.
- **Accessible**: renders a single correct static frame under
  `prefers-reduced-motion` (never auto-animates).
- **Themeable**: reads CSS custom properties (`--sun`, `--earth`, `--star`,
  `--sim-bg`, …), so it adopts the host page's palette; falls back to the
  SolarEclipse defaults.

The dark background of the canvas is drawn opaque, so place a solid dark
base (or accept the canvas's own `--sim-bg`) behind it if you set a low
opacity, then keep page content on a layer above it.

### Light-theme hosts

The deep-space look has two dark-only layers, both themeable from `:root`:

```css
:root {
  --sim-bg: #FAF8F4;        /* paper instead of space */
  --sim-vignette: none;      /* drop the dark corner falloff entirely */
  --star: transparent;       /* a starfield on light paper reads as dust */
  /* then restate the body colors in your palette: --sun, --earth, … */
}
```

`--sim-vignette-0/1/2` override the three gradient stops individually if you
want a tinted falloff instead of none. This is exactly how the light
"Editorial" homepage at djenterprises.ai runs the same bundle. Two practical
notes from that deployment: planet dots are the darkest pixels on the layer, so
check text contrast against them (WCAG AA) if copy sits above the canvas; and
at ambient speed Earth needs minutes to trace a full ellipse, so consider
pre-rolling trails before first paint if you want visible orbit rings on
arrival.

## Files

- `solar-background.js` — the bundled drop-in (built; **this is the file you deploy**).
- `_wrapper.js` — the mount wrapper source.
- `homepage-concept.src.html` — a worked example: the djEnterprises homepage hero.

Rebuild the bundle after editing the engine or wrapper:

```
node ../../solar-eclipse-sim/build_embed.js
```
