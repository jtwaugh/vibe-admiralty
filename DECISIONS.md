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
