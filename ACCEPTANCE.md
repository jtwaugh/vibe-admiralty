# ACCEPTANCE.md — Shipwright

Done means every box below is checked by passing automated tests or agent-verified screenshots. The human's role ends at this document; agents do the rest.

## A. Hydrostatics unit tests (Vitest)

- [ ] Box barge 40×10×6 m, mass 1000 t: solved draft within 1% of analytic 2.5 m; displaced volume within 1%.
- [ ] Same barge, small-angle GM within 2% of analytic BM − BG + KB result.
- [ ] GZ curve for the box barge is 0 at 0° heel, positive through small angles, and crosses zero again before 90° (vanishing stability exists).
- [ ] Doubling mass increases solved draft; monotonicity holds across 10 random masses.
- [ ] A station polygon fully above the waterplane contributes zero submerged area; fully below contributes its full area.
- [ ] Frigate preset with standard everything: solved draft between 4 and 7 m, GM between 0.5 and 2.5 m (sanity band, not exact).
- [ ] Moving 20 t from waterline height to bulwark height strictly decreases GM.
- [ ] Swapping quarterdeck 32 lb carronades for long 24s strictly decreases GM (the carronade story must be true in the model).
- [ ] Frigate with all guns moved to the port side: equilibrium heel is a nonzero port list in zero wind; list angle increases monotonically as more mass moves to one side.
- [ ] Narrow sloop with long 32s on one side only: no equilibrium exists (offset moment exceeds peak righting moment); solver reports capsize-at-rest.
- [ ] Symmetric armament yields staticListDeg = 0 within tolerance.

## B. Data + schema tests (Vitest)

- [ ] All data files validate against their zod schemas.
- [ ] Gun masses are monotonic in shot weight within each pattern; carronade mass < medium < long at equal rating.
- [ ] Gun costs are monotonic in shot weight within each pattern; carronade < medium < long at equal rating.
- [ ] Total cost readout: live oak > English oak > Baltic fir for an otherwise identical ship; enabling copper sheathing increases cost; a standard third-rate totals £30,000–£80,000.
- [ ] Battery mounts export `port` and `starboard` counts; asymmetric design round-trips exactly; derived export includes `staticListDeg` and `totalCostPounds`.
- [ ] Export → import round-trip reproduces identical design state (deep equality).
- [ ] Exported JSON validates against `shipwright.schema.json`; `schemaVersion` present.
- [ ] Stations array: frigate preset with armed batteries yields exactly one helm, one gun-battery per armed deck, sail-handling and lookout per mast; positions are within hull bounds; crewRequired > 0.
- [ ] glTF export contains named nodes `Hull`, `Mast_1..3`, `Sail_*`, `Rudder`, and one node per armed mount (assert on parsed glTF JSON).

## C. UI end-to-end (Playwright)

- [ ] Hull select shows 5 presets with thumbnails; selecting Frigate (38) opens designer.
- [ ] Beam slider changes rendered hull width (compare two screenshots' bounding boxes) and updates displacement readout.
- [ ] Clicking the quarterdeck mount opens the modal; setting 32 lb carronades updates broadside weight readout and renders gun meshes.
- [ ] Modal port/starboard counts work independently; "match sides" syncs them; setting port-only produces a nonzero static list readout and a visible heel in the orbit view.
- [ ] Total cost readout updates when changing timber species, gun pattern, and copper sheathing.
- [ ] Timber species → live oak increases displacement readout.
- [ ] Export JSON downloads a file that parses and validates.
- [ ] Launch enters sea trial; Return to dock preserves all design state.
- [ ] Setting sails from furled animates over ~2 s (two screenshots differ in sail geometry).

## D. Demo script 1 — "The Frigate" (screenshots, agent-verified)

Build Frigate (38), standard everything, Nelson chequer, coppered. Launch. Wind 15 kn on the beam, set courses + topsails.
- [ ] Ship floats with waterline near the painted line; gunports clear of water.
- [ ] Ship heels visibly but modestly to leeward and holds course; forward wake visible.
- [ ] Furling topsails reduces heel within a few seconds.
- [ ] It looks *good*: agent confirms profile screenshot is something you'd put in a store page.

## E. Demo script 2 — "The Abomination" (screenshots, agent-verified)

Build Sloop, minimum beam, over-canvased sail plan, long 32s on every mount, heavy bulwarks, Baltic fir. Launch. Wind 25 kn on the beam, set everything.
- [ ] Derived stats already warn the story: GM readout near zero or negative before launch.
- [ ] Ship heels past its vanishing point and capsizes within ~20 s without any scripted trigger; masts reach the water; hull settles/fades below waterplane.
- [ ] Repeat with beam slider at maximum instead: ship survives but wallows (roll period visibly long, turns sluggishly).
- [ ] Variant 3, "The Lopside": Frigate (38), standard hull, every battery loaded port-only. At the dock the derived stats show a static list; at launch in calm water the ship visibly lists to port with gunports near the water. Add 20 kn wind onto the port beam: ship goes over. Screenshots verify the list is readable before the wind and the capsize after.
- [ ] Capsize sequence screenshots are legible and funny: this is the money shot; verify it reads clearly at a glance.

## F. Hands-free protocol (for the record)

- [ ] SPEC.md, CLAUDE.md, ACCEPTANCE.md are the only human-written artifacts in the repo.
- [ ] Every code and test file is agent-authored; human inputs after kickoff limited to "continue", "revert and retry", or nothing.
- [ ] DECISIONS.md logs every judgment call made where SPEC.md was silent.
