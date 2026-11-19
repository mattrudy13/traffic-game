# Green Wave

A little traffic simulation. Cars cross a city grid of side streets and four-lane avenues,
turning and changing lanes, and the lights switch themselves, giving way to whichever side has
more cars waiting.

- **Chill (default):** nothing to lose. A day passes every 6 minutes (at 1×), with a morning
  and evening rush hour and a quiet night when the map dims to lamplight and cars get headlights.
  The controls sit in three tabs: **Lights** (the place: Downtown, Main Street, Suburb or
  Crosstown, see Places; on Downtown, 1, 2, 4 or 6 lights; how they decide: Smart, Timer or
  Green wave; and left arrows), **Traffic** (how busy the city is, and what kind of day it is:
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

The trade-off, measured over a game day (before time queued off the map was counted, so the
numbers are low): arrows cut the worst left-turn waits a lot (6 lights,
rush hour: longest 224 s down to 75 s, 90th percentile 71 s down to 48 s) but everyone else waits
a few seconds longer on a typical trip. Triggering on any waiting left-turner instead of 6 s
cost everyone much more. The **Left arrows On/Off** switch in the controls flips them live, so
you can watch the average-wait chart move.

## Light strategies

- **Smart:** a light switches once the cars stopped on the red side outnumber *every* car within
  160 px of the green side (moving or not) by more than 2 to 1 (green lasts 3–20 s). An earlier
  version compared stopped cars on both sides. A flowing green has few stopped cars, so it flipped
  back after 3 s, and every switch costs 2.1 s of amber and all-red; at heavy traffic it ran short
  greens and lost to Timer.
- **Timer:** 10 s each way, every light on its own random offset.
- **Green wave:** same 10 s / 10 s cycle, but each light's east-west green starts later the further
  east it is, by the time a car needs to drive there. Eastbound groups hit green after green.

How they compare: average wait over a game day (time queued off the map and give-ups included),
averaged over 3 seeds:

| Setup | Smart | Timer | Green wave |
|---|---|---|---|
| 4 lights, slider 30 | **8.3 s** | 15.9 s | 15.3 s |
| 4 lights, slider 45 (default) | **27.2 s** | 30.2 s | 29.3 s |
| 4 lights, slider 60 | 48.9 s | **43.8 s** | 46.1 s |
| 6 lights, slider 45 | **21.9 s** | 32.9 s | 27.4 s |
| 6 lights, slider 75 | 59.7 s | 68.2 s | **59.1 s** |
| 6 lights, slider 90 | 73.3 s | 80.1 s | **68.9 s** |
| 1 light, slider 45 | **20.9 s** | 26.5 s | 28.8 s |
| 2 lights, slider 60 | 35.4 s | **35.3 s** | 37.7 s |

Smart wins at light and normal traffic. Once the city is overloaded, Green wave's coordination
between lights wins on 6 lights, which Smart (each light deciding alone) can't match.

## Places

The **Place** picker (top of the Lights tab) changes the map. Picking one starts that place at the
same time of day. Downtown is the original grid, all lights, and it alone has the 1/2/4/6 choice
and the Stadium and Construction days. The others have a fixed layout where each crossing has its
own control, and signs and roundabouts run themselves (only lights can be clicked).

- **Main Street:** one avenue with four side streets. The side streets have two-way stops onto it,
  except a light at the busiest crossing; the quiet back street has all-way stops. Side streets
  carry half the avenue's traffic per lane.
- **Suburb:** no lights. Two through streets meet at a roundabout; where a through street crosses a
  quiet one, the quiet one stops; quiet crossings are all-way stops. Quiet streets carry half the
  traffic, and the day has a school run (a sharp morning peak and a smaller one mid-afternoon).
  The light controls hide here, and Suburb isn't offered in compare mode (both maps would be the same).
- **Crosstown:** two avenues meet at a big one-lane roundabout. Each avenue's outer lane ends before
  it: where a light comes first, the lane is closed from that light on (hatched) and cars merge
  before the light; from the edge, they zipper-merge on the way in. Lights where a side street meets
  an avenue, all-way stops where two side streets meet. Avenues carry 0.6× traffic, since two lanes
  squeeze into one at the circle.

**Stop signs.** A car that has to stop stands at the line for 0.8 s first. At a two-way stop it then
waits for the main road to be clear for 3 s both ways (a right turn only needs the near side, the
traffic it merges into). At an all-way stop, cars go in the order they stopped: the first car's road
goes next, and anyone stopped on that road may go with it, as at a real four-way stop. A car whose
way out is full is skipped, so one blocked car can't hold up the crossing (that could chain around
a block into gridlock). After that the usual rules apply: cross traffic must be out of the box,
left turns need a gap, and nobody enters without a space on the far side.

**Roundabouts.** Every way through is a drive counterclockwise round part of the circle. An entering
car yields: nobody on the circle within 45 px upstream of its entry, and room to slot in. Cars on the
circle keep their distance from the car ahead on it, whichever road it came from. As at every
crossing, a car only enters if its way out has a space, so the circle can't lock up with cars that
can't leave. Turns at a roundabout may lead onto a road with more crossings (elsewhere turns only
lead straight out of the city, see Turning): every road out of the roundabout leads away from it,
and no other crossing turns a car back toward it, so no circular wait can form.

Bugs found while building these, for the record: a car waiting at its yield line was first counted
as on the circle (circling cars waited for it while it waited for them); cars going round are
measured along their curved path, so lane checks have to skip them; and merging between a light and
the roundabout never worked, because each lane's stretch counts its own spaces and the inner lane's
stayed full of moving cars.

The traffic slider's capacity mark per place (see Waiting at the edge for how it's measured):

| | Smart | Timer | Green wave |
|---|---|---|---|
| Main Street | 55 | 60 | 60 |
| Suburb | 75 | 75 | 75 |
| Crosstown | 60 | 55 | 55 |

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

The traffic slider shades the part of its track past the city's capacity, and its label reads
"overloaded" once you're in it. Capacity here means the slider value where drivers start giving
up at rush hour: the first value from which at least 2 of 3 seeded normal days (arrows on) had
give-ups, measured in steps of 5. It follows the number of lights and the strategy; in compare
mode the first map to overload sets it. Other traffic kinds and weather aren't measured.

| | Smart | Timer | Green wave |
|---|---|---|---|
| 1 light | 55 | 65 | 65 |
| 2 lights | 55 | 60 | 60 |
| 4 lights | 55 | 60 | 60 |
| 6 lights | 55 | 55 | 55 |

Smart overloads first even though its average wait is lowest. It compares raw car counts, and each
light is fed by 4 avenue lanes but only 2 street lanes, so a busy avenue nearly always outnumbers
the street. On 1 light at slider 55, the street got 4 s of green in the evening rush to the
avenue's 51 s, and its queue spilled off the map. Favoring the wider road is also why Smart's
average is low: a green on 4 lanes moves twice the cars. Fixes tried (3 seeds, mean day wait
across 8 setups, 31.2 s as is):

| Change | Give-ups | Mean wait |
|---|---|---|
| Compare cars per lane | start ~10 later on 1–2 lights, no better on 4–6 | 35.8 s |
| Count the whole queue, including off the map | same | 38.1 s |
| Longer green after the 20 s cap forces a switch | no better | 32.6 s |

None was worth the higher waits, so Smart is left as is: best on average, hardest on side streets.

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

The place is shared too (Suburb, with no lights, isn't offered). **Changing a map's lights, the place, or the number of lights, restarts both maps** from empty roads at the
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
