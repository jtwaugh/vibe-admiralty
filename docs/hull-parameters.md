# Hull parameters: what they mean and what reads them

A map of the hull parameter model, written because working it out from scratch
takes a full sweep of the codebase. If you are about to add, rename or
re-parameterise a hull dimension, read this first.

Line numbers below are a convenience and will rot; the **names** are the
durable reference, so grep for the function or constant rather than trusting
the number. Where this page states a measured figure rather than a code
reference, that figure is pinned by a test — see
`tests/documented-figures.test.ts` and the note at the head of DECISIONS.md's
disagreement section.

## Coordinate convention

Ship-local, declared at `src/hull/stations.ts:5-22` and honoured everywhere:

- **x** — longitudinal, **+forward**. Stations run `-L/2` at the stern (u = 0) to
  `+L/2` at the bow (u = 1).
- **y** — up, from the **baseline**: the top of the keel amidships. Every height
  in the project is measured from here, including deck levels and socket seats.
- **z** — athwartships, **+starboard**.
- **u** — normalised longitudinal position, 0 at the stern to 1 at the bow. Most
  placement code works in `u` and converts to x at the last moment, which is why
  a change to hull length propagates for free.

**Beam is a width (z). Length is a length (x).** They have never been confused in
the geometry; if a ship looks wrong, suspect the camera or the preset, not the
axis mapping.

## The one-source-of-truth rule

The 21 station curves are the only description of the hull's shape. They drive:

1. the render mesh (`src/hull/loft.ts`),
2. the hydrostatics (`src/physics/hydrostatics.ts`), and
3. socket placement (`src/hull/sockets.ts`).

Never measure the render mesh to compute physics. If you need a hull dimension,
take it from `HullParams` or from the stations, not from vertices.

## The parameters

All eight live in `hullParamsSchema` at `src/data/schemas.ts:96-109`.

| Parameter | Unit | Datum / meaning | Drives | Editable |
|---|---|---|---|---|
| `keelLength` | m | Overall hull length on the baseline — *not* the rabbet-to-rabbet keel | x | slider "Length" |
| `beam` | m | Maximum moulded breadth (full width, halved at use) | z | slider "Beam" |
| `depthOfHold` | m | Baseline to the lowest gun deck | y | slider "Depth of hold" |
| `freeboard` | m | Weather deck to the top of the rail, i.e. bulwark height | y | slider "Freeboard" |
| `sheer` | 0..1 | Curvature of the deck line | y | slider "Sheer" |
| `bowFullness` | 0..1 | Bow bluffness and section fullness forward | z shaping | preset only |
| `sternType` | enum | `square` or `round`; sets the stern half-breadth end factor | z shaping | preset only |
| `deckCount` | 1..3 | Gun decks; a weather deck is always stacked on top | y | preset only |

Per-preset slider ranges live in `hullPresetSchema.ranges`
(`src/data/schemas.ts:122`), not in `hullParamsSchema`. A parameter without a
range entry cannot be a slider.

## The input / derived boundary

**This is the part that is easy to get wrong.** Hull parameters are *given*. The
ship's floating state is *solved*. The arrow only points one way:

```
HullParams ──> stations ──> section polygons ─┐
                                              ├──> solve ──> draft, GM, list, trim
mass model (timber, guns, ballast, stores) ───┘
```

- **Draught is an output.** `solveOffsetForVolume` (`src/physics/hydrostatics.ts:244`)
  bisects the waterplane offset until displaced volume equals `massKg / 1025`
  (`:284`); the reported draft is `solved.offset - solved.deepest` (`:322`).
- **Displacement is an output**, and is simply total mass:
  `displacementTonnes: mass / 1000` (`src/physics/derived.ts:69`).
- GM, static list and trim are likewise solved.

So no hull parameter may be defined in terms of the waterline — that is why
`freeboard` is bulwark height rather than deck-above-water, and why the
**Draught** slider drives `depthOfHold` (a shape) rather than setting a target
draft (a result). A deeper hold gives a taller, finer underbody, so for the same
mass she floats deeper; the solver still has the last word.

Similarly the **Length** slider stores `keelLength` in metres and merely
*displays* the resulting tonnage. Storing a target displacement instead would
make the stored design depend on the timber and guns fitted to it.

## What reads each parameter

Check these when you change how a parameter behaves.

### `beam`
- `src/hull/stations.ts:132` — `maxHalfBeam = (beam / 2) * halfBeamFactor(u)`
- `src/hull/sockets.ts` — outboard seating via `halfBreadthAt`
- `src/physics/sailplan.ts:70` — `unitArea = beam² * plan.areaScale`, so canvas
  scales with **beam, not length**, and mast heights key off beam at `:82`
- `src/physics/integrate.ts:263-271` — roll gyradius and roll/yaw damping;
  `beamRatio = beam / (ORDINARY_BEAM_RATIO * length)`
- `src/scene/materials.ts`, `src/scene/fittings.ts`

Beam's effect on stability is *tuned*: ACCEPTANCE §E's abomination demos and the
measured figures in DECISIONS.md depend on the current beam→GM relationship.
Changing it means re-measuring those numbers.

### `keelLength`
- `src/hull/stations.ts:171` — `x = (u - 0.5) * keelLength`
- `src/hull/stations.ts:92` — `sheerRise` scales the bow rise by `0.075 * keelLength`
- `src/physics/derived.ts:78` — `speedEstimate(model, hull.length * 0.94)`, the
  only waterline-length notion in the project
- `src/scene/viewer.ts:219-220,303` — camera framing
- `src/hull/sockets.ts:134,144,152` — but only as the final `u → x` conversion

### `depthOfHold`
- `src/hull/stations.ts:80-88` — `keelRise`, the rising floor at both ends
- `src/hull/stations.ts:138` — `yMax`, the height of maximum breadth (`0.75 * depthOfHold`)
- `src/hull/stations.ts:118-129` — `deckLevels`; gun decks stack at
  `depthOfHold + i * DECK_SPACING` (2.3 m), so **deepening the hold lifts every
  deck and every gunport**
- `src/hull/areas.ts:23-40` — timber zone bands at 0.62 and 0.94 of the depth
- `src/hull/sockets.ts` — mast steps seat below the hold
- `src/physics/masses.ts:220-231` — ballast and stores heights and masses

### `freeboard`
- `src/hull/stations.ts:114` — `hullDepth = depthOfHold + deckCount * 2.3 + freeboard`
- `src/hull/areas.ts` — the bulwark band
- Bulwarks add **no buoyancy**: buoyant volume is clipped at the weather deck,
  not the rail (`src/physics/hydrostatics.ts:21-26`).

## Propagation checklist

Adding or exposing a hull parameter means touching all of:

1. `src/data/schemas.ts` — `hullParamsSchema` and/or `hullPresetSchema.ranges`
2. `src/data/presets.json` — **all five** presets
3. `src/state/store.ts` — the `SliderKey` union that gates what the panel may edit
4. `src/ui/Designer.tsx` — the Hull `PanelGroup`; sliders are hardcoded JSX, only
   min/max come from the preset
5. `src/export/schema.ts` — if the field is part of the exported design
6. `shipwright.schema.json` — regenerate with `npm run schema`; a unit test fails
   on drift. **Only `hullParamsSchema` is serialised**, so adding or changing a
   preset *range* leaves this file alone; adding a `HullParams` field does not.
   If `git status` shows this file dirty after a ranges-only change, something
   else moved.

Then run `npm run e2e:shots` and **look at the screenshots**. A green suite with a
broken picture is a failure.
