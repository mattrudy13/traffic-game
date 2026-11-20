# Road network plan

Status: Stages 0, 1 and 2 done (2026-11-19); Stage 3 done except Suburb's curved streets (2026-11-20). Stage 1 was built on branch `stage-1-network`: sim.js
drives on the network from `maps.js` and `network.js` (1a) and game.js draws from it (1b); all
tests pass, `baseline.json` is re-saved and the capacity marks re-measured (see "Stage 1a result"
and "Stage 1b result" below). The engine before it was removed once `network-test.js` had a
snapshot (`network-baseline.json`) recorded while the network still matched it. Stage 2 (branch
`stage-2-suburb`) gave Suburb T-junctions and cul-de-sacs; one-way streets moved to Stage 3 (see
"Stage 2 result"). Stage 3 (branch `stage-3-curves`) added curved and angled roads, one-way
streets, Riverside and Old town (see "Stage 3 result"). Next: Suburb's curved streets, then Stage 4. Replaces "every road is a straight line from one edge of
the map to the other" with a real network of nodes and roads, so maps can have T-junctions, dead
ends, one-way streets, curves, diagonals and a highway with ramps.

## Decisions so far

| Question | Decision |
|---|---|
| Road features in v1 | T-junctions and dead ends, one-way streets, curves and diagonals, a highway with ramps |
| Existing places | Port all four (Downtown, Main Street, Suburb, Crosstown) to the new model; small changes to their numbers are fine, then capacity marks and README tables get re-measured |
| Gridlock | Generalize today's rule: each road segment gets a "distance to exit", and a car may only move onto one with a smaller value |
| Map format | Hand-written data, in the format an editor would save later |
| Dead ends | Cars start there (homes, lots) and drive out; nobody drives in |
| New maps | Interchange, Riverside, Old town, and an upgraded Suburb |
| Delivery | Staged; each stage ships on its own and leaves everything playable |
| Challenge mode | Ported with behavior unchanged; no new features for it |
| Suburb layout (Stage 2) | "Streets and courts" from the mockups: quiet streets off the through roads at T-junctions, six cul-de-sacs off them |
| One-way streets | Moved to Stage 3 with Old town. Cars only turn onto roads that lead straight out, so a one-way street in Suburb would only carry cars that start on it |
| Cul-de-sac drivers | Count like everyone else in the average wait, "waiting to enter" and give-ups |
| Riverside layout (Stage 3) | "Meander" from the mockups: the river winds across the middle, a curving bank road each side, one avenue bridge with a light at each end, diagonal streets to the edges |
| Old town layout (Stage 3) | "Split round the square": the west-east road splits into a one-way pair (one lane each) round the market square between two small roundabouts; a short main street with the only two lights crosses it |
| Place picker | Six buttons, same as before: one row on desktop, three rows of two on a phone |
| Old town's day | Busy from mid-morning to evening, small rush hours |
| Turning on the new maps | Riverside and Old town (`turns: 'through'`) let cars turn onto any road that runs straight on to the edge, so bank roads feed the bridge and the main street feeds the one-way pair. The four older places keep the stricter rule and their numbers |

Assumed (say if wrong): the world stays 1280 × 680 and scales to the screen as now (no pan or zoom);
traffic keeps right; Stadium and Construction stay Downtown-only; buses run only on avenues.

## What changes, and why it's big

Today (sim.js):
- A road is `{axis, c, half, avenue}`: a horizontal or vertical line across the whole map.
- A lane is one direction of one road, `s` px from the edge it enters at; `lanePoint` turns `s` into x/y.
- Stops are worked out by crossing every road with every other; a crossing's key is `"x,y"`.
- Who may enter a crossing is hand-written per case: `light.axis`, `busy.ns/ew`, `leftIn[dir]`,
  `throughIn[dir]`, `OPPOSITE`, `LEFT_OF`/`RIGHT_OF`. All of it assumes four arms at right angles.
- Gridlock is impossible because turns only lead onto lanes that run straight out of the city.

Nearly every function in sim.js leans on one of these, so stage 1 is a rewrite of the sim's core,
not an addition. The drawing in game.js changes as much (roads are drawn as full-width lines today).

