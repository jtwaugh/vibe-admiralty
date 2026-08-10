# SPEC.md — Napoleonic Ship Designer ("Shipwright")

A browser-based ship designer widget for a future multiplayer age-of-sail combat game. Players configure a Napoleonic-era warship, see it rendered in 3D, launch it into water with wind, and export it as (a) a versioned JSON design spec and (b) a glTF model with a named-node hierarchy. The widget is standalone but its export contract is designed to be consumed by a larger game.

This document is the contract. Where it is silent, prefer the simplest implementation consistent with it.

## 1. Scope

In scope: everything below. Out of scope: combat, damage, netcode, voice chat, first-person interiors, crew AI, terrain, ports, economy, saving to a server (export is file download only). Do not build any of these, even partially, even as stubs beyond what the export schema requires.

## 2. Tech stack

- Vite + TypeScript + React for DOM UI
- Plain Three.js (no react-three-fiber) for the 3D scene, mounted in a single canvas component
- Zustand for design state
- Vitest for unit tests, Playwright for end-to-end tests with screenshots
- No server. Static build must work from `vite build && vite preview`.

## 3. UI flow

1. **Hull select screen.** A menu of hull presets: Sloop, Brig, Frigate (28), Frigate (38), Third Rate (74). Each is a named preset of the parametric hull (Section 4), shown with a small rendered thumbnail and basic stats (length, beam, nominal guns).
2. **Designer screen.** Selecting a hull opens the main view:
   - Center: the ship rendered in 3D from a locked broadside (side-profile) camera. It should read like a 2D profile drawing. An "orbit" toggle unlocks the camera.
   - Left panel: dropdown groups (Section 6) for hull tweaks, timber scheme, rig, and cosmetics.
   - Mount points: clickable markers on the hull (gun deck batteries, quarterdeck, forecastle, bow chaser, stern chaser, swivel rails). Clicking opens a modal to configure that mount (Section 5). Mount markers are raycast targets on real geometry, positioned from sockets emitted by the hull generator.
   - Header: ship name text field, Launch button, Export JSON button, Export glTF button, Back to hulls.
3. **Sea trial view.** Launch drops the configured ship into an ocean scene with a wind vector control (direction dial + speed slider) and per-sail-group controls to set or furl sails. The stability simulation (Section 7) runs live. A "Return to dock" button goes back to the designer with state intact.

## 4. Parametric hull

The hull is generated geometry, not a mesh asset. Parameters:

- `keelLength` (m), `beam` (m), `depthOfHold` (m), `freeboard` (m)
- `sheer` (0..1, curvature of the deck line), `bowFullness` (0..1), `sternType` ("square" | "round")
- `deckCount` (1..3 gun decks)

Generation approach: define 21 transverse stations along the keel; each station is a hull cross-section curve controlled by beam/depth/fullness interpolation; loft the stations into a closed mesh. The station curves are the single source of truth: the same station data drives (a) the render mesh, (b) the hydrostatics (Section 7), and (c) socket placement. Do not compute hydrostatics from the render mesh.

Hull presets are parameter bundles plus allowed slider ranges. Sliders in the left panel adjust `beam`, `freeboard`, and `sheer` within the preset's range ("Spore-style" deformation). Sockets (mast steps, battery positions, chaser positions, rails) are computed from stations and move correctly when sliders change.

## 5. Parts catalog (data files, not code)

All parts live in typed JSON data files under `src/data/`. Weights matter: every part has `massKg` and a mounting height contribution; totals feed the physics. Every part also has `costPounds` (period pounds sterling, historically plausible ordering rather than precise figures). Hull base cost scales with nominal displacement; timber species and zone thicknesses multiply it (live oak > English oak > Baltic fir; heavier scantlings cost more); copper sheathing is a significant line item. A completed third-rate should total in the neighborhood of £50,000. Cost is a readout and an export field only; there is no budget mechanic.

**Guns.** Rated by shot weight and pattern.
- Long guns: 6, 9, 12, 18, 24, 32, 42 lb
- Medium (Congreve): 12, 18, 24 lb
- Carronades: 12, 18, 24, 32, 68 lb
- Mass scaling: use historically plausible values (a long 32 ≈ 2800 kg; a 32 lb carronade ≈ 900 kg; interpolate sensibly). Each battery mount holds guns of one type with **independent port and starboard counts** (0..N per side; N from the hull preset per deck). The modal exposes both sides plus a "match sides" convenience toggle. Asymmetric loading shifts the lateral center of gravity and must produce a static list via the normal hydrostatics (see §7); do not special-case it. Chasers hold 1–2 guns; swivel rails hold ½-pounder swivels (cosmetic mass only).
- Every gun entry has `costPounds`. Ordering constraints: cost increases with shot weight within a pattern; carronade < medium < long at equal rating.

