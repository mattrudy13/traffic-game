# Green Wave

A little traffic simulation. Cars cross a city grid of side streets and four-lane avenues,
turning and changing lanes, and the lights switch themselves, giving way to whichever side has
more cars waiting.

- **Chill (default):** nothing to lose. A day passes every 6 minutes (at 1×), with a morning
  and evening rush hour and a quiet night when the map dims to lamplight and cars get headlights.
  The controls sit in three tabs: **Lights** (1, 2, 4 or 6 lights, how they decide: Smart, Timer or
  Green wave, and left arrows), **Traffic** (how busy the city is, and what kind of day it is:
  see Traffic kinds) and **Weather & extras** (weather, buses, send an ambulance: see below).
  Speed (1×/2×/4×) stays beside the tabs. Click any light to switch it yourself; the strategy leaves
  it alone for 8 seconds. The strip shows the average wait per trip and a chart of it. Settings
  are remembered.
- **Compare:** two copies of the city side by side, each running its own lights (Smart, Timer
  or Green wave, arrows on or off), with exactly the same cars arriving on both. See below.
- **Challenge:** the lights are all yours. If a queue backs up off the edge of the map, it's
  gridlock and the game ends. New roads open over time and traffic gets heavier.

## Play

Live at https://mattrudy13.github.io/traffic-game/ , or open `index.html` in a browser. There's no
build step and nothing to install.

On a phone held upright the whole city is drawn a quarter turn, so it fills the screen; a slim
bar shows the time, cars, average wait and pause, and **Controls** opens a pull-up sheet with the
rest. Turned sideways, the map stays the normal way round with the same slim bar.

## Files

- `sim.js`: the rules (roads, lights, car movement, spawning, losing). No drawing.
- `game.js`: draws the map on a canvas, handles clicks, the score strip and the start/pause/game-over card.
- `style.css`: the "transit map" look (paper, ink, Archivo + IBM Plex Sans).
- `tune.js`: a bot that plays many challenge games in Node so the difficulty can be checked: `node tune.js`.
- `freeze-test.js`: runs every chill setup for two game days to check nothing ever gridlocks: `node freeze-test.js`.
- `overlap-test.js`: checks no two cars are ever drawn on top of each other (turns, lane changes): `node overlap-test.js`.
- `compare-test.js`: checks compare mode's two cities really get the same traffic: `node compare-test.js`.
- `extras-test.js`: runs weather, buses and ambulances on every layout and strategy and checks nothing gridlocks, buses stop, no bus or ambulance spends over 200 s on the map, and compare maps still match: `node extras-test.js`.
- `kinds-test.js`: runs every traffic kind on every layout and checks nothing gridlocks, no car drives on the closed lane, and the stadium crowd shows up: `node kinds-test.js`.

## How the cars move

Each car looks at the closest thing it must not pass: the car ahead, or a stop line
whose light isn't green for it. A car going at speed `v` needs `v² / (2 · brake)` to
stop, so the fastest it can safely go with `room` px of space is `sqrt(2 · brake · room)`.
Every frame the car speeds up toward that (limited by `accel`) or drops to it at once.

Two traffic rules keep the grid from locking up:

