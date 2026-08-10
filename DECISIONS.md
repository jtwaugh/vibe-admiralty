# DECISIONS.md

Judgment calls made where SPEC.md is silent. One line of rationale each.

## Hull geometry

- **`keelLength` is treated as overall hull length on the baseline**, not the
  rabbet-to-rabbet keel. SPEC gives one longitudinal parameter and the stations
  must span the whole hull; a separate overhang parameter would be scope creep.
- **`depthOfHold` is baseline (top of keel) to the lowest gun deck.** SPEC does
  not define the datum; measuring from the baseline keeps every height in one
  coordinate system, which rule 4 (one source of truth) demands.
- **`freeboard` is weather deck to the top of the rail**, i.e. bulwark height.
  The alternative (deck above the waterline) is circular, because the waterline
  is a solved quantity and hull parameters must be independent of loading.
- **Decks are stacked at a fixed 2.3 m spacing**, and a weather deck always sits
  one spacing above the topmost gun deck. Historically plausible and it keeps
  `deckCount` the only deck parameter SPEC asks for.
- **Maximum breadth sits at u = 0.52** (just forward of midships) and the sheer
  low point at u = 0.42, matching period practice.
- **Section shape is a superellipse below the point of maximum breadth** with
  the exponent driven by a fullness term, and a tumblehome curve above it. This
  gives one smooth family covering fine V ends and full boxy midships.

## Hydrostatics

- **Water density is a parameter defaulting to 1025 kg/m^3** (sea water). The
  analytic barge cases in ACCEPTANCE §A quote a 2.5 m draft for 1000 t on a
  40x10 m box, which is only exact in fresh water, so those tests pass 1000.
- **Draft is reported as the depth of the deepest hull point below the
  waterplane**, which equals the waterline height above the baseline when the
  ship is upright and stays meaningful when heeled.
- **Trim is solved once upright and then held while heel is scanned.** Solving
  trim at every heel angle costs an order of magnitude more work and moves the
  transverse righting arm negligibly; this is also standard practice for GZ
  curves. The returned equilibrium state is re-solved with free trim.
- **GM is taken as the symmetric difference of GZ either side of upright**,
  which cancels the constant arm produced by a laterally offset centre of
  gravity, so GM stays meaningful for an asymmetrically armed ship.
- **Equilibrium heel is the root of (righting moment - heeling moment) nearest
  upright with the net moment rising through zero.** No equilibrium in
  +/-88 degrees is reported as capsize; nothing about capsize is scripted.

## Mass and cost model

- **The framing factor is per timber zone, not one global number.** A wooden
  warship's floors, futtocks and keelson are concentrated low, so multiplying
  deck planking and bottom planking by the same figure put the centre of
  gravity far too high and left every hull tender.
- **Ballast and stores are preset data**, tuned so each preset lands in a
  historically plausible band for displacement, draft and GM rather than being
  derived from a formula.
- **Gun crews are counted for the larger broadside only**, since a crew serves
  one side at a time; this is what makes an asymmetric ship cheap in men.
- **Hull yard cost is a flat per-preset figure** standing for labour, fastenings
  and fitting out; timber, rig, copper and guns are computed from the model, so
  species and scantling changes move the total on their own.

## Physics beyond the letter of SPEC

- **Buoyancy stops at the weather deck.** Bulwarks are pierced by scuppers and
  gunports and hold no water. Without this the hulls are sealed boxes, and a
  hull taller than it is wide has a righting arm that never vanishes, so no
  ship could ever capsize.
- **Openings end the stability range.** Gunport sills are emitted as sockets;
  a heel that puts one under water is rejected as an equilibrium, because the
  ship is downflooding. This is a physical rule about an open ship, not a
  scripted capsize: the solver still finds equilibria purely from the station
  clipping, it just will not accept one that is under water.

## Phase 2: the designer

- **Two screens, and Launch is disabled until phase 3.** SPEC §3 describes three
  views; shipping a stub sea trial would be a fake feature, so the button is
  present, disabled, and labelled as opening in phase 3.
- **Panel groups are collapsible, with Hull and Ordnance open.** Five open
  groups plus the mount list overflow the panel on a laptop; these two are the
  ones a player touches first.
- **Mounts are reachable two ways: a marker on the hull and a row in the panel.**
  SPEC §3 asks for raycast markers on real geometry, which is what the rings
  are, but an invisible-until-hovered target is unusable by keyboard, so the
  panel mirrors them.
- **Every mount carries a marker on both sides of the ship**, and only the one
  facing the camera gets a hit area. A single starboard marker would be
  unreachable whenever the orbit camera looked at the port side.
- **A gun's socket is the centre of its port on the shell**, and both the mesh
  and the mass model work inboard from there by the gun's own length: a long 32
  stands much further inboard than a 32 lb carronade. Before this the sockets
  were a fixed 0.55 m inboard and every muzzle stood two metres clear of the
  side.
- **`staticListDeg` exports as 90 when no equilibrium exists.** JSON has no NaN,
  and `capsizesAtRest` beside it says what really happened.
- **glTF is exported as JSON in ship-local coordinates with the baseline at
  y = 0**, and mount markers, being invisible, are skipped by the exporter.
- **`shipwright.schema.json` is generated from the zod schema** by
  `npm run schema`, and a unit test fails if the checked-in file drifts. Two
  hand-maintained copies of one contract would disagree within a week.
- **Figureheads and stern galleries are modelled, not just weighed.** SPEC §5
  lists them as cosmetics, and a cosmetic that cannot be seen is not one.
- **Fore-and-aft sails are laid out on the rig, and their centre of effort is
  the centroid of the cloth.** Before this the drawn jib and the jib the wind
  pushed on were in different places, which is exactly the second source of
  truth rule 4 forbids.

## Rendering

- **The broadside camera is a 13-degree lens placed below the rail.** An
  orthographic camera reads as a true elevation but leaves a flat sea edge on,
  so the whole underwater body shows through; a camera above the rail looks
  down into the ship over her own bulwark. Sitting the eye below the rail and
  well above the water gives an elevation-like read, hides the interior, and
  lets the sea occlude the bottom.
- **The paint scheme is a drawn texture, not vertex colours.** The shell's v
  coordinate has the sheer subtracted before normalising, so a band drawn at a
  constant v follows the sheer line the way a painted strake does, and the
  strakes stay crisp.
- **The stem and transom are separate joinery, not station geometry.** Raking
  them would make the stations non-planar and break the rule that one set of
  station curves drives mesh, physics and sockets.
- **Joinery is built as swept solids, never as two coincident faces.** The stem
  was a ribbon with a front and a back face on the same vertices; their normals
  cancelled and the whole piece rendered unlit, which is why the frigate looked
  as though her bow had been sawn off.
- **The sea takes no shadow.** A shadow map stretched over a six-kilometre plane
  at a grazing sun angle streaks and shimmers, and open water would not hold a
  hard shadow anyway. The ship still shadows herself.
- **The camera frames the ship from her stern to her bowsprit end**, not from
  her stem. Framing on the hull alone cropped the bowsprit off the picture, and
  cropped it out of the screenshots the e2e suite measures.
- **Hull thumbnails share one WebGL context**, rendered one per frame. Five live
  canvases would burn five contexts, and browsers only grant a handful.