**Timber scheme.**
- Species: Baltic fir (density 0.55), English oak (0.75), live oak (0.90) — relative multipliers on hull structural mass.
- Thickness by zone, each with a 3-step dropdown (light / standard / heavy): bottom planking, wales, topsides, bulwarks, deck. Wales mass applies at waterline height (stabilizing); bulwark mass applies at rail height (destabilizing). Zone masses are computed from hull surface area per zone × thickness × species density.
- Hammock nettings: on/off, small topweight, cosmetic mesh along rails.

**Rig.** Mast count fixed per preset (1 sloop, 2 brig, 3 others). Per mast: course, topsail, topgallant (square sails); plus jibs and spanker as fore-and-aft groups. Each sail has area (m²), a center-of-effort height, and a state: `set` | `furled`. Sail plan dropdown per preset: reduced / standard / over-canvased (scales areas ±25%).

**Cosmetics.** Figurehead (3 options), stern gallery (2 options), paint scheme (plain / Nelson chequer / Spanish red), copper sheathing on/off (small mass, +0.5 kn effective in sim, visible material change below waterline).

## 6. Left panel groups

Hull (sliders), Timber (species + 5 zone dropdowns + nettings), Rig (sail plan), Cosmetics, Copper. Every control writes to the single Zustand design state; the 3D view and derived stats update live. A derived-stats readout shows: displacement (t), draft (m), metacentric height GM (m), static list (°, nonzero when armament is asymmetric), total gun weight (t), broadside weight per side (lb), crew estimate, total cost (£).

## 7. Physics (sea trial)

Not fluid simulation. Hydrostatics + rigid body:

- Buoyancy: slice hull at the 21 stations; for a candidate waterplane (draft + heel + trim), compute submerged area per station by clipping the station polygon against the waterplane; integrate for displaced volume and center of buoyancy. Solve draft so displacement = total mass. 
- Righting: compute righting arm GZ as a function of heel from the station clipping (no metacentric small-angle shortcut at large heel; direct integration). The center of gravity is computed in full 3D from all masses, including the **lateral offset from asymmetric port/starboard gun counts**. Equilibrium heel is where the righting moment balances the total heeling moment (lateral CG offset + wind); a one-sided battery therefore produces a static list even in zero wind, visible both at the dock (derived stats) and in the sea trial. If the offset moment exceeds the peak righting moment, no equilibrium exists and the ship capsizes at launch. Capsize occurs naturally when heeling moment exceeds max righting moment; do not script capsize.
- Wind: each `set` sail contributes force = ½ρ v² · area · coefficient, applied at its center of effort, decomposed into drive (forward) and heel components by wind angle. Furled sails contribute nothing.
- Motion: integrate heel, forward speed, and yaw (rudder via A/D or on-screen tiller) with heavy damping. Waves are visual only (shader), not forces.
- Failure states must emerge, not be scripted: over-canvased narrow hull heels past max GZ and capsizes (ship rolls, masts hit water, sinking is a slow fade below the waterplane); overloaded hull floats with gunports at or under water; extreme beam wallows (high roll damping, sluggish yaw).

Sail animation: set/furl transitions over ~2 s; billow via vertex displacement in the sail material shader driven by wind pressure on that sail. No cloth simulation.

## 8. Export contract

**JSON** (`shipwright.schema.json`, versioned, validated with zod at export time):
- `schemaVersion`, `name`, `hull` (preset + resolved parameters), `timber`, `rig`, `mounts` (socket id → part config; battery mounts carry `port` and `starboard` gun counts), `cosmetics`
- `derived`: displacement, draft, GM, staticListDeg, broadsideWeightPort, broadsideWeightStarboard, crewEstimate, maxSpeedEstimate, totalCostPounds
- `stations`: auto-generated array of crew stations for the future game: `helm`, one `gun-battery` per armed battery (with gun count and deck), `sail-handling` per mast, `lookout` per mast top, `bow-chaser`/`stern-chaser` if armed. Each station: `id`, `type`, `position` (ship-local xyz), `crewRequired`. Stations are derived, never edited in the UI.
- The export must round-trip: importing the JSON (dev-only import button is acceptable) reproduces the design exactly.

**glTF**: exported via Three.js GLTFExporter with a named-node hierarchy: `Hull`, `Mast_1..n` containing `Yard_course` etc., each sail as `Sail_<mast>_<tier>`, `Rudder`, `Gunport_<deck>_<index>`, gun meshes under their mount nodes. Names are part of the contract; a future engine animates by node name.

## 9. Visual bar

Stylized-but-handsome is the target: flat-ish PBR materials, ocean as an animated shader plane, sky gradient + sun, soft shadows. It must look like a game, not a debug view. No downloaded assets; all geometry procedural or primitive-composed. Fonts: one Google font is fine, bundled.

## 10. Acceptance

See ACCEPTANCE.md. All Vitest and Playwright suites green, and the two demo scripts (the Frigate and the Abomination) pass with screenshots the agent has visually verified.