- **All-red:** after amber, both directions get red for a moment so cars already in the box clear out.
- **Don't block the box:** a car only crosses the line if a space is free for it between this
  intersection and the next one. (An earlier version only looked at the car ahead; at heavy
  traffic four cars got stranded in boxes around a block, each waiting on the next, and the
  grid froze for good. That's real-world gridlock, and the stricter rule rules it out.)

## Turning

In chill mode about 35% of cars turn at each light where a turn is allowed (15 left : 20 right),
blinking their signal on the way in. They slow for the corner and follow a curve through the
box onto the cross street. Left turns wait at the line for a gap: nothing oncoming in the box and
nothing arriving within 2.5 s. A left-turner already waiting may finish on amber, like real drivers.
Opposing left turns go one at a time. The challenge mode stays straight-only.

Cars only turn onto a street that leads straight out of the city. With turns allowed everywhere,
the four streets around a block could all fill up while each front car waited to turn into the
next full one: a circular wait, and the grid froze for good. Straight driving always heads toward
an edge, so if turns do too, no street can end up waiting on itself.

## Avenues

In chill mode the east-west roads are avenues: two lanes each way split by a median, about 20%
faster than the side streets. Left turns go from the inner lane and right turns from the curb
lane, so a car that wants to turn signals and moves over first (if it can't before the light, it
goes straight). Cars also change lanes to pass, usually around a waiting left-turner or into a
shorter queue. A lane change needs a real gap (the car behind must be able to brake) and, past a
light, a free space in that lane's stretch, the same bookkeeping as "don't block the box", so it
can't cause gridlock. While a car slides over it still counts as being in both lanes.

## Left-turn arrows

Avenue left turns get a protected arrow. When the light is about to give the avenue green and
someone in a turn lane has been stopped for at least 6 seconds, it first shows a green arrow: the
light's ring goes green with a turn-arrow icon and only the inner (turn) lanes' stop lines go
green. Both directions turn at once; their curves bend early so they pass beside each other. Smart
lights end the arrow once the queue has cleared (2 to 8 s); Timer and Green wave give it 4 s.
After it, the normal green follows and lefts still go on gaps.

The trade-off, measured over a game day: arrows cut the worst left-turn waits a lot (6 lights,
rush hour: longest 224 s down to 75 s, 90th percentile 71 s down to 48 s) but everyone else waits
a few seconds longer on a typical trip. Triggering on any waiting left-turner instead of 6 s
cost everyone much more. The **Left arrows On/Off** switch in the controls flips them live, so
you can watch the average-wait chart move.

## Light strategies

- **Smart:** a light switches when more cars wait on the red side (green lasts 3–20 s).
- **Timer:** 10 s each way, every light on its own random offset.
- **Green wave:** same 10 s / 10 s cycle, but each light's east-west green starts later the further
  east it is, by the time a car needs to drive there. Eastbound groups hit green after green.
  At rush hour on 6 lights it beats Smart (about 5 s vs 6.5 s average wait).

## Traffic kinds

The **Traffic** tab picks what kind of day it is. Picking one starts the day again (both maps, in
compare mode, where it is shared so the race stays fair).

- **Normal:** two rush hours; some streets are busier than others.
- **Commute:** the same day, but in the morning most avenue traffic heads east "into town" (about
  2.5× as many eastbound cars, 0.4× westbound at the peak) and in the evening it flips.
- **Stadium:** a slightly quieter day, then a night game lets out at 9:30 PM. For about two game
  hours a crowd pours in from the stadium in the north-east block: southbound on the east-most
  street and westbound on the top avenue.
- **Sunday:** no rush hours, light all day, and half of cars turn at each light instead of 35%.
- **Construction:** the lower avenue's eastbound curb lane is closed on the stretch past its first
  light. That stretch has no room at all as far as "don't block the box" is concerned, so straight
  cars in the curb lane merge into the inner lane before the light (waiting at the line for a gap
  if they have to); right turns from it still go. Turns only ever lead onto streets out of the
  city, so nobody can turn into the closed stretch, and the gridlock rules hold.

Arrivals follow the rate as it changes. Each lane counts down in "expected arrivals" (rate × time)
rather than seconds, so a long late-night gap can't hold back the stadium crowd, and moving the
traffic slider takes effect at once.

## Weather, buses and ambulances

The **Weather & extras** tab. In compare mode these are shared, so both maps get the same weather,
buses and ambulances.

- **Weather:** Clear, Rain, Snow, or Changing (a new pick every 4 game hours: about half clear,
  a third rain, the rest snow). Rain means top speeds 85%, acceleration 85% and brakes 75%;
  snow 70%, 65% and 55%. Weaker brakes alone make moving cars keep bigger gaps (the safe-speed
  rule leaves more room). The gap between *stopped* cars stays the same on purpose: the "don't
  block the box" spaces are counted from it, and changing it could strand a car in a box. Rain
  falls as streaks with a sheen on the roads; snow falls as flakes and piles along the road edges.
  Both fall down the screen, even on a turned phone map.
- **Buses** (on by default): one every 40 s each way in each avenue's curb lane. They stop for
  4 s mid-block (the ink squares beside the road are the stops) and cars move over to pass. A bus is
  two cars long, so it takes two spaces in the "don't block the box" count; as one it could squeeze
  into a gap it doesn't fit and get stuck in an intersection. Buses never turn and never change lanes,
  and none run in a closed lane.
- **Ambulances:** one every 45 s or so by itself, or press **Send ambulance**. It goes straight
  across in an avenue's inner lane or a side street, 25% faster than traffic. Within 260 px of a
  light, the light turns green for it and stays green until it's through. Amber, all-red and "don't
  block the box" still apply to everyone, so this can't cause gridlock. Cars just ahead move over on
  an avenue, or ease toward the curb on a side street.

Buses and ambulances aren't counted in the wait numbers or cars through. Their timetables come from
the city's seed, so in compare mode they enter both maps at the same moments.

## Waiting at the edge

When a lane is backed up to the edge, new arrivals queue off the map, and a red "+12 WAITING" badge
shows beside that road (in every mode). A car's wait counts from the moment it arrives, so time
queued off the map is part of its trip.

In chill mode a car that has queued off the map for 120 s gives up and drives off. Its 120 s still
counts as a trip in the wait numbers, and the strip shows how many gave up today. Without this,
traffic above what the city can carry (about slider 60 on 6 lights) would build a queue that grows
every day forever, since the night is too short to clear it. "Today" resets at midnight.

(Earlier versions dropped arrivals past 4 queued, without counting them. That was 7–9% of cars
at slider 50 and over a third at 100, so average waits topped out near 20 s however busy it got,
and the more jammed compare map looked better than it was.)

## Compare mode

**Compare setups** (in the controls; on phones, in the Controls sheet) opens two maps side by side:
map A in blue and map B in orange, each with its own light strategy and left-arrow switch. The
number of lights, speed and traffic are shared. The lights run themselves and can't be clicked, so
neither side gets a human's help. On a phone held upright both maps are turned, side by side.

Under each map: the average wait over the last minute, the worst single trip today and the average
for today, plus which map is ahead on today's average (once both have 20 trips). "Today" starts
again at midnight. The chart draws both maps' last-minute average on one scale (A solid, B dashed).

**Same cars on both maps.** Both cities are built from one seed and step forward together with the
same time steps. Each lane draws its arrival times from its own random stream, and each car its
turns from its own stream (keyed by lane and arrival number), so the 12th car on a lane arrives at
the same moment and wants the same turns in both cities. A single shared stream wouldn't do: Timer
lights draw extra random numbers for their offsets, which would shift every car after them.
`compare-test.js` checks arrivals and first turns match exactly.

**Changing a map's lights, or the number of lights, restarts both maps** from empty roads at the
same time of day, with new cars (a new traffic kind starts a new day). Switching one city mid-run would leave it with the other
setup's queues, which isn't a fair race. Traffic and speed change both live.

Under each map, **Waiting to enter** is how many cars are queued off the map right now, with how
many gave up today beneath it (see Waiting at the edge).

## Testing

`index.html?hour=21` starts the day at 9 PM, handy for checking the night look.
`index.html?compare` opens compare mode straight away.

## Tuning

Difficulty settings are in `CONFIG` at the top of `sim.js` (`spawnBase`, `spawnGrowth`,
`spawnMax`, `roadSchedule`). Chill mode's self-running lights use `autoMinGreen`,
`autoMaxGreen` and `autoCheckEvery`, and its road layouts are `LAYOUTS`. With the current values the bot lasts about 5.5 minutes
when it reacts every 0.5–1 s, and about 3.7 minutes when it reacts every 2 s.
