# Solar System from First Principles — N-Body Eclipse Prediction

A recreation of the demo in [“Claude Fable 5 simulates the solar system and
predicts a solar eclipse”](https://youtu.be/5f5JYLZHdhw): a Newtonian N-body
simulation of the solar system that is accurate enough to **predict real
solar eclipses** — and verifies its own predictions against the published
NASA eclipse catalog.

Eclipses are not programmed in. The only physics in the integration loop is
pairwise Newtonian gravity:

```
aᵢ = Σⱼ G mⱼ (rⱼ − rᵢ) / |rⱼ − rᵢ|³
```

Solar eclipses *emerge* whenever the Moon's shadow cone, traced from the Sun
through the Moon, happens to sweep across the Earth.

## Run it

**Visualization** — open `index.html` in any browser (no build, no server,
no dependencies). Press **⏩ Predict next eclipse** to fast-forward the
physics to the next eclipse the simulation finds.

**Headless verification:**

```
node predict.js 2026-06-09 4.6
```

Output (3-year+ horizon, ~0.1 s of compute):

```
☉ 2026-08-12 17:14 UTC   TOTAL    axis miss   5747 km   ✓ matches NASA catalog
☉ 2027-02-06 13:29 UTC   ANNULAR  axis miss   1993 km   ✓
☉ 2027-08-02 06:14 UTC   TOTAL    axis miss   1087 km   ✓
☉ 2028-01-26 09:14 UTC   ANNULAR  axis miss   2294 km   ✓
☉ 2028-07-21 19:29 UTC   TOTAL    axis miss   3659 km   ✓
... 11 matched · 0 missed · 0 spurious
```

Over a 4.6-year horizon the bare physics predicts **all 11 real solar
eclipses** with the correct type (total / annular / partial), no false
positives, and timing within hours (the Aug 12 2026 total eclipse lands
within ~30 minutes of the true greatest-eclipse time). Relative energy
drift over 161,000 integration steps: ~2×10⁻¹¹.

## How it works

| File | Role |
| --- | --- |
| `ephemeris.js` | Seeds initial positions/velocities **once** at the start epoch: JPL approximate Keplerian elements for the planets, a truncated ELP-2000 series (Meeus ch. 47) for the Moon. Used only at t₀. |
| `physics.js` | The first-principles part: 10-body pairwise gravity (Sun, 8 planets, Moon), velocity Verlet at a 15-minute timestep, and shadow-cone geometry (penumbra/umbra radii at Earth's distance) for eclipse detection and classification. |
| `predict.js` | Headless Node run: integrates N years, prints every detected eclipse, scores against the NASA catalog. Exit code 0 only on a perfect score. |
| `index.html` | Browser visualization: heliocentric orbit view (inner/full scale), Earth–Moon shadow-geometry inset, live eclipse log with catalog verification, energy-drift readout. |

Classification rule: an eclipse is visible somewhere on Earth when the
Earth's limb reaches the penumbral cone; it's **total**/**annular** when the
shadow axis actually intersects the Earth (umbra vs. antumbra), otherwise
**partial**.

## Honest caveats

- Initial conditions come from analytic ephemerides accurate to arcseconds,
  not from a numerically-fitted ephemeris like DE440 — timing error grows to
  roughly ±1 day after ~5 years, dominated by the truncated lunar series.
- Point masses only: no Earth oblateness (J2), no relativity, no tidal
  effects. For multi-decade lunar work you'd want all three.
- Eclipse *paths* on the ground aren't computed — that needs Earth
  orientation (rotation, precession, nutation), which is outside the
  N-body problem.
