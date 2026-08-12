# Shipwright

A browser-based Napoleonic ship designer. Pick a hull, arm it, rig it, paint it,
then launch it into an ocean with real wind and find out whether your choices
float. Export the result as a versioned JSON design spec and a glTF model with a
named-node hierarchy, ready for a future age-of-sail combat game to consume.

There is no server, no combat, and no save button — the build is static and the
export is a file download.

The contract is [SPEC.md](SPEC.md); the definition of done is
[ACCEPTANCE.md](ACCEPTANCE.md); every judgment call made where the spec was
silent is logged in [DECISIONS.md](DECISIONS.md).

## Quick start

```bash
npm install
npm run dev        # Vite dev server
```

Node 20+ (developed on 22). First Playwright run needs `npx playwright install chromium`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) + production build |
| `npm run preview` | Serve the built app on :4173 |
| `npm run test` | Vitest unit suite |
| `npm run e2e` | Builds, then runs the Playwright specs against the preview server |
| `npm run e2e:shots` | Runs the demo scripts, writing retina screenshots to `shots/` |
| `npm run schema` | Regenerates `shipwright.schema.json` from the zod schemas |

## The three screens

**Hull select.** Five presets — Sloop, Brig, Frigate (28), Frigate (38), Third
Rate (74) — each a bundle of hull parameters plus the slider ranges it allows,
shown with a rendered thumbnail and its length, beam and nominal gun count.

**Designer.** The ship sits in a locked broadside camera that reads like a
profile drawing; an orbit toggle unlocks it. The left panel carries hull sliders
(beam, freeboard, sheer), the timber scheme, rig, cosmetics and copper. Mount
markers are raycast targets on real geometry — click a battery, a chaser or a
swivel rail to open its modal and set the pattern and the port and starboard
counts independently. Every control writes to one Zustand store, and the derived
stats bar recomputes live: displacement, draft, GM, static list, gun weight,
broadside weight per side, crew, cost in pounds.

**Sea trial.** Launch drops her into the ocean with a wind dial and a speed
slider, per-group sail controls, and a tiller (or `A`/`D`). The stability
solution runs every frame. Return to dock and the design comes back intact.

## How it works

**The station curves are the only source of truth.** The hull is generated from
21 transverse stations along the keel, interpolated from beam, depth, fullness
and sheer. Those same curves are lofted into the render mesh (`src/hull/loft.ts`),
integrated for hydrostatics (`src/physics/hydrostatics.ts`), and used to place
every socket (`src/hull/sockets.ts`). Nothing is ever measured off the render
mesh to compute physics.

**Hydrostatics are direct integration, not a small-angle shortcut.** For a
candidate waterplane (draft, heel, trim) each station polygon is clipped against
the plane, the submerged areas are integrated for volume and centre of buoyancy,
and draft is solved so displacement equals mass. The righting arm GZ comes out
of the same clipping at any heel, so vanishing stability is a fact of the model
rather than a constant. The centre of gravity is assembled in full 3D from every
mass — hull structure by zone, ballast, stores, guns, rig — including the lateral
offset from asymmetric port/starboard batteries. A one-sided battery therefore
lists the ship at the dock, and capsize happens because the heeling moment
exceeded peak righting moment, never because something triggered it.

**Wind is force, not animation.** Each `set` sail contributes ½ρv²·A·C at its
centre of effort, decomposed into drive and heel by wind angle; furled sails
contribute nothing. Heel, speed and yaw are integrated with heavy damping. Waves
displace the drawing and nothing else — the hull rides the swell but is not
pushed by it.

**Parts are data.** Guns, timber, sails, cosmetics and presets are typed JSON in
`src/data/`, validated by zod at load. Adding a gun rating means editing
`guns.json`; it never means touching component code. Every part carries a mass, a
mounting height and a cost in period pounds, and all three feed the totals.

## Export contract

`Export JSON` writes a document against `shipwright.schema.json`: the resolved
hull parameters, timber, rig, mounts (batteries carrying `port` and `starboard`
counts), cosmetics, a `derived` block, and an auto-generated `stations` array of
crew stations — helm, one gun battery per armed deck, sail handling and lookout
per mast, chasers if armed — each with a ship-local position and a crew
requirement. The round trip is exact: the dev import button reproduces the design
state deep-equal.

`Export glTF` writes a named-node hierarchy — `Hull`, `Mast_1..n` with their
yards, `Sail_<mast>_<tier>`, `Rudder`, `Gunport_<deck>_<index>`, gun meshes under
their mounts. The names are part of the contract; a future engine animates by
node name.

## Testing

86 Vitest assertions cover the pieces that are testable as maths: a 40×10×6 box
barge against its closed-form draft, displacement and small-angle GM; GZ curve
shape; monotonicity of draft in mass; the carronade story (swapping quarterdeck
32 lb carronades for long 24s must strictly decrease GM); data-file ordering
constraints on mass and cost; export round-trip and glTF node names.

Playwright drives the UI end to end, and `npm run e2e:shots` runs the two demo
scripts from ACCEPTANCE.md — "The Frigate" under all plain sail, and "The
Abomination", a minimum-beam sloop over-canvased and armed with long 32s, which
goes over on her own. The screenshots are meant to be looked at, not just
produced.

## Layout

```
src/
  data/          guns, timber, sails, cosmetics, presets (JSON + zod schemas)
  hull/          stations.ts, loft.ts, sockets.ts, areas.ts
  physics/       hydrostatics.ts, wind.ts, integrate.ts, masses.ts, derived.ts, cost.ts
  scene/         viewer.ts, ocean.ts, ship-mesh.ts, sails.ts, wake.ts, materials.ts
  ui/            React panels, modals, hull select, HUD
  export/        json-export.ts, gltf-export.ts, stations.ts, schema.ts
  state/         store.ts (zustand)
tests/           Vitest
e2e/             Playwright specs + demo scripts
```

## Known deviations from ACCEPTANCE.md

Two demo-two boxes describe behaviour the hydrostatics decline to produce, and
the model was not bent to make them true. An extreme-beam hull wallows in every
way the spec asks — nearly dead-beat in roll, lying over steadily under sail,
turning in 5.2 lengths against 3.7 — but its roll period is *shorter*, not
longer, because beam is what gives a hull its GM. And 20 knots does not capsize
the all-to-port frigate; she lists 3.4° at rest, 10° under that wind, and holds
it. She dies at about 50, when her lee sills finally go under. Both are argued in
full at the end of [DECISIONS.md](DECISIONS.md).