## The new model

### Map data (hand-written, editor-ready)

```js
{
  nodes: {
    w1: { x: 0, y: 420, type: 'edge' },               // cars enter and leave here
    a:  { x: 380, y: 420, control: 'light' },          // light | stop2 | stop4 | round | none
    cul: { x: 520, y: 120, type: 'source', weight: 0.4 }   // dead end: cars start here
  },
  roads: [
    { from: 'w1', to: 'a', kind: 'avenue', lanes: [2, 2] },         // [forward, back]
    { from: 'a', to: 'b', kind: 'street', lanes: [1, 0] },          // one-way
    { from: 'b', to: 'c', kind: 'street', lanes: [1, 1], curve: [[620, 300]] },  // bends through a point
    { from: 'h1', to: 'h2', kind: 'highway', lanes: [2, 2], level: 1 }           // a bridge: no crossing
  ]
}
```

Places become data like this. Downtown's 1/2/4/6 grids become a small function that writes it.
Challenge mode's road schedule becomes roads with an `opensAt` time.

### At run time

- **Link:** one lane of one road between two nodes, with a sampled path (points, headings, distance
  along it). The roundabout code already does this (`makeRoundPath`, `pathPoint`), so it becomes the
  general case. A car keeps `s` = distance along its link, as now.
- **Node:** its arms (incoming and outgoing links, sorted by angle), a stop line per incoming link, and
  its **movements** (incoming link → outgoing link), each with a path through the box.
- **Conflicts from geometry:** two movements conflict if their paths pass within a car width (plus a
  margin) of each other, unless they share their start lane (follow) or end lane (merge, handled by
  join spacing). This is worked out once per node and replaces the hand-written `busy`/`leftIn`/
  `throughIn` rules. A car may enter when no conflicting movement has a car in the box, and, for a
  movement that must yield, none is arriving within the gap time. Today's left-turn gap rule becomes
  one case of "this movement yields to those".
- **Lights:** a light runs **phases**: groups of movements that may go together, generated from the
  arms (4-way: two phases plus left arrows; T-junction: two or three). Smart, Timer and Green wave
  work on phases instead of axes. Smart counts cars waiting per phase.
- **Signs and roundabouts** carry over: two-way stops name their major arms; all-way stops keep their
  queue; roundabouts take arms at any angle (their path code already works from headings).
- **Bridges:** roads at different `level`s don't make a node where they cross; drawn in level order.
- **Ramps:** a merge node (two incoming, one outgoing): the ramp yields to the main road, and zippers
  when both are slow. A diverge node (one incoming, two outgoing) has no conflicts.
- **Lane changes** stay between sibling links on the same road. On a curve, siblings have different
  lengths, so a car's position moves over in proportion (s × other length / this length).

### Gridlock rule, generalized

A car may take a movement only if it leads to a link with a smaller `d` (distance to exit) than the
one it's on.

Why that can't jam: a jam is a loop of cars, each waiting for space the next one holds. Every move
makes `d` smaller, so following "who waits on whom" around a loop, `d` would have to keep getting
smaller and still come back to where it started, which is impossible. That holds for any `d`, so the
work is choosing `d` so the moves people expect are allowed.

