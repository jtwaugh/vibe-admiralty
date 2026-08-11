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

## Sea trial (phase 3)

- **Sails are flat plates trimmed to bisect the apparent wind**, and each rig
  has a limit on how close to the centreline it can be braced (`minTrimDeg` in
  `sails.json`). Nothing else was needed to make a square rigger sail badly to
  windward and a headsail lie closer: at 25° off the bow the courses are aback
  and the jib still draws, and both fall out of the same formula.
- **A sail taken aback is not a special case.** The angle of attack goes
  negative, the force reverses, and she is pushed astern with the cloth
  bellying the wrong way. Special-casing it would have hidden a real behaviour.
- **The rig carries a heel-induced yaw couple.** Without it the model had lee
  helm: the centre of effort sits forward of the centre of lateral resistance,
  so with the helm amidships she bore away 70° in ninety seconds. Once she is
  over, the drive acts to leeward of the hull's drag and the couple swings her
  bow up into the wind. Adding it is what makes her hold a course, and it is
  the reason a hard-pressed ship rounds up.
- **The centre of lateral resistance is the centroid of the submerged profile**,
  taken from the station keel line, not a constant. It was a magic −0.03 L.
- **The righting arm is sampled once at launch and interpolated.** Solving the
  waterplane afresh sixty times a second costs far more than a hundred-and-one
  point curve, and the design cannot change during a trial.
- **She is launched upright and at rest, never at the answer.** A ship with her
  guns all to port rolls down into her list on camera; one with no stability
  keeps going. Starting her at her resting heel would be scripting exactly the
  failure states SPEC §7 says must emerge. The cost is that a perfectly
  symmetric ship with negative GM would balance on a knife edge in a dead calm;
  any wind or any asymmetry breaks it, and both demos have wind.
- **What kills these ships is the lee gunports, not the righting arm.** A sound
  frigate's arm never vanishes inside 100° of heel; she dies because the ports
  go under, she fills, and the water she takes lies to leeward and holds her
  there. Flooding is modelled as orifice flow through however many ports are
  under, and it feeds back as weight, sinkage and a heeling moment.
- **Roll damping and yaw damping both climb steeply with beam**, per SPEC §7's
  "extreme beam wallows (high roll damping, sluggish yaw)". Bilge and eddy
  damping really do grow that way, and a bluff beamy section sheds far more
  water when the hull swings. The wide sloop turns in 5.2 of her own lengths
  where the standard one turns in 3.7.
- **Surge alone runs on a compressed time constant.** A fifteen-hundred-ton ship
  really does take three or four minutes to gather way from rest, which is
  unwatchable in a widget. Heel, the hydrostatics and every failure state are
  integrated at real time, and they are what the acceptance tests measure.
- **"Wind onto the port beam" in ACCEPTANCE E is taken to mean the wind presses
  the list deeper**, i.e. it blows on the side she is already down. The other
  reading rights her, and there is no capsize to photograph.
- **Twenty knots does not capsize the Lopside frigate, and the model was not
  bent to make it.** Her list is 3.4°, a beam wind of 20 kn takes her to 11°,
  and her lee ports are still six feet clear of the water. She goes over when
  the wind is strong enough to bury them, which for this hull is about 50 kn.
  The demo shows both: the readable list under 20 kn, and the squall that
  finishes her.

## Rendering the sea trial

- **The dock keeps its flat water; only the trial gets the real ocean.** The
  designer view is meant to read like an elevation, and the e2e tests read the
  ship's outline straight off the canvas by assuming the background is one
  colour across any given row. A shader sea at the dock would buy nothing and
  break that.
- **The ship moves through the world and the sea is recentred under her.** The
  waves are a function of world position, so the swell does not swim along with
  her, and the wake is laid down along the track she actually sailed, which
  means it curves when she turns.
- **The flat water beyond the wave grid sits four metres down.** Level with the
  sea it sliced up through the troughs and scattered hard-edged dark facets over
  the swell. At that distance the step is a tenth of a degree and fog has it.
- **Sails are built flat and carry their own full-belly shape as an attribute.**
  The vertex shader interpolates between the two from one uniform per sail, so
  the billow is exact at both ends, extrapolates the right way when a sail is
  aback, and needs no calculus. Each sail has its own material because the wind
  is not the same on all of them.
- **The yards are braced to the trim angle the wind model computed.** They were
  drawn square while the physics pushed on a braced sail, which is exactly the
  second source of truth rule 4 forbids. The yard now hangs inside its sail's
  contract node so one rotation turns spar and canvas together.
- **Canvas casts shadows but does not receive them.** The cloth is displaced by
  its billow in the vertex shader and the shadow pass is not, so the whole rig
  came out speckled with shadow from its own flat depth image.
- **The sea trial's eye stands abaft the starboard beam, where the sun is.**
  From ahead the sails are edge on and lit from behind and the rig reads as grey
  card. It also drops and comes level as she goes over, because a ship on her
  beam ends is a long low thing and the money shot was otherwise a speck at the
  bottom of the frame.
- **There is a fill light off the water.** Without it the side of the ship the
  sun is not on went to a flat near-black and half of every orbit was dead.
- **The demos put the wind on the port beam** so she leans towards the camera:
  a list away from the eye foreshortens itself into nothing. The Lopside is the
  exception, and its demo drags the camera round to her lee side instead.
- **The hull rides the swell but is not pushed by it.** SPEC §7 keeps waves out
  of the forces; the heave and the wave-driven tilt are read from the same wave
  sum the shader runs and applied to the drawing only, so she sits in the water
  rather than on it.

## Where the physics disagrees with ACCEPTANCE.md

Two of the demo-two boxes describe behaviour the hydrostatics do not produce.
The model was not bent to make them true; both are recorded here instead.

- **"Roll period visibly long" at extreme beam does not follow.** Beam is what
  gives a hull its metacentric height, and a stiff hull has a *short* roll
  period, not a long one. Measured: the wide sloop (beam 11.2 m, GM 1.83 m)
  rolls with a period of 7.9 s and is back inside two degrees five seconds after
  a fifteen-degree displacement; the standard sloop (beam 8.6 m, GM 0.70 m)
  takes 9.0 s and ten seconds. What the wide hull does do is everything else
  SPEC §7 asks of her: she is nearly dead-beat in roll, she lies over at a
  steady ten degrees under all plain sail and never stands back up, and she
  turns in 5.2 of her own lengths where the standard sloop turns in 3.7 and
  comes round only 22° in twenty seconds of full helm. That is a wallow; it is
  not a long roll period, and no honest hull will give both.
- **Twenty knots does not capsize the Lopside, and her gunports are not near
  the water.** Every battery to port gives a frigate a 3.4° list, which puts
  her lee sills 2.7 m clear; twenty knots on that side takes her to 10° and
  about 2 m clear, and she holds it indefinitely. She dies at about 50 knots,
  when the sills finally go under and she fills. The demo therefore shows both:
  the list at rest and under 20 kn, and then the squall that actually finishes
  her. Making 20 kn enough would have meant either a frigate with no stability
  or a wind model that lies.
