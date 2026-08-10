# CLAUDE.md — Shipwright

You are building the project defined in SPEC.md. SPEC.md is the contract; ACCEPTANCE.md is the definition of done. Read both before writing code. The human will not fix code by hand; you own every line.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — type-check + production build (must stay green at every commit)
- `npm run test` — Vitest unit suite
- `npm run e2e` — Playwright suite (builds first, runs against preview server)
- `npm run e2e:shots` — Playwright demo scripts that write screenshots to `shots/`

## Non-negotiable working rules

1. **Phased delivery.** Phase 1: schema, parametric hull generator, hydrostatics math, static viewer. Phase 2: full designer UI (presets, sliders, panels, mount modals, derived stats, exports). Phase 3: sea trial (ocean, wind, sails, live physics, failure states). Finish and verify each phase before starting the next. Commit at least once per completed sub-task with descriptive messages.
2. **Look at your own renders.** After any change touching geometry, materials, camera, or the sea trial, run `npm run e2e:shots` and open the screenshots. Judge them as a human would: Is the ship above the water? Do masts pierce the deck, not float beside it? Do sails attach to yards? Does the broadside camera read as a clean profile? A green test suite with a broken picture is a failure. Fix what you see.
3. **Hydrostatics are testable math. Treat them that way.** The station-clipping integrator must pass analytic cases before it ever touches the render loop: a rectangular box barge has closed-form draft, displacement, and small-angle GM. Write those tests first (they are enumerated in ACCEPTANCE.md).
4. **One source of truth.** Station curves drive mesh, physics, and sockets. If you find yourself measuring the render mesh to compute physics, stop and refactor.
5. **Data over code.** Guns, timber, sail plans, presets: typed JSON in `src/data/`, validated by zod schemas at load. Adding a gun rating must never require touching component code.
6. **No scope creep.** The out-of-scope list in SPEC.md §1 is binding. If a feature seems tempting and is not in SPEC.md, do not build it.
7. **Keep it simple for future-you.** Descriptive function names, small modules, plain state. No clever abstractions. Comments only where the math is non-obvious (the clipping integrator will need them).
8. **When uncertain, decide and log.** Do not stall waiting for input. Make the choice most consistent with SPEC.md, record it in DECISIONS.md with one line of rationale, and continue.

## Layout

```
src/
  data/          guns.json, timber.json, presets.json, sails.json (+ zod schemas)
  hull/          stations.ts, loft.ts, sockets.ts
  physics/       hydrostatics.ts, wind.ts, integrate.ts
  scene/         viewer.ts, ocean.ts, ship-mesh.ts, sails.ts, materials.ts
  ui/            React components (panels, modals, hull select, HUD)
  export/        json-export.ts, gltf-export.ts, schema.ts
  state/         store.ts (zustand)
tests/           Vitest
e2e/             Playwright specs + demo scripts
```

## Definition of done

Every item in ACCEPTANCE.md checked, `npm run build && npm run test && npm run e2e` green from a clean clone, and the two demo screenshot sets visually verified by you against the descriptions in ACCEPTANCE.md.