Changed while building (2026-11-19): the first plan was `d` = shortest driving distance to an exit.
That forbade going straight on past an avenue's first light, since turning off there is a shorter
way out. So the allowed moves are picked first and `d` is measured over them (`buildDistances` in
network.js):
1. going straight on;
2. turns onto a road that runs straight out of the map, and every way off a roundabout (today's
   rules, so Stage 1 matches today's traffic);
3. only for a road side with no way out at all (a T-junction's stem, Stage 2), its other turns,
   shortest way out first.

Each is added only if it doesn't let a car come back to where it was. `d` is then the longest allowed
drive to the edge, so every allowed move lowers it. `network-test.js` checks the allowed turns match
today's exactly. The cost is still that cars can't drive around a block or into a dead end. That
suits "cars start at dead ends and drive out". Trips with destinations would need reservations
instead, so the rule lives in one function that can be swapped later.

"Don't block the box" stays as it is: every link has a capacity (cars that fit), and nobody enters a
node without a guaranteed space on the link they're heading for.

### Sources

Edge nodes and dead-end sources both spawn cars. Each source keeps its own random stream, and each
car its own, as now, so compare mode still gets the same cars on both maps. Dead-end sources follow
their own day curve (mostly morning departures).

### Drawing

Roads are drawn as stroked paths at their width (lane dashes along each path), junction boxes as
polygons from the arms' edges, stop lines and teeth along each incoming link's stop line, and bridges
over everything at a lower level. Lights stay round chips at the node. Phones held upright still
rotate the whole canvas, so nothing special is needed there.

## Stages

Each stage ends with the tests passing, a playable game, a commit, and README updates. Each stage
that adds a map starts with mockups (desktop and phone, 2 to 4 options) before any drawing code.

**Stage 0: safety net (small). Done 2026-11-19.** Running the overlap check on every place found
cars colliding at stop signs and roundabouts in all three new places; fixed before saving the
baseline (see README, Places).
- `node test.js` runs every test script.
- Record a baseline: for each place and strategy, trips, average wait and give-ups per seeded day,
  saved as JSON.
- Add an overlap and stuck check that runs on every map, not just Downtown.

**Stage 1: new engine, same maps (large; likely several sessions).**
- 1a: the map format, links, nodes, movements, geometric conflicts, phases, distance-to-exit rule, and
  sources. Port Downtown (1/2/4/6), Main Street, Suburb, Crosstown, and challenge mode's schedule.
- 1b: drawing from the network (roads as paths, junction polygons).
- Done when: all tests pass; nothing freezes; compare still matches cars exactly; each place's
  baseline numbers land within about 10%; the challenge bot (`tune.js`) survives about as long as
  before; capacity marks re-measured.

**Stage 1a result (2026-11-19).** Trips and the challenge bot's survival match the old engine
(survival 339 / 338 / 217 s, was 336 / 308 / 214). Waits came out 5–50% lower (Downtown 4 Smart
16.3 s to 9.2 s; Crosstown Smart 25.1 s to 17.6 s), so the baseline was re-saved on purpose. Why:
the old box rules were by axis. A car that had just turned counted as cross traffic until its rear
left the box, which held the next car following it round the same corner. The opposite left turns
off an avenue also couldn't go together outside an arrow. The new rules only hold a car for
movements whose paths actually meet. With the old rules copied back in, Downtown came back to
within ~10% of the old baseline, which is how the cause was confirmed. The overlap test finds no
collisions. One strategy ranking changed: on Crosstown, Smart went from worst to best. Other
changes: any avenue light can show left arrows (adds one at Crosstown), and the extras test's
"bus or ambulance stuck" limit went from 200 s to 300 s (the old engine reached 254 s on other
seeds at that traffic).

**Stage 1b result (2026-11-19).** game.js draws roads as strokes between junctions, junction
boxes as polygons from the arms' edges, and every marking (stop bars, stop lines and octagons,
yield teeth, hatched closed lanes, construction, bus stops, danger glow, edge badges) along its
lane's path. Checked side by side with main's version on every place, day and night, desktop and a
375 px phone: they match. `capacity.js` re-measured the slider's capacity marks and the README's
strategy table; run on the old engine it reproduces the old marks (one cell off by 10), so the
method matches. New marks are 5-20 higher, except Crosstown (55 to 50 on every strategy).

**Stage 2: T-junctions and dead ends (medium). Done 2026-11-19.**
- Still straight roads.
- T-junction phases and stops, and dead-end sources with their own day curve. (One-way links moved
  to Stage 3.)
- Map: Suburb, first pass, with cul-de-sacs and T-junctions in place of some crossings.

**Stage 2 result (2026-11-19).** Suburb is the first hand-written map (`suburbMap` in maps.js): 9
T-junctions, 6 cul-de-sacs, the roundabout, 7 ways in from the map edge (was 10). A cul-de-sac is a
`deadend` node; its road has only the lane out (`lanes: [1, 0]`) and its link is a `home` source on
its own day curve (`HOME_TRAFFIC` in sim.js). Nothing new was needed for T-junctions: the
"no way out" tier of the distance-to-exit rule already handles a stem, and conflicts, yields and
all-way stop groups work from geometry. Two things did need changing, both at two-way stops:
- A main-road car standing at the line no longer blocks the side road when "don't block the box"
  is holding it (its road ahead is full).
- After 60 s at the line, a side-street car gets let in by a main-road car stopped in a queue.
  Without these, the east street's left turn into the roundabout's queue starved for over 5 minutes
  at rush hour (places-test's 300 s limit). With let-in at 15 s or 30 s Suburb's capacity mark fell
  to 75 or 70; at 60 s it stays at 80.
Tried and dropped: allowing only a stem's shortest way out (capacity 65: it piled every stem onto
one crossing), and merging the two T-junctions on the north-south road into one crossing (worse:
straight-across traffic had to cross both directions of a queued main road).
Numbers: Suburb wait at slider 45 went from 6.7 s to 9.8 s, with no give-ups (a trip from home
passes more stop signs); capacity mark 80, unchanged. Main Street improved: waits 8.1/7.6/6.8 s to
7.8/6.8/6.5 s and capacity marks 70/60/60 to 75/75/80. Every other place is unchanged.

**Stage 3: curves, diagonals and one-way streets (medium to large).**
- One-way links (moved from Stage 2), used by a one-way pair in Old town that carries through traffic.
- Curved and angled road paths, lane changes on curves, and junction boxes at odd angles.
- Maps: Riverside, Old town, and Suburb's curved streets.

**Stage 3 result (2026-11-20).** Done except Suburb's curved streets, left for a short round of
its own. In network.js a road may bend through `via` points (a Catmull-Rom curve, `before`/`after`
carrying it smoothly through junctions; `chain` in maps.js fills these in), its lanes are offset
copies of the curve, and each link has a start and an end heading. Arm angles, box setbacks, turn
paths, groups and phases already worked from angles, so odd-angle junctions needed nothing more;
"straight on" between curved roads is a short Hermite bend so it starts on the lane's heading.
One-way streets are lanes [n, 0] with `oneway`, drawn narrower with arrows. Lane changes on a bend
keep a car's place in proportion, though no Stage 3 map has a curved multi-lane road yet. game.js
draws roads along their curves, plus a river, bridge railings and the square (`scenery`), turns the
light's arrow to its phase's road, and places waiting badges beside angled entries.
Two things turned up:
- With today's turning rule nobody could turn onto Riverside's bridge or into Old town's one-way
  pair, so those two maps use the looser rule (decisions table).
- A roundabout with no exit straight on stranded a car that had picked "straight"; cars now pick
  among the exits that exist (without using more random numbers on the older places).
Riverside's east stop sign was moved away from the bridge: with room for only 5 cars before the
bridge light, evening queues reached the map edge and drivers gave up at slider 45.
Numbers at slider 45 (Smart / Timer / Wave): Riverside waits 9.9 / 16.9 / 15.7 s, capacity marks
65 / 55 / 55; Old town waits 11.6 / 14.2 / 15.6 s, capacity marks 60 / 60 / 60. Every older place
and the challenge are unchanged (baseline and network snapshot match).

**Stage 4: highway, bridges and ramps (large).**
- Bridge levels, merge and diverge nodes, highway speeds, and ramp meters left out unless needed.
- Map: Interchange.

## Risks

- **Geometric conflicts get it wrong:** cars would drive through each other, or wait for no reason.
  The overlap test, run on every map, catches the first; baseline waits catch the second.
- **New deadlocks.** Building signs and roundabouts turned up three that only showed after hours of
  game time. The stuck check runs on every map and every stage.
- **Smart on unusual nodes.** Comparing waiting cars per phase on a T-junction or a five-arm node
  hasn't been tuned. Expect a tuning pass.
- **Performance.** Conflict checks per car per step. Precomputed tables per node should keep it cheap.
  Watch frame time on a phone at 4×.
- **Space on a 1280 × 680 map.** Interchange may be cramped. If so, pan and zoom becomes a follow-up
  rather than squeezing the map.
- **Scope.** Stage 1 touches most of sim.js (about 1,800 lines) and the drawing half of game.js. It's
  the stage most likely to take longer than planned. Stopping after it still leaves a sounder engine.
