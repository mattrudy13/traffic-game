/*
 * Green Wave simulation: the rules of the game with no drawing in it.
 * game.js draws it in the browser; tune.js runs it in Node to check the difficulty.
 *
 * Coordinates: the map is CONFIG.width x CONFIG.height "world pixels".
 * The roads are a network (network.js, built from maps.js): links are lanes running from one
 * junction to the next, and movements are the ways through a junction from one link to another.
 * A side street has one lane each way. Avenues have two lanes each way (an inner lane by the
 * median and a curb lane), split by a median.
 * A car is listed on one link at a time. Its position is `s`, the distance its FRONT has
 * travelled along that link. Past the link's end it is in the junction's box, driving its
 * planned movement (`plan.move`), and it joins the next link once through.
 */
(function (root) {
  'use strict';

  var node = typeof module !== 'undefined' && module.exports;
  var Maps = node ? require('./maps.js') : root.TrafficMaps;
  var Net = node ? require('./network.js') : root.TrafficNetwork;

  var CONFIG = {
    width: 1280,
    height: 680,
    roadWidth: 56,
    carLength: 24,
    carWidth: 12,
    minGap: 7,          // bumper-to-bumper space a stopped car leaves
    maxSpeed: 140,      // world px per second
    accel: 150,         // px/s² when speeding up
    brake: 450,         // px/s² braking used by the safe-speed rule
    stopGap: 4,         // space between the stop line and the intersection box
    amberTime: 1.5,
    allRedTime: 0.6,    // both ways red so cars already in the box can clear it
    maxOffMap: 3,       // cars stuck waiting off the map on one lane = game over
    // Cars per second arriving on each lane that enters the map. It ramps up over time.
    spawnBase: 0.12,
    spawnGrowth: 0.0012,   // tuned with tune.js: a quick bot lasts ~5.5 min, a slow one ~3.7
    spawnMax: 0.6,
    // Roads open over time. `pos` is a fraction of the map's width (v) or height (h).
    // The map is wide and short, so it gets 3 north-south roads but only 2 east-west ones:
    // a third east-west road left only ~3 car lengths at the edges and the game fell apart.
    roadSchedule: [
      { at: 0, axis: 'v', pos: 0.5 },
      { at: 0, axis: 'h', pos: 0.36 },
      { at: 35, axis: 'v', pos: 0.22 },
      { at: 80, axis: 'h', pos: 0.68 },
      { at: 140, axis: 'v', pos: 0.78 }
    ],
    // Chill mode: lights switch themselves. A green light is checked every `autoCheckEvery`
    // seconds once it has been green for `autoMinGreen`, and gives way to the red side when
    // more cars are waiting there (or after `autoMaxGreen` if anyone is waiting at all).
    autoCheckEvery: 0.5,
    autoMinGreen: 3,
    autoMaxGreen: 20,
    smartRatio: 2,       // Smart: switch once the red side has this many times the green side's cars
    // Chill mode: a car queued off the map this many seconds gives up and drives off. Without it,
    // traffic above what the city can carry (about slider 60 on 6 lights) would build a queue that
    // grows every day forever, since the night is too short to clear it.
    giveUpAfter: 120,
    manualHold: 8,       // seconds a light you clicked is left alone before the strategy takes over again
    // Timer and green-wave lights run a fixed cycle: half of it green each way.
    cycleTime: 20,
    // Green wave: each light's east-west green starts later the further east it is, by the time a
    // car needs to drive there. A group of cars leaving on green then meets green all the way across.
    waveSpeedFactor: 0.85,
    // Chill mode's day: one game day lasts `dayLength` seconds and starts at `dayStartHour`.
    dayLength: 360,
    dayStartHour: 6.5,
    waitWindow: 60,      // average wait is over cars that left the map in the last N seconds
    // Turning (chill mode only). At each light where it may turn, a car turns 35% of the time,
    // split between left and right in these proportions.
    turnLeft: 0.15,
    turnRight: 0.2,
    leftTurnSpeed: 60,   // px/s through the corner; left turns are wider so a bit faster
    rightTurnSpeed: 45,
    gapTime: 2.5,        // a left-turner needs oncoming cars to be at least this many seconds away
    // Avenues (chill mode's east-west roads).
    avenueLaneWidth: 24,
    avenueMedian: 10,
    avenueSpeedFactor: 1.2,   // avenues are about 20% faster than side streets
    laneChangeTime: 0.7,      // seconds a lane change takes to draw
    laneChangeCooldown: 2.5,  // a car that just changed lanes waits this long before passing again
    laneChangeStopGap: 30,    // no lane changes this close to a stop line
    // Left-turn arrows (avenue lefts only). Before an avenue's green, if someone is waiting to
    // turn left there, the light shows a green arrow: only avenue left turns may go. Smart lights
    // keep it until the turners have gone (between arrowMin and arrowMax seconds); timer and
    // green-wave lights give it a fixed arrowTime. After it, lefts still go on gaps as usual.
    arrows: true,
    arrowMin: 2,
    arrowMax: 8,
    arrowTime: 4,
    arrowReach: 150,          // a left-turner this close to the line counts as waiting for an arrow
    arrowAfterWait: 6,        // ...once it has been stopped this many seconds (tested: 0 s cost
                              // everyone a lot of waiting, 6 s keeps most of the benefit)
    // Stop signs (places other than Downtown).
    signStop: 0.8,            // seconds a car stands at a stop line before it may go
    crossGap: 3,              // a car leaving a side-street stop sign needs the main road clear this many seconds
    // Roundabouts: one lane, driven counterclockwise (traffic keeps right).
    roundSpeed: 55,           // px/s on the circle
    roundYield: 45,           // an entering car needs the circle clear this many px upstream of its entry
    roundLane: 24             // width of the circle's lane
  };

  // How busy the city is at each hour, as a multiple of the traffic slider. Points are
  // [hour, multiplier] and the curve is straight lines between them: two rush hours, a quiet night.
  var DAY_TRAFFIC = [
    [0, 0.2], [5, 0.2], [6.5, 0.6], [8, 1.6], [9.5, 0.9], [12, 1.0], [15, 1.0],
    [17.5, 1.7], [19, 0.9], [21, 0.5], [23, 0.25], [24, 0.2]
  ];

  // Traffic kinds (chill and compare modes). Each changes the shape of the day.
  //  normal:       DAY_TRAFFIC, busier and quieter lanes picked at random.
  //  commute:      the same day, but mornings most avenue traffic heads east ("into town") and
  //                evenings it heads back west. COMMUTE_BIAS is +1 at the morning peak, -1 at the evening one.
  //  stadium:      a quieter day, then a night game lets out and a crowd floods in from the north-east
  //                corner: southbound on the east-most street and westbound on the top avenue.
  //  sunday:       no rush hours, light all day, and more people turning.
  //  construction: the lower avenue's eastbound curb lane is closed past its first light.
  var KINDS = ['normal', 'commute', 'stadium', 'sunday', 'construction'];
  var SUNDAY_TRAFFIC = [[0, 0.2], [6, 0.25], [10, 0.75], [17, 0.75], [21, 0.45], [24, 0.2]];
  var COMMUTE_BIAS = [[0, 0], [6, 0], [8, 1], [10, 0.6], [12, 0], [15, 0], [17.5, -1], [19.5, -0.4], [21, 0], [24, 0]];
  var COMMUTE_STRENGTH = 0.9;      // morning eastbound lanes get e^0.9 ≈ 2.5x, westbound e^-0.9 ≈ 0.4x
  var STADIUM_DAY = 0.85;          // the rest of a stadium day is a bit quieter than normal
  var STADIUM_BURST = [[0, 0], [21.25, 0], [21.5, 1], [22.5, 1], [23.25, 0], [24, 0]];
  var STADIUM_BOOST = 3;           // extra arrivals per crowd lane at the peak, as a multiple of the traffic slider
  var SUNDAY_TURNS = { turnLeft: 0.22, turnRight: 0.28 };

  // Weather (chill and compare modes). Wet and snowy roads mean lower top speeds, gentler
  // acceleration and weaker brakes. Weaker brakes alone make moving cars keep bigger gaps (the
  // safe-speed rule leaves more room). The gap between stopped cars stays the same: the "don't
  // block the box" spaces are counted from it, so changing it could strand a car in a box.
  var WEATHER = {
    clear: { speed: 1, accel: 1, brake: 1 },
    rain: { speed: 0.85, accel: 0.85, brake: 0.75 },
    snow: { speed: 0.7, accel: 0.65, brake: 0.55 }
  };
  var WEATHER_BLOCK = 4;           // "changing" weather picks anew every 4 game hours

  // Buses run in the avenues' curb lanes, one every BUS_EVERY seconds each way, and stop for
  // BUS_DWELL seconds at a stop in the middle of each block. A bus is about two cars long, so it
  // takes two spaces in the "don't block the box" count (it would otherwise fit where it can't).
  var BUS_EVERY = 40, BUS_DWELL = 4, BUS_LENGTH = 52, BUS_SPEED = 0.85;
  // Ambulances: one every AMBULANCE_EVERY seconds or so, straight across the city. Lights ahead
  // turn green for it, and cars ahead move over (or ease to the side on one-lane streets).
  var AMBULANCE_EVERY = 45, AMBULANCE_LENGTH = 30, AMBULANCE_SPEED = 1.25;
  var AMBULANCE_REACH = 260;       // a light this far ahead of an ambulance turns green for it
  var YIELD_REACH = 140;           // cars this close ahead of an ambulance get out of its way
  // Buses and ambulances never turn: their stream always says "no".
  function neverTurn() { return 0.999; }
  // Suburb's day: a sharp school run in the morning, a smaller one mid-afternoon, a modest evening.
  var SCHOOL_TRAFFIC = [
    [0, 0.15], [5, 0.15], [6.5, 0.5], [7.5, 1.6], [8.5, 1.4], [9.25, 0.6], [12, 0.6], [14.75, 0.7],
    [15.25, 1.3], [16, 0.8], [17.5, 1.1], [19, 0.7], [21, 0.4], [23, 0.2], [24, 0.15]
  ];

  // Places whose day has its own shape (the rest follow DAY_TRAFFIC). Their roads and junctions
  // are in maps.js.
  var PLACE_DAY = { suburb: SCHOOL_TRAFFIC };
  var PLACE_NAMES = ['downtown', 'main', 'suburb', 'crosstown'];

  // Seeded random numbers (mulberry32), so a city can be replayed exactly.
  function seeded(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Mixes a seed with some whole numbers into a new seed, for one lane's or one car's own stream.
  function mixSeed(seed) {
    var h = seed >>> 0;
    for (var i = 1; i < arguments.length; i++) {
      h = Math.imul(h ^ (arguments[i] >>> 0), 0x9E3779B1);
      h ^= h >>> 15;
    }
    return h >>> 0;
  }

  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

  function createGame(options) {
    var cfg = Object.assign({}, CONFIG, options || {});
    var g = {
      cfg: cfg,
      // With a seed, setup (lane busyness, first light directions, Timer offsets) is seeded too.
      rng: cfg.rng || (cfg.seed !== undefined ? seeded(mixSeed(cfg.seed, 0x5e7)) : Math.random),
      time: 0,
      score: 0,
      over: false,
      overReason: '',
      roads: [],           // the straight roads opened so far: {axis, c, half, avenue, weight} (drawing, stadium)
      net: null,           // the road network built from them (network.js)
      lanes: [],           // every link in the network, each with the cars on it
      sources: [],         // the links where cars enter the map, each with its arrivals queue
      lights: [],          // every junction's state: a light, stop signs or a roundabout
      nextRoad: 0,
      nextId: 1,
      nextSource: 0,
      events: [],
      chill: false,        // chill mode: no losing, lights run themselves
      traffic: null,       // chill mode: base arrival rate per lane (cars/s) instead of the ramp
      strategy: 'smart',   // chill mode: smart | timer | wave
      kind: 'normal',      // traffic kind (see KINDS)
      weather: 'clear',    // clear | rain | snow | changing
      wx: WEATHER.clear,   // this step's weather effect
      buses: false,
      ambulances: false,   // send one now and then by itself
      autoTimer: 0,
      lastHour: 0,         // chill mode: the hour last step, to spot midnight
      exits: [],           // {t, wait} for cars that recently left the map
      tally: { count: 0, sum: 0, worst: 0, gaveUp: 0 }   // every trip since resetTally ("today": it resets at midnight)
    };
    // Arrivals and turn choices come from their own streams per entry lane and per car, not from
    // g.rng. Why: compare mode runs two cities with different lights side by side. If both drew
    // from one shared stream, a light strategy that used one extra number (Timer's random offsets)
    // would shift every car after it and the two cities would get different traffic. With a stream
    // per entry lane, arrivals depend only on the seed and the clock; with one per car, the 5th car
    // on a lane makes the same turns in both cities.
    g.seed = cfg.seed !== undefined ? cfg.seed >>> 0 : Math.floor(g.rng() * 4294967296);
    openDueRoads(g);
    return g;
  }

  // A relaxed game: all roads for the chosen layout are open from the start.
  function createChill(lights, traffic, options) {
    var place = options && Maps.PLACES[options.place] ? options.place : 'downtown';
    var schedule = place === 'downtown'
      ? (Maps.DOWNTOWN[lights] || Maps.DOWNTOWN[4]).map(function (r) { return { at: 0, axis: r[0], pos: r[1], avenue: r[0] === 'h' }; })
      : Maps.PLACES[place].roads.map(function (r) { return { at: 0, axis: r[0], pos: r[1], avenue: !!r[2], weight: r[3] || 1 }; });
    var kind = options && KINDS.indexOf(options.kind) >= 0 ? options.kind : 'normal';
    var g = createGame(Object.assign({}, kind === 'sunday' ? SUNDAY_TURNS : {}, options, {
      roadSchedule: schedule, place: place
    }));
    g.chill = true;
    g.traffic = traffic;
    g.kind = kind;
    g.weather = options && options.weather && (WEATHER[options.weather] || options.weather === 'changing') ? options.weather : 'clear';
    g.buses = !!(options && options.buses);
    g.ambulances = !!(options && options.ambulances);
    if (kind === 'stadium') setUpStadium(g);
    if (kind === 'construction') setUpConstruction(g);
    setUpBuses(g);          // after construction: no buses in a closed lane
    setUpAmbulances(g);
    setStrategy(g, (options && options.strategy) || 'smart');
    return g;
  }

  // The lanes straight on from `link` to the edge of the map (null at the end if it can't get there).
  function straightOut(link) {
    for (var i = 0; i < link.out.length; i++) if (link.out[i].turn === 'straight') return link.out[i];
    return null;
  }
  function chainFrom(link) {
    var chain = [link], l = link;
    while (l.to.type !== 'edge') {
      var m = straightOut(l);
      if (!m) { chain.push(null); break; }
      l = m.to;
      chain.push(l);
    }
    return chain;
  }

  // The crowd comes out of the stadium in the north-east block, onto the two roads beside it.
  function setUpStadium(g) {
    var east = maxBy(g.roads.filter(function (r) { return r.axis === 'v'; }), function (r) { return r.c; });
    var top = maxBy(g.roads.filter(function (r) { return r.axis === 'h'; }), function (r) { return -r.c; });
    g.sources.forEach(function (link) {
      link.crowd = (link.from.id === 'n' + east.c && link.dir === 'S') || (link.from.id === 'e' + top.c && link.dir === 'W');
    });
    // The block it stands in, for drawing.
    g.stadium = { x0: east.c + east.half, y1: top.c - top.half };
  }

  // Close the lower avenue's eastbound curb lane on the stretch past its first light.
  // That stretch gets no room at all (hasSpace says no), so straight cars in the curb lane merge
  // into the inner lane before the light; right turns from it still go. No turn leads into a
  // closed lane, and the "don't block the box" rule keeps working: a car never enters an
  // intersection it can't leave.
  function setUpConstruction(g) {
    var low = maxBy(g.roads.filter(function (r) { return r.axis === 'h'; }), function (r) { return r.c; });
    var entry = g.sources.filter(function (l) { return l.from.id === 'w' + low.c && l.position === 'curb'; })[0];
    var first = entry && straightOut(entry);
    if (!first) return;
    first.to.closed = true;
    g.construction = { lane: first.to, from: 0, to: first.to.len };
  }

  // Bus lanes and their stops: an avenue's curb lane all the way across, with a stop in the middle
  // of each block that's long enough.
  function setUpBuses(g) {
    g.sources.forEach(function (link) {
      if (link.kind !== 'avenue' || link.position !== 'curb') return;
      var chain = chainFrom(link);
      if (chain.some(function (l) { return !l || l.closed || l.ends; })) return;
      chain.forEach(function (l) {
        var end = l.to.type === 'edge' ? l.len : l.stopLine;
        if (end > 4 * BUS_LENGTH) l.busStop = end / 2 + BUS_LENGTH / 2;
      });
      var rng = seeded(mixSeed(g.seed, 0xb05, link.sourceId));
      link.busRoute = true;
      link.nextBus = rng() * BUS_EVERY;
      link.buses = 0;
    });
  }

  function setUpAmbulances(g) {
    g.ambulanceRng = seeded(mixSeed(g.seed, 0xa3b));
    g.nextAmbulance = AMBULANCE_EVERY * (0.5 + g.ambulanceRng());
  }

  // Send an ambulance across the city. `pick` (0..1) chooses its road, so compare mode can send
  // the same one on both maps. It goes in an avenue's inner lane or a side street, never a closed lane.
  function sendAmbulance(g, pick) {
    var lanes = g.sources.filter(function (l) {
      return l.position !== 'curb' && !chainFrom(l).some(function (x) { return !x || x.closed; });
    });
    if (!lanes.length) return null;
    var lane = lanes[Math.min(lanes.length - 1, Math.floor(pick * lanes.length))];
    lane.ambulancesWaiting = (lane.ambulancesWaiting || 0) + 1;
    lane.ambulances = (lane.ambulances || 0) + 1;
    g.events.push({ type: 'ambulance' });
    return lane;
  }

  // The weather right now: the setting, or for "changing", a pick for this 4-hour block of this day.
  function currentWeather(g) {
    if (g.weather !== 'changing') return g.weather;
    var hours = g.cfg.dayStartHour + g.time / g.cfg.dayLength * 24;
    var block = Math.floor(hours / WEATHER_BLOCK);
    var r = seeded(mixSeed(g.seed, 0xea7, block))();
    return r < 0.5 ? 'clear' : r < 0.82 ? 'rain' : 'snow';
  }

  function maxBy(list, f) {
    return list.reduce(function (best, x) { return best === null || f(x) > f(best) ? x : best; }, null);
  }

  function setTraffic(g, rate) {
    g.traffic = rate;
  }

  // Turn left-turn arrows on or off. A light showing an arrow right now moves on to its green.
  function setArrows(g, on) {
    g.cfg.arrows = on;
    if (on) return;
    g.lights.forEach(function (l) {
      if (l.phase === 'arrow') { l.phase = 'green'; l.greenFor = 0; }
    });
  }

  function setStrategy(g, strategy) {
    g.strategy = strategy;
    var cfg = g.cfg;
    // The wave runs east-west, so it is timed to the speed of the east-west roads.
    var ewSpeed = cfg.maxSpeed * (g.roads.some(function (r) { return r.avenue; }) ? cfg.avenueSpeedFactor : 1);
    var waveSpeed = ewSpeed * cfg.waveSpeedFactor;
    g.lights.forEach(function (l) {
      // Timer lights are not coordinated (random offsets); wave lights are offset by distance.
      l.offset = strategy === 'wave' ? l.x / waveSpeed : g.rng() * cfg.cycleTime;
      l.holdUntil = 0;
    });
  }

  // ---------------------------------------------------------------- time of day

  function hourOfDay(g) {
    return (g.cfg.dayStartHour + g.time / g.cfg.dayLength * 24) % 24;
  }

  // Straight lines between [hour, value] points.
  function curveAt(points, hour) {
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      if (hour <= b[0]) return a[1] + (b[1] - a[1]) * (hour - a[0]) / (b[0] - a[0]);
    }
    return points[0][1];
  }

  function dayTraffic(hour) {
    return curveAt(DAY_TRAFFIC, hour);
  }

  // Is the stadium crowd on its way out (0 = no, 1 = at its peak)?
  function stadiumCrowd(g) {
    return g.kind === 'stadium' ? curveAt(STADIUM_BURST, hourOfDay(g)) : 0;
  }

  // A short note on what the traffic kind is doing right now, for the strip (or null).
  function kindNote(g) {
    var hour = hourOfDay(g);
    if (g.kind === 'stadium') {
      if (stadiumCrowd(g) > 0) return 'game letting out';
      if (hour >= 19 && hour < 21.25) return 'game on';
    }
    if (g.kind === 'commute') {
      var b = curveAt(COMMUTE_BIAS, hour);
      if (b > 0.3) return 'commute into town';
      if (b < -0.3) return 'commute home';
    }
    if (g.kind === 'construction') return 'lane closed';
    return null;
  }

  // 0 = full daylight, 1 = full night, with an hour or two of dusk and dawn in between.
  function darkness(hour) {
    if (hour < 5 || hour >= 20.5) return 1;
    if (hour < 7) return 1 - (hour - 5) / 2;
    if (hour >= 18.5) return (hour - 18.5) / 2;
    return 0;
  }

  function dayPhase(hour) {
    if (hour < 5) return 'night';
    if (hour < 7) return 'early morning';
    if (hour < 9.5) return 'morning rush';
    if (hour < 15.5) return 'midday';
    if (hour < 19) return 'evening rush';
    if (hour < 21.5) return 'evening';
    return 'night';
  }

  // A finished trip (or one given up at the edge) goes into the last-minute window and today's tally.
  function recordTrip(g, wait, id) {
    g.exits.push({ t: g.time, wait: wait, id: id });
    g.tally.count++;
    g.tally.sum += wait;
    g.tally.worst = Math.max(g.tally.worst, wait);
  }

  // Cars that have arrived but are still queued off the map, waiting for room to enter.
  function waitingToEnter(g) {
    var n = 0;
    g.sources.forEach(function (link) { n += link.offMap; });
    return n;
  }

  // Start counting trips afresh (compare mode does this at midnight).
  function resetTally(g) {
    g.tally = { count: 0, sum: 0, worst: 0, gaveUp: 0 };
  }

  // Average seconds stopped per trip, over cars that left in the last `waitWindow` seconds.
  function averageWait(g) {
    if (!g.exits.length) return null;
    var sum = 0;
    g.exits.forEach(function (e) { sum += e.wait; });
    return sum / g.exits.length;
  }


  // ---------------------------------------------------------------- roads and the network

  // Open the roads that are due (all of them at once in chill mode; one by one in challenge mode)
  // and rebuild the network from every road open so far.
  function openDueRoads(g) {
    var cfg = g.cfg, schedule = cfg.roadSchedule, opened = [];
    while (g.nextRoad < schedule.length && schedule[g.nextRoad].at <= g.time) {
      var r = schedule[g.nextRoad++];
      var size = r.axis === 'v' ? cfg.width : cfg.height, avenue = !!r.avenue;
      var road = {
        axis: r.axis, pos: r.pos, c: Math.round(r.pos * size), avenue: avenue, weight: r.weight || 1,
        // Half the road's width: two 28 px lanes for a street, four lanes plus a median for an avenue.
        half: avenue ? cfg.avenueMedian / 2 + 2 * cfg.avenueLaneWidth : cfg.roadWidth / 2
      };
      g.roads.push(road);
      opened.push(road);
    }
    if (!opened.length) return;

    var place = Maps.PLACES[cfg.place];
    var map = Maps.gridMap({
      roads: g.roads.map(function (rd) { return { axis: rd.axis, pos: rd.pos, avenue: rd.avenue, weight: rd.weight }; }),
      control: place && place.control
    }, cfg.width, cfg.height);
    install(g, Net.buildNetwork(map, cfg), opened);
    // Busier and quieter lanes change whenever the map changes, so the player has to rebalance.
    g.sources.forEach(function (link) {
      link.share = (0.6 + g.rng() * 0.8) * link.weight * (place && place.streetWeight && link.kind !== 'avenue' ? place.streetWeight : 1);
    });
    if (g.time > 0) g.events.push({ type: 'road' });
  }

  function isLight(l) { return l.control === 'light'; }

  function placeHasLights(name) {
    var place = Maps.PLACES[name];
    if (!place) return true;
    var nv = place.roads.filter(function (r) { return r[0] === 'v'; }).length, nh = place.roads.length - nv;
    for (var vi = 0; vi < nv; vi++) for (var hi = 0; hi < nh; hi++) if (place.control(vi, hi).type === 'light') return true;
    return false;
  }

  // Put a freshly built network in place. Junctions, entry lanes and cars carry over from the old
  // one (challenge mode rebuilds it each time a road opens): junctions by id, entry lanes by where
  // they enter, and cars by where they are on the map.
  function install(g, net, opened) {
    var cfg = g.cfg, old = g.net;
    net.links.forEach(function (link) {
      link.cars = [];          // front-most car first
      link.ghosts = [];        // cars still sliding out of this lane into the other one
      link.incoming = 0;       // cars committed to a movement into this link (they hold a space)
      // How many cars fit between the box behind and the next stop line (the map edge: no limit).
      link.capacity = link.to.type === 'edge' ? Infinity : Math.floor((link.stopLine + cfg.minGap) / (cfg.carLength + cfg.minGap));
      link.other = link.siblings.length === 2 ? link.siblings[1 - link.index] : null;
      var straight = straightOut(link);
      // How deep the junction ahead is along this lane (a turning car follows cars still in it).
      link.boxDepth = straight ? straight.len : 2 * link.toArm.setback;
    });

    // Junction states. A new road starts on red so traffic already on the map keeps flowing.
    var byKey = {};
    g.lights.forEach(function (l) { byKey[l.key] = l; });
    var lights = [];
    net.nodeList.filter(function (n) { return n.type === 'junction'; })
      .sort(function (a, b) { return a.x - b.x || a.y - b.y; })
      .forEach(function (node) {
        var L = byKey[node.id];
        if (!L) {
          var newV = opened.some(function (r) { return r.axis === 'v' && r.c === node.x; });
          var newH = opened.some(function (r) { return r.axis === 'h' && r.c === node.y; });
          L = {
            key: node.id, x: node.x, y: node.y, control: node.control.type, queue: [],
            phase: 'green', timer: 0, greenFor: 0,
            axis: newV && !newH ? 'ew' : newH && !newV ? 'ns' : (g.rng() < 0.5 ? 'ns' : 'ew')
          };
        }
        L.node = node;
        L.major = node.control.major || null;
        L.phases = node.phases;
        L.ring = node.ring || 0;
        L.occ = {};
        L.ringStamp = -1;
        var cur = 0;
        node.phases.forEach(function (p, i) { if (p.tag === L.axis) cur = i; });
        L.cur = cur;
        if (node.phases.length) L.axis = node.phases[cur].tag;
        node.state = L;
        lights.push(L);
      });
    net.links.forEach(function (link) {
      var L = link.to.state;
      link.phaseIndex = -1;
      if (L) L.phases.forEach(function (p, i) { if (p.arms.indexOf(link.toArm) >= 0) link.phaseIndex = i; });
    });

    // Entry lanes keep their arrivals, queue and random stream.
    var oldSources = {};
    g.sources.forEach(function (l) { oldSources[l.from.id + '#' + l.index] = l; });
    g.sources = net.sources.map(function (src) { return src.link; });
    g.sources.forEach(function (link) {
      var was = oldSources[link.from.id + '#' + link.index];
      link.isSource = true;
      link.edge = link.from.edge;
      if (was) {
        ['sourceId', 'offMap', 'pending', 'arrivals', 'rng', 'spawnTimer', 'share', 'crowd', 'busRoute', 'nextBus', 'buses',
         'busesWaiting', 'ambulancesWaiting', 'ambulances'].forEach(function (k) { if (k in was) link[k] = was[k]; });
        return;
      }
      link.sourceId = g.nextSource++;
      link.offMap = 0;         // cars that arrived but have no room to enter yet
      link.pending = [];       // their arrival number and time, oldest first (offMap === pending.length)
      link.arrivals = 0;
      link.rng = seeded(mixSeed(g.seed, link.sourceId));
      // Expected arrivals still to come before the next car (see spawnCars).
      link.spawnTimer = link.rng();
      link.share = 1;
    });

    if (old) moveOver(g, old, net);
    g.net = net;
    g.lanes = net.links;
    g.lights = lights;
    // Plans point at movements, which were just rebuilt: give every car not yet committed a fresh plan.
    g.lanes.forEach(function (link) {
      link.cars.forEach(function (car) {
        if (car.plan && car.plan.move && car.s > link.stopLine) return;
        car.plan = makePlan(g, link, car.s > link.stopLine ? 'straight' : null, car.rng);
      });
    });
  }

  // Challenge mode: move every car from the old network onto the new one. A car keeps its place on
  // the map; one in a junction's box keeps its way through it (that junction is still there, only
  // the links either side may be shorter now).
  function moveOver(g, old, net) {
    // The new link carrying the same lane through point p: same heading, on the same line, the
    // last one starting at or before p (so a point inside a new junction's box lands on the link
    // before it, past its stop line).
    function linkAt(p, heading) {
      var best = null, bestT = Infinity, ux = Math.cos(heading), uy = Math.sin(heading);
      net.links.forEach(function (l) {
        if (Math.abs(wrap(l.heading - heading)) > 0.01) return;
        var a = l.path.pts[0], dx = p.x - a.x, dy = p.y - a.y;
        if (Math.abs(dx * uy - dy * ux) > 0.5) return;
        var t = dx * ux + dy * uy;
        if (t >= -0.5 && t < bestT) { best = l; bestT = t; }
      });
      return best ? { link: best, s: bestT } : null;
    }
    function moveAt(m) {
      var from = linkAt(m.from.path.pts[m.from.path.pts.length - 1], m.from.heading);
      var to = linkAt(m.to.path.pts[0], m.to.heading);
      if (!from || !to) return null;
      return from.link.out.filter(function (x) { return x.to === to.link; })[0] || null;
    }
    var where = [];
    old.links.forEach(function (ol) {
      ol.cars.forEach(function (car) {
        var m = car.plan && car.plan.move, nm = m && car.s > ol.stopLine ? moveAt(m) : null, link, s;
        if (nm) {
          link = nm.from;
          s = link.len - (ol.len - car.s);
          car.plan = { move: nm, turn: nm.turn, exit: nm.exit };
        } else {
          var at = linkAt(linkPoint(ol, car.s), ol.heading);
          if (!at) return;   // can't happen on a grid: every lane carries on
          link = at.link;
          s = at.s;
          car.plan = null;
        }
        car.s = s;
        car.prevMove = car.prevMove ? moveAt(car.prevMove) : null;
        car.shift = 0;
        car.oldLane = null;
        link.cars.push(car);
        where.push([car, link]);
      });
    });
    net.links.forEach(function (l) { l.cars.sort(function (a, b) { return b.s - a.s; }); });
    // All-way stop queues name each car's lane.
    var linkOf = new Map(where);
    g.lights.forEach(function (L) {
      L.queue = L.queue.filter(function (q) { return linkOf.has(q.car); }).map(function (q) { return { car: q.car, lane: linkOf.get(q.car) }; });
    });
  }

  // ---------------------------------------------------------------- lights

  function flip(g, light) {
    if (g.over || !light || !isLight(light) || (light.phase !== 'green' && light.phase !== 'arrow')) return false;
    light.phase = 'amber';
    light.timer = g.cfg.amberTime;
    return true;
  }

  // Light phases, in order: green -> amber -> allred -> (arrow ->) green for the next phase.
  function updateLights(g, dt) {
    g.lights.forEach(function (l) {
      if (!isLight(l)) return;
      if (l.phase === 'green') {
        l.greenFor += dt;
        return;
      }
      if (l.phase === 'arrow') l.greenFor += dt;
      l.timer -= dt;
      if (l.timer > 0) return;
      if (l.phase === 'amber') {
        l.phase = 'allred';
        l.timer = g.cfg.allRedTime;
      } else if (l.phase === 'arrow') {
        l.phase = 'green';
        l.greenFor = 0;
      } else {
        l.cur = (l.cur + 1) % l.phases.length;
        l.axis = l.phases[l.cur].tag;
        l.greenFor = 0;
        if (g.cfg.arrows !== false && l.phases[l.cur].arrow.length && leftTurnersWaiting(g, l)) {
          l.phase = 'arrow';
          l.timer = g.strategy === 'smart' ? g.cfg.arrowMax : g.cfg.arrowTime;
        } else {
          l.phase = 'green';
        }
      }
    });
  }

  // Is anyone queued for this phase's left-turn arrow?
  function leftTurnersWaiting(g, light) {
    var cfg = g.cfg;
    return light.phases[light.cur].arrow.some(function (m) {
      var line = m.from.stopLine;
      return m.from.cars.some(function (c) {
        return c.plan && c.plan.move === m && c.s <= line + 0.001 && line - c.s < cfg.arrowReach && c.v < 20 && c.wait >= cfg.arrowAfterWait;
      });
    });
  }

  function lightAt(g, x, y, radius) {
    var best = null, bestD = radius * radius;
    g.lights.forEach(function (l) {
      if (!isLight(l)) return;
      var d = (l.x - x) * (l.x - x) + (l.y - y) * (l.y - y);
      if (d <= bestD) { best = l; bestD = d; }
    });
    return best;
  }

  // Record which movements have a car in their box right now, and how many cars are committed to
  // each link (they already hold a space there). A car is in the box from its stop line until its
  // rear is out the far side: from the line, not the box edge 4 px later, since a car in that gap
  // had already committed and a side-street car at a stop sign could pull out in front of it.
  function markBoxes(g) {
    g.lights.forEach(function (l) { l.occ = {}; });
    g.lanes.forEach(function (l) { l.incoming = 0; });
    g.lanes.forEach(function (link) {
      link.cars.forEach(function (car) {
        var m = car.plan && car.plan.move;
        if (m && car.s > link.stopLine) {
          m.node.state.occ[m.id] = true;
          m.to.incoming += car.slots || 1;
        }
        var pm = car.prevMove;
        if (pm && car.s - car.len < 0) pm.node.state.occ[pm.id] = true;
      });
    });
  }

  // Nobody in the box on a movement that crosses or joins this one.
  function boxClear(L, m) {
    for (var i = 0; i < m.conflicts.length; i++) if (L.occ[m.conflicts[i]]) return false;
    return true;
  }

  // ---------------------------------------------------------------- cars

  // What a car will do at the end of its link: the movement it takes through the junction.
  // A plan is {move, turn, want, exit}; null on a lane that runs off the map.
  //
  // Only movements the network marks `allowed` are taken (see buildDistances in network.js: every
  // allowed movement brings a car closer to an exit, so gridlock can't happen). On a grid that's
  // going straight on, turning onto a street that leads straight out of the city, and any way off
  // a roundabout.
  function makePlan(g, link, forced, rng) {
    if (link.to.type === 'edge') return null;
    if (link.ends) return { move: null, turn: 'straight' };   // must move over: see changeLanes
    if (link.to.state.control === 'round') return roundPlan(g, link, forced, rng);
    var cfg = g.cfg, straight = straightOut(link), turn = forced || 'straight';
    rng = rng || g.rng;
    if (!forced && g.chill) {
      var leftWeight = turnMove(link, 'left') ? cfg.turnLeft : 0, rightWeight = turnMove(link, 'right') ? cfg.turnRight : 0;
      // Keep the overall share of turning cars the same even when only one turn is allowed here.
      var r = rng() * (leftWeight + rightWeight) / (cfg.turnLeft + cfg.turnRight);
      if (leftWeight + rightWeight > 0 && rng() < cfg.turnLeft + cfg.turnRight) {
        turn = r < leftWeight / (cfg.turnLeft + cfg.turnRight) ? 'left' : 'right';
      }
    }
    if (turn === 'straight') {
      // Straight on into a closed stretch still counts: the car moves over before the line.
      if (straight && (straight.allowed || straight.to.closed)) return { move: straight, turn: 'straight' };
      // No way on straight ahead (a T-junction's stem, from Stage 2): take an allowed turn.
      var any = link.out.filter(function (m) { return m.allowed && !m.to.closed; });
      if (!any.length) return { move: straight, turn: 'straight' };
      var pick = any[Math.floor(rng() * any.length)];
      return { move: pick, turn: pick.turn };
    }
    // On an avenue, lefts go from the inner lane and rights from the curb lane. A car in the
    // other lane goes straight for now and tries to change lanes; `want` remembers the turn.
    if (turnLane(link, turn) !== link) return { move: straight, turn: 'straight', want: turn };
    var m = turnMove(link, turn);
    if (!m) return { move: straight, turn: 'straight' };
    return { move: m, turn: turn };
  }

  // At a roundabout every car drives the circle (turn 'round'); `exit` says where it leaves.
  function roundPlan(g, link, forced, rng) {
    var exits = {};
    link.out.forEach(function (m) { if (m.allowed && !m.to.closed) exits[m.exit] = m; });
    var exit = forced && forced !== 'straight' ? forced : 'straight';
    if (!forced && g.chill) {
      var cfg = g.cfg, r = (rng || g.rng)();
      if (r < cfg.turnLeft && exits.left) exit = 'left';
      else if (r < cfg.turnLeft + cfg.turnRight && exits.right) exit = 'right';
    }
    var m = exits[exit] || exits.straight;
    if (!m) return { move: null, turn: 'straight' };
    return { move: m, turn: 'round', exit: m.exit };
  }

  // The lane a turn goes from: the inner lane for lefts, the curb lane for rights.
  function turnLane(link, turn) {
    var sib = link.siblings;
    return turn === 'left' ? sib[0] : sib[sib.length - 1];
  }

  function turnMove(link, turn) {
    var from = turnLane(link, turn);
    for (var i = 0; i < from.out.length; i++) {
      var m = from.out[i];
      if (m.turn === turn && m.allowed && !m.to.closed) return m;
    }
    return null;
  }

  function onCircle(link, car) {
    return !!car.plan && car.plan.turn === 'round' && car.s > link.stopLine;
  }

  // Past the stop line on a turn (until it joins the new lane).
  function isTurning(link, car) {
    return !!car.plan && !!car.plan.move && car.plan.turn !== 'straight' && car.s > link.stopLine;
  }

  // The furthest this car's front may go without hitting anyone ahead. Straight cars follow
  // whoever is ahead on the link. A turning car ignores cars that have gone all the way through
  // the junction, since they're no longer on its path. It still follows a car that is in the box
  // (a turn starts out going straight ahead, so it could catch a slow car there) and any car ahead
  // of it on the same curve. Everyone also follows the last car on the link they're heading for.
  function leaderLimit(g, link, i, car) {
    var cfg = g.cfg, cars = link.cars, plan = car.plan, m = plan && plan.move, best = Infinity;
    var turning = m && plan.turn !== 'straight';
    for (var k = i - 1; k >= 0; k--) {
      var o = cars[k], op = o.plan;
      if (!turning) {
        // A car going round a roundabout is measured along its path, not this lane: skip it.
        if (onCircle(link, o)) continue;
        best = o.s - o.len - cfg.minGap;
        break;
      }
      var sameCurve = op && op.move && (op.move === m || (plan.turn === 'round' && op.turn === 'round'));
      if (sameCurve) { best = o.s - o.len - cfg.minGap; break; }
      if (onCircle(link, o)) continue;   // measured along its own path, not this lane
      if (o.s - o.len < link.len + link.boxDepth) { best = o.s - o.len - cfg.minGap; break; }
    }
    if (m) {
      var to = m.to.cars, last = to[to.length - 1];
      if (last) best = Math.min(best, link.len + m.len + last.s - last.len - cfg.minGap);
    }
    return best;
  }

  // Is there a guaranteed space for `need` more cars on `link`? Cars on it short of its stop line,
  // and cars committed to a movement into it, each hold a space.
  function hasSpace(link, need) {
    if (link.closed) return false;
    if (link.capacity === Infinity) return true;
    var taken = link.incoming, line = link.stopLine + 0.5;
    for (var i = 0; i < link.cars.length; i++) if (link.cars[i].s <= line) taken += link.cars[i].slots || 1;
    return taken + (need || 1) <= link.capacity;
  }

  // Before a movement that must yield (a left turn: kind 'gap'; a side street at a two-way stop:
  // kind 'cross') may go, nobody it yields to may be arriving within `seconds`. That's every car
  // heading for one of those movements, and every car not yet decided, on their lanes and the
  // lanes feeding them. ('cross' also waits for a car right at its line.)
  function yieldClear(g, node, m, kind, seconds) {
    var set = {}, links = [];
    m.yieldTo.forEach(function (y) {
      if (y.kind !== kind) return;
      var o = g.net.movements[y.id];
      set[o.id] = true;
      if (links.indexOf(o.from) < 0) links.push(o.from);
    });
    function coming(c, d) {
      var cm = c.plan && c.plan.move;
      if (cm && cm.node === node && !set[cm.id]) return false;   // going somewhere that doesn't cross us
      return c.v > 5 && d < c.v * seconds;
    }
    for (var k = 0; k < links.length; k++) {
      var fl = links[k];
      for (var i = 0; i < fl.cars.length; i++) {
        var c = fl.cars[i], d = fl.stopLine - c.s;
        if (d < -0.001) continue;   // in the box: boxClear has it
        var cm = c.plan && c.plan.move;
        if (kind === 'cross' && d < c.len + 10 && !(cm && cm.node === node && !set[cm.id])) return false;
        if (coming(c, d)) return false;
      }
      for (var j = 0; j < fl.in.length; j++) {
        var pm = fl.in[j], cars = pm.from.cars;
        for (var q = 0; q < cars.length; q++) {
          var u = cars[q];
          if (u.plan && u.plan.move === pm && u.v > 5 && pm.from.len - u.s + pm.len + fl.stopLine < u.v * seconds) return false;
        }
      }
    }
    return true;
  }

  // May this car drive past the stop line it is approaching?
  function mayEnter(g, link, car) {
    var cfg = g.cfg, plan = car.plan, m = plan.move, L = link.to.state;
    if (!m || link.ends) return false;
    if (L.control === 'stop2' || L.control === 'stop4') return mayEnterSign(g, link, car);
    if (L.control === 'round') return plan.turn === 'round' && hasSpace(m.to) && roundClear(g, link, car);
    if (L.control !== 'light') return boxClear(L, m) && hasSpace(m.to, car.slots);
    if (L.phase === 'allred') return false;
    var phase = L.phases[L.cur];
    if (L.phase === 'arrow') {
      // Only this phase's arrow turns go on the arrow. Oncoming traffic is held, so no gap is
      // needed, but the box must be clear and the new lane must have room.
      if (phase.arrow.indexOf(m) < 0 || !boxClear(L, m)) return false;
      return hasSpace(m.to);
    }
    if (m.phase !== phase) return false;
    if (L.phase === 'amber') {
      // A left-turner already waiting at the line may finish its turn on amber, like real drivers
      // do when oncoming traffic stops. Otherwise only keep going if too close to stop comfortably.
      var waitingLeft = plan.turn === 'left' && car.v < 5 && link.stopLine - car.s < 2;
      var dist = link.stopLine - car.s;
      var stoppingDistance = car.v * car.v / (2 * cfg.brake * g.wx.brake);
      if (!waitingLeft && (car.v < 20 || dist > stoppingDistance)) return false;
    }
    // Cross traffic that entered before the light changed still has to clear the box, and a
    // left-turner from the other side may be crossing our path.
    if (!boxClear(L, m)) return false;
    if (plan.turn === 'left' && !yieldClear(g, link.to, m, 'gap', cfg.gapTime)) return false;
    // Don't block the box: only go if this car is guaranteed a space on the lane it ends up in.
    // (Checking only the car ahead wasn't enough: it could stop later and strand this car in the
    // box, and four stranded cars around a block froze the grid for good.)
    return hasSpace(m.to, plan.turn === 'straight' ? car.slots : 1);
  }

  // Stop signs. A car that has to stop must stand at the line for `signStop` seconds first. Then:
  //  two-way stop: the main road must be clear for `crossGap` seconds (main-road cars never stop,
  //    so the side street waits for a real gap, like real drivers do);
  //  all-way stop: cars go in the order they stopped. The car that stopped first picks the road
  //    that goes next, and anyone stopped on that road may go with it (opposite cars pass each
  //    other, as at a real four-way stop). A car whose way out is full is skipped, so one blocked
  //    car can't hold up the whole crossing (that could chain around a block into gridlock).
  // After that, the same rules as a green light: the box must be clear of conflicting traffic,
  // left turns need a gap, and nobody enters without a guaranteed space on the far side.
  function mayEnterSign(g, link, car) {
    var cfg = g.cfg, L = link.to.state, plan = car.plan, m = plan.move;
    var mustStop = L.control === 'stop4' || !isMajor(L, link);
    if (mustStop && (car.lineWait || 0) < cfg.signStop) return false;
    if (L.control === 'stop4' && stop4Group(L) !== link.toArm.group) return false;
    if (L.control === 'stop2' && mustStop && !yieldClear(g, link.to, m, 'cross', cfg.crossGap)) return false;
    if (!boxClear(L, m)) return false;
    if (plan.turn === 'left' && !yieldClear(g, link.to, m, 'gap', cfg.gapTime)) return false;
    return hasSpace(m.to, plan.turn === 'straight' ? car.slots : 1);
  }

  function isMajor(L, link) {
    return !!L.major && L.major.indexOf(link.toArm.toward.id) >= 0;
  }

  // Which road goes next at an all-way stop: the road of the first car in line that has room to go.
  function stop4Group(L) {
    for (var i = 0; i < L.queue.length; i++) {
      var q = L.queue[i], p = q.car.plan;
      if (!p || !p.move) continue;
      if (hasSpace(p.move.to, p.turn === 'straight' ? q.car.slots : 1)) return q.lane.toArm.group;
    }
    return null;
  }

  // ---- roundabouts
  //
  // Each car on a roundabout is placed on the circle by an angle-like "progress" u (radians,
  // growing the way cars drive). Cars on their way in or out count too, a bit before or after
  // their own entry and exit points, so a car always sees what is about to share its piece of road.
  function ringU(arc, d) {
    var R = arc.R;
    if (d < arc.ringStart) return arc.uIn - (arc.ringStart - d) / R;
    if (d <= arc.ringEnd) return arc.uIn + (d - arc.ringStart) / R;
    return arc.uIn + arc.sweep + (d - arc.ringEnd) / R;
  }

  function mod2pi(a) { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; }

  // Everyone on (or just entering or leaving) this roundabout: front and rear progress.
  function ringCars(g, L) {
    if (L.ringStamp === g.time) return L.ringList;
    var list = [];
    L.node.inLinks.forEach(function (link) {
      link.cars.forEach(function (c) {
        var p = c.plan;
        if (!p || p.turn !== 'round' || !p.move) return;
        // Only cars past their yield line: one waiting there isn't on the circle yet, and counting
        // it made the cars going round wait for it while it waited for them.
        var d = c.s - link.len;
        if (c.s <= link.stopLine || d - c.len > p.move.path.ringEnd + 10) return;
        var u = ringU(p.move.path, d);
        list.push({ car: c, front: u, rear: u - c.len / p.move.path.R });
      });
    });
    L.ringStamp = g.time;
    L.ringList = list;
    return list;
  }

  // May a car enter here? Nobody on the circle close enough upstream to reach the entry before this
  // car has slotted in, and nobody's rear just past it (room to slot in). A car starting from a stop
  // needs about a second to reach the circle, and a car going round covers ~55 px in that time, so
  // the clear distance needed grows the slower this car is (`roundYield` is the least it can be).
  function roundClear(g, link, car) {
    var arc = car.plan.move.path, list = ringCars(g, link.to.state), R = arc.R, cfg = g.cfg;
    var toRing = Math.max(0, arc.ringStart - (car.s - link.len));
    var v = Math.max(car.v, 1), speed = cfg.roundSpeed * g.wx.speed;
    var tReach = v >= speed ? toRing / speed : (speed - v) / (cfg.accel * g.wx.accel) + toRing / ((v + speed) / 2);
    var need = Math.max(cfg.roundYield, speed * (tReach + 0.3) + car.len);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.car === car) continue;
      var upstream = mod2pi(arc.uIn - o.rear) * R;          // entry point ahead of the other car's rear
      if (upstream < o.car.len + need) return false;
      var ahead = mod2pi(o.rear - arc.uIn) * R;             // the other car's rear past the entry
      if (ahead < car.len + cfg.minGap) return false;
    }
    return true;
  }

  // The furthest a car on the circle may go (in its own s): up to the nearest rear ahead of it.
  function ringLimit(g, link, car) {
    var arc = car.plan.move.path, list = ringCars(g, link.to.state);
    var front = ringU(arc, car.s - link.len), best = Infinity;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.car === car) continue;
      var gap = mod2pi(o.rear - front) * arc.R;
      // Only cars ahead on the circle, not ones just behind (whose rear wraps round to look far ahead).
      if (gap < 2 * Math.PI * arc.R - car.len - 4 && gap < best) best = gap;
      // A car alongside, its front just ahead of ours (one slotting in from an entry): give way.
      var frontGap = mod2pi(o.front - front) * arc.R;
      if (frontGap > 0 && frontGap < o.car.len && -g.cfg.minGap < best) best = -g.cfg.minGap;
    }
    return best === Infinity ? Infinity : car.s + best - g.cfg.minGap;
  }

  // Can a car at the end of its curve slot onto the new link right now? It would sit at the
  // link's start, so nothing there may be within a car length (plus the usual gap).
  function roomToJoin(g, car) {
    var to = car.plan.move.to, gap = g.cfg.minGap;
    for (var i = 0; i < to.cars.length; i++) {
      var c = to.cars[i];
      if (c !== car && c.s > -car.len - gap && c.s - c.len < gap) return false;
    }
    return true;
  }

  function moveCars(g, link, dt, joins) {
    var cfg = g.cfg, cars = link.cars, L = link.to.state;
    for (var i = 0; i < cars.length; i++) {
      var car = cars[i], plan = car.plan, m = plan && plan.move;
      // `limit` is the furthest the car's front may go: the car ahead's rear, or a stop line.
      var limit = leaderLimit(g, link, i, car);
      // A car still sliding out of this lane is still partly in it, and a car sliding in is still
      // partly in its old lane, so it keeps clear of the car ahead there too.
      link.ghosts.forEach(function (gh) {
        if (gh.s > car.s) limit = Math.min(limit, gh.s - gh.len - cfg.minGap);
      });
      if (car.shift > 0.25 && car.oldLane) {
        car.oldLane.cars.forEach(function (o) {
          if (o.s > car.s) limit = Math.min(limit, o.s - o.len - cfg.minGap);
        });
      }
      var approaching = !!plan && car.s <= link.stopLine + 0.001;
      // Zipper merge: where the other lane ends (or is closed past the next light), let in the merging car
      // just ahead. Without this the two queues sat side by side and the ending lane never got a gap.
      // Only when this lane has a space for it: the merging car can't move over without one, and
      // holding back then would only stop the car whose going frees one.
      if (approaching && link.other && !link.ends && roomToMerge(link)) {
        var merger = null, other = link.other;
        other.cars.forEach(function (c) {
          var cp = c.plan;
          var ends = cp && (other.ends || (cp.move && cp.move.to.closed && cp.turn === 'straight' && !cp.want));
          // Only a car it can still stop fully behind: one already alongside goes first instead.
          if (c.s - c.len - cfg.minGap >= car.s && c.s <= link.stopLine + 0.5 && ends && (!merger || c.s < merger.s)) merger = c;
        });
        if (merger) limit = Math.min(limit, merger.s - merger.len - cfg.minGap);
      }
      if (approaching && !mayEnter(g, link, car)) limit = Math.min(limit, link.stopLine);
      if (car.bus) limit = Math.min(limit, busStopLimit(link, car, dt));

      var wx = g.wx, brake = cfg.brake * wx.brake;
      var maxSpeed = link.maxSpeed * wx.speed * (car.bus ? BUS_SPEED : car.ambulance ? AMBULANCE_SPEED : 1);
      if (onCircle(link, car)) limit = Math.min(limit, ringLimit(g, link, car));
      if (m && plan.turn !== 'straight') {
        var cornerSpeed = (plan.turn === 'round' ? cfg.roundSpeed : plan.turn === 'left' ? cfg.leftTurnSpeed : cfg.rightTurnSpeed) * wx.speed;
        if (car.s > link.len) {
          maxSpeed = cornerSpeed;
          if (!roomToJoin(g, car)) limit = Math.min(limit, link.len + m.len);
        } else {
          // Slow down for the corner: the same braking rule, aimed at corner speed at the box.
          var toBox = link.len - car.s;
          maxSpeed = Math.min(maxSpeed, Math.sqrt(cornerSpeed * cornerSpeed + 2 * brake * toBox));
        }
      }

      // Safe-speed rule: from speed v a car needs v²/(2·brake) to stop, so the fastest
      // it can go and still stop within `room` is sqrt(2·brake·room).
      var room = Math.max(0, limit - car.s);
      var target = Math.min(maxSpeed, Math.sqrt(2 * brake * room));
      car.v = car.v < target ? Math.min(target, car.v + cfg.accel * wx.accel * dt) : target;

      var before = car.s;
      car.s = Math.min(car.s + car.v * dt, Math.max(car.s, limit));
      // Time standing at a stop sign's line; at an all-way stop, that's what joins the line to go.
      if (approaching && L && L.control !== 'light' && link.stopLine - car.s < 3 && car.v < 5) {
        var was = car.lineWait || 0;
        car.lineWait = was + dt;
        if (L.control === 'stop4' && m && was < cfg.signStop && car.lineWait >= cfg.signStop) L.queue.push({ car: car, lane: link });
      }
      if (car.v < 10 && !car.dwell) {
        car.wait += dt;
        car.totalWait += dt;
      }
      if (m && before <= link.stopLine && car.s > link.stopLine) {
        // Through the line: waiting time is per junction, so it resets. Mark the box right away so
        // cars checking later in this same step see this car in it, and hold its space ahead.
        car.wait = 0;
        car.lineWait = 0;
        if (L.queue.length) L.queue = L.queue.filter(function (q) { return q.car !== car; });
        L.occ[m.id] = true;
        m.to.incoming += car.slots || 1;
      }
      if (m && car.s >= link.len + m.len && (plan.turn === 'straight' || roomToJoin(g, car))) {
        joins.push({ car: car, from: link });
      }
    }
    while (link.to.type === 'edge' && cars.length && cars[0].s - cars[0].len > link.len) {
      var gone = cars.shift();
      // Buses and ambulances aren't trips people are timing, so they stay out of the numbers.
      if (gone.bus || gone.ambulance) continue;
      recordTrip(g, gone.totalWait, gone.id);
      g.score++;
    }
  }

  // A bus heads for the stop on its link, waits there BUS_DWELL seconds, then carries on.
  function busStopLimit(link, bus, dt) {
    var at = link.busStop;
    if (at === undefined || bus.servedLink === link) return Infinity;
    if (bus.dwell > 0) {
      bus.dwell -= dt;
      if (bus.dwell <= 0) { bus.dwell = 0; bus.servedLink = link; }
      return bus.s;
    }
    if (bus.s >= at - 0.5) {
      bus.dwell = BUS_DWELL;
      return bus.s;
    }
    return at;
  }

  // Lights ahead of an ambulance turn green for it and stay that way until it has gone through.
  // The usual rules still apply to everyone (amber, all-red, don't block the box), so this can't
  // cause gridlock; it only decides who gets the green.
  function clearWayForAmbulances(g) {
    g.lanes.forEach(function (link) {
      var L = link.to.state;
      if (!L || !isLight(L)) return;
      link.cars.forEach(function (car) {
        var m = car.ambulance && car.plan && car.plan.move;
        if (!m || car.s > link.stopLine || link.stopLine - car.s > AMBULANCE_REACH) return;
        if (m.phase !== L.phases[L.cur]) flip(g, L);
        else if (L.phase === 'arrow') { L.phase = 'green'; L.greenFor = 0; }
        L.holdUntil = Math.max(L.holdUntil || 0, g.time + 1);
        L.forAmbulance = g.time + 1;
      });
    });
  }

  // Cars just ahead of an ambulance get out of its way: on an avenue they move over when there's
  // room; on a one-lane street they ease toward the curb (only drawn, there's nowhere to go).
  function markYielding(g) {
    g.lanes.forEach(function (link) {
      var siren = null;
      for (var i = link.cars.length - 1; i >= 0; i--) {
        var c = link.cars[i];
        if (c.ambulance) { siren = c; c.aside = false; continue; }
        c.aside = !!siren && c.s - c.len - siren.s < YIELD_REACH && c.s > siren.s;
      }
    });
  }

  // Cars through a junction move onto their new link.
  function applyJoins(g, joins) {
    joins.forEach(function (j) {
      var car = j.car, m = car.plan.move, to = m.to;
      // The curve may end a little off the new lane's heading; ease that out instead of snapping.
      car.settle = wrap(m.path.pts[m.path.pts.length - 1].angle - to.heading);
      j.from.cars.splice(j.from.cars.indexOf(car), 1);
      car.s = Math.max(0, car.s - j.from.len - m.len);
      car.prevMove = m;
      var at = 0;
      while (at < to.cars.length && to.cars[at].s > car.s) at++;
      to.cars.splice(at, 0, car);
      car.plan = makePlan(g, to, null, car.rng);
    });
  }

  // ---------------------------------------------------------------- lane changes (avenues)

  // Space in front of a car in its own lane, and in the other lane from the same spot.
  function roomAhead(link, i, car) {
    return i > 0 ? link.cars[i - 1].s - link.cars[i - 1].len - car.s : Infinity;
  }

  function roomAheadIn(link, s) {
    var best = Infinity;
    for (var i = 0; i < link.cars.length; i++) {
      var c = link.cars[i];
      if (c.s > s && c.s - c.len - s < best) best = c.s - c.len - s;
    }
    return best;
  }

  // Could a car move into `link` as far as its space count goes? (No count on the first stretch
  // from the map edge.)
  function roomToMerge(link) {
    return link.from.type === 'edge' || hasSpace(link);
  }

  // Is `link` a dead end for a car going straight: it ends, or carries on into a closed stretch?
  function blocked(link) {
    var s = straightOut(link);
    return link.ends || !!(s && s.to.closed);
  }

  // May `car` slide sideways into `target` right now? It needs a real gap (the car behind in
  // the new lane must be able to brake) and, past a junction, a free space in that lane: the same
  // "don't block the box" bookkeeping, so a lane change can never overfill a stretch.
  function canMoveInto(g, target, car, from) {
    var cfg = g.cfg;
    if (target.closed) return false;
    for (var i = 0; i < target.cars.length; i++) {
      var c = target.cars[i];
      if (c.s >= car.s) {
        if (c.s - c.len - car.s < cfg.minGap + 4) return false;
      } else if (car.s - car.len - c.s < cfg.minGap - 0.5 + c.v * 0.6) {
        return false;
      }
    }
    if (from.from.type !== 'edge') {
      if (car.s - car.len < 2) return false;   // still in the junction behind
      if (!hasSpace(target, car.slots)) return false;
    }
    return true;
  }

  function changeLanes(g, dt) {
    var cfg = g.cfg, moves = [];
    g.lanes.forEach(function (link) {
      // Forget cars that have mostly finished sliding out of this lane.
      if (link.ghosts.length) link.ghosts = link.ghosts.filter(function (gh) { return gh.shift > 0.25 && link.other.cars.indexOf(gh) >= 0; });
      link.cars.forEach(function (car, i) {
        if (car.settle) car.settle = Math.abs(car.settle) < 0.01 ? 0 : car.settle * Math.pow(0.0001, dt / 0.35);
        if (car.shift > 0) car.shift = Math.max(0, car.shift - dt / car.shiftTime);
        if (car.cooldown > 0) car.cooldown -= dt;
        if (!link.other || car.shift > 0 || car.bus || car.ambulance) return;
        if (link.from.type === 'edge' && car.s < 2 * car.len) return;
        var plan = car.plan;
        if (!plan || car.s > link.stopLine) return;
        // The stretch past the next junction is closed, or this lane ends there: a car going
        // straight has to merge, even right at the line (it waits there for a gap in the other lane).
        if (link.ends || (plan.turn === 'straight' && !plan.want && plan.move && plan.move.to.closed)) {
          moves.push({ car: car, from: link, reason: 'merge' });
          return;
        }
        if (car.s > link.stopLine - cfg.laneChangeStopGap) {
          // Too close to the junction to move over: give up the turn and go straight instead.
          if (plan.want) car.plan = { move: straightOut(link), turn: 'straight' };
          return;
        }
        var reason = null;
        if (car.aside && plan.turn === 'straight' && !plan.want && !blocked(link.other)) reason = 'pass';
        else if (plan.want) reason = 'turn';
        else if (plan.turn === 'straight' && car.cooldown <= 0 && car.v < 0.6 * link.maxSpeed) {
          // Stuck behind a slow or stopped car (often a waiting left-turner), with clearly more
          // room in the other lane: pass.
          var here = roomAhead(link, i, car), there = roomAheadIn(link.other, car.s);
          if (here < 50 && there > here + 60 && !blocked(link.other)) reason = 'pass';
        }
        if (reason) moves.push({ car: car, from: link, reason: reason });
      });
    });
    moves.forEach(function (mv) {
      var car = mv.car, from = mv.from, to = from.other;
      if (from.cars.indexOf(car) < 0 || !canMoveInto(g, to, car, from)) return;
      from.cars.splice(from.cars.indexOf(car), 1);
      var at = 0;
      while (at < to.cars.length && to.cars[at].s > car.s) at++;
      to.cars.splice(at, 0, car);
      var a = linkPoint(from, car.s), b = linkPoint(to, car.s);
      car.shift = 1;
      car.oldLane = from;
      car.shiftVec = { x: a.x - b.x, y: a.y - b.y };   // from the new lane back to the old one
      car.shiftTime = cfg.laneChangeTime;
      car.cooldown = cfg.laneChangeCooldown;
      // Merging toward a roundabout, the car picks its exit there from its own random stream.
      var forced = mv.reason === 'turn' ? car.plan.want : to.to.state && to.to.state.control === 'round' ? null : 'straight';
      car.plan = makePlan(g, to, forced, car.rng);
      from.ghosts.push(car);
    });
  }

  function spawnRate(g) {
    var cfg = g.cfg;
    if (g.traffic !== null) {
      var hour = hourOfDay(g);
      if (g.kind === 'sunday') return g.traffic * curveAt(SUNDAY_TRAFFIC, hour);
      if (g.kind === 'stadium') return g.traffic * dayTraffic(hour) * STADIUM_DAY;
      var day = PLACE_DAY[g.cfg.place];
      return g.traffic * (day ? curveAt(day, hour) : dayTraffic(hour));
    }
    return Math.min(cfg.spawnMax, cfg.spawnBase + cfg.spawnGrowth * g.time);
  }

  // This entry lane's arrivals per second: the city-wide rate shaped by the traffic kind.
  function laneRate(g, link, rate) {
    var r = rate * link.share;
    if (g.kind === 'commute' && link.axis === 'ew') {
      var bias = curveAt(COMMUTE_BIAS, hourOfDay(g)) * COMMUTE_STRENGTH;
      r *= Math.exp(link.dir === 'E' ? bias : -bias);
    }
    if (link.crowd) r += g.traffic * STADIUM_BOOST * stadiumCrowd(g);
    return r;
  }

  function spawnCars(g, dt) {
    var cfg = g.cfg, rate = spawnRate(g);
    if (g.ambulances && g.time >= g.nextAmbulance) {
      sendAmbulance(g, g.ambulanceRng());
      g.nextAmbulance += AMBULANCE_EVERY * (0.6 + 0.8 * g.ambulanceRng());
    }
    g.sources.forEach(function (link) {
      // Buses keep their timetable whether or not they're switched on, so turning them on later
      // (or comparing two maps) doesn't shift anything else.
      if (link.busRoute && g.time >= link.nextBus) {
        link.nextBus += BUS_EVERY;
        if (g.buses) { link.busesWaiting = (link.busesWaiting || 0) + 1; link.buses++; }
      }
      // The timer counts down in "expected arrivals", not seconds: it drops by this lane's current
      // rate times dt. A gap measured in seconds would be fixed at whatever the rate was when it was
      // drawn, so a late-night gap of ~15 s would hold back the stadium crowd for half its burst.
      // Counting this way follows the rate as it changes (a varying-rate Poisson process).
      link.spawnTimer -= laneRate(g, link, rate) * dt;
      if (link.spawnTimer <= 0) {
        // Every arrival waits at the edge until it fits, however long the queue gets. Dropping
        // arrivals past a cap (as chill mode once did) hid the worst waits, flattered the more
        // jammed compare map, and broke "same cars on both maps" once the two dropped different cars.
        link.arrivals++;
        link.offMap++;
        link.pending.push({ n: link.arrivals, at: g.time });
        // Random gaps between arrivals (exponential), so traffic comes in clumps like real traffic.
        link.spawnTimer += -Math.log(1 - link.rng());
      }
      // Drivers queued too long at the edge give up. Their wait still counts as a trip: leaving it
      // out would make the most jammed city look best, the same flaw as dropping arrivals.
      while (g.chill && link.pending.length && g.time - link.pending[0].at >= cfg.giveUpAfter) {
        var quit = link.pending.shift();
        link.offMap--;
        recordTrip(g, g.time - quit.at, null);
        g.tally.gaveUp++;
      }
      var last = link.cars[link.cars.length - 1];
      var hasRoom = (!last || last.s - last.len >= cfg.minGap) && !link.ghosts.some(function (gh) {
        return gh.s - gh.len < cfg.minGap;
      });
      // An ambulance goes ahead of everyone queued at the edge, then any bus.
      if (hasRoom && (link.ambulancesWaiting || link.busesWaiting)) {
        var amb = link.ambulancesWaiting > 0;
        if (amb) link.ambulancesWaiting--; else link.busesWaiting--;
        var special = {
          id: g.nextId++, s: 0,
          v: last ? Math.min(cfg.maxSpeed, last.v) : cfg.maxSpeed * 0.8,
          len: amb ? AMBULANCE_LENGTH : BUS_LENGTH,
          slots: 2, wait: 0, totalWait: 0, rng: neverTurn,
          bus: !amb, ambulance: amb, dwell: 0
        };
        special.plan = makePlan(g, link, 'straight');
        link.cars.push(special);
        return;
      }
      if (link.offMap > 0 && hasRoom) {
        link.offMap--;
        var arrival = link.pending.shift();
        // Time queued off the map counts as waiting: the driver has been stopped since arriving.
        var edgeWait = g.time - arrival.at;
        var car = {
          id: g.nextId++,
          s: 0,
          v: last ? Math.min(cfg.maxSpeed, last.v) : cfg.maxSpeed * 0.8,
          len: cfg.carLength,
          wait: 0,        // seconds stopped at the current junction (drives the car's color)
          totalWait: edgeWait,   // seconds stopped over the whole trip, from arrival (drives the average wait)
          arrival: arrival.n,    // this car's number among the lane's arrivals (same car in both compare cities)
          rng: seeded(mixSeed(g.seed, link.sourceId, arrival.n))
        };
        car.plan = makePlan(g, link, null, car.rng);
        link.cars.push(car);
      }
    });
  }

  // ---------------------------------------------------------------- where to draw a car

  // Point and heading `s` px along a link, carrying on in a straight line past either end.
  function linkPoint(link, s) {
    if (s >= 0 && s <= link.len) return Net.pathPoint(link.path, s);
    var pts = link.path.pts, end = s < 0 ? pts[0] : pts[pts.length - 1], d = s < 0 ? s : s - link.len;
    return { x: end.x + Math.cos(end.angle) * d, y: end.y + Math.sin(end.angle) * d, angle: end.angle };
  }

  // Point and heading `back` px behind a car's front: along its movement once past the end of
  // its link, along the movement it came through while its rear is still in that box, and with
  // any lane change it is part way through.
  function carPoint(link, car, back) {
    var s = car.s - back, m = car.plan && car.plan.move;
    if (m && s > link.len) {
      var d = s - link.len;
      return d <= m.len ? Net.pathPoint(m.path, d) : linkPoint(m.to, d - m.len);
    }
    var pm = car.prevMove;
    if (s < 0 && pm && pm.to === link) {
      return s >= -pm.len ? Net.pathPoint(pm.path, pm.len + s) : linkPoint(pm.from, pm.from.len + pm.len + s);
    }
    var p = linkPoint(link, s);
    if (car.settle) p.angle += car.settle;
    if (car.shift > 0 && car.shiftVec) {
      // Mid lane change: drawn part of the way back toward the old lane, angled toward the new one.
      var sv = car.shiftVec, v = Math.max(car.v, 30);
      p.x += car.shift * sv.x;
      p.y += car.shift * sv.y;
      p.angle = Math.atan2(Math.sin(p.angle) * v - sv.y / car.shiftTime, Math.cos(p.angle) * v - sv.x / car.shiftTime);
    }
    return p;
  }

  // Which turn signal a car shows: for a planned turn as it nears the junction (or while turning),
  // for a lane change it wants to make, and while changing lanes.
  function signal(link, car, within) {
    var plan = car.plan;
    if (plan && plan.turn === 'round') return car.s < link.stopLine && car.s > link.stopLine - within && plan.exit !== 'straight' ? plan.exit : null;
    if (plan && plan.move && plan.turn !== 'straight' && car.s > link.stopLine - within) return plan.turn;
    if (plan && plan.want) return plan.want;
    if (car.shift > 0.15 && car.shiftVec) {
      // Moving toward the new lane, compared with the driver's right (screen y points down).
      var a = link.heading, tx = -car.shiftVec.x, ty = -car.shiftVec.y;
      return tx * -Math.sin(a) + ty * Math.cos(a) > 0 ? 'right' : 'left';
    }
    return null;
  }

  // ---------------------------------------------------------------- queues and losing

  // How full each entry lane's first stretch (map edge to the first junction) is.
  function edgeQueues(g) {
    var cfg = g.cfg;
    return g.sources.map(function (link) {
      var stretch = link.to.type === 'edge' ? link.len : link.stopLine;
      var capacity = Math.max(1, Math.floor((stretch + cfg.minGap) / (cfg.carLength + cfg.minGap)));
      var queued = 0;
      link.cars.forEach(function (car) {
        if (car.s <= stretch + 0.5 && car.v < 10) queued++;
      });
      return {
        lane: link,
        edge: link.edge,
        queued: Math.min(queued, capacity),
        capacity: capacity,
        offMap: link.offMap,
        // 0 = empty, 1 = the stretch is full, above 1 = cars stuck off the map
        pressure: Math.min(queued, capacity) / capacity + link.offMap / cfg.maxOffMap
      };
    });
  }

  function checkLose(g) {
    g.sources.forEach(function (link) {
      if (g.over) return;
      var last = link.cars[link.cars.length - 1];
      if (link.offMap >= g.cfg.maxOffMap && last && last.v < 5) {
        g.over = true;
        g.overReason = 'Traffic backed up off the ' + link.edge + ' edge.';
      }
    });
  }

  function step(g, dt) {
    if (g.over) return;
    g.time += dt;
    g.wx = WEATHER[currentWeather(g)];
    openDueRoads(g);
    if (g.chill) autoSwitch(g, dt);
    clearWayForAmbulances(g);
    markYielding(g);
    updateLights(g, dt);
    changeLanes(g, dt);
    markBoxes(g);
    var joins = [];
    g.lanes.forEach(function (link) { moveCars(g, link, dt, joins); });
    applyJoins(g, joins);
    spawnCars(g, dt);
    while (g.exits.length && g.exits[0].t < g.time - g.cfg.waitWindow) g.exits.shift();
    if (g.chill) {
      // "Today" starts again at midnight.
      var hour = hourOfDay(g);
      if (hour < g.lastHour) resetTally(g);
      g.lastHour = hour;
    }
    if (!g.chill) checkLose(g);
  }

  // A click from the player: switch now, and keep the strategy's hands off this light for a bit.
  function manualFlip(g, light) {
    if (!flip(g, light)) return false;
    light.holdUntil = g.time + g.cfg.manualHold;
    return true;
  }

  // ---------------------------------------------------------------- self-running lights

  // Cars within 160 px before each light, per light and phase: `stopped` counts the ones stopped
  // (or nearly), `all` every car there, moving or not. Cars on the lane before (heading straight
  // on toward this light) count too while within reach.
  function waitingCounts(g) {
    var counts = {};
    g.lights.forEach(function (l) { if (isLight(l)) counts[l.key] = l.phases.map(function () { return { stopped: 0, all: 0 }; }); });
    g.lanes.forEach(function (link) {
      var L = link.to.state;
      if (!L || !isLight(L) || link.phaseIndex < 0) return;
      var c = counts[L.key][link.phaseIndex];
      function count(car, d) {
        if (d >= -0.5 && d < 160) { if (car.v < 20) c.stopped++; c.all++; }
      }
      link.cars.forEach(function (car) { count(car, link.stopLine - car.s); });
      link.in.forEach(function (pm) {
        if (pm.turn !== 'straight') return;
        pm.from.cars.forEach(function (car) {
          if (car.plan && car.plan.move === pm) count(car, pm.from.len - car.s + pm.len + link.stopLine);
        });
      });
    });
    return counts;
  }

  function autoSwitch(g, dt) {
    var cfg = g.cfg;
    g.autoTimer -= dt;
    if (g.autoTimer > 0) return;
    g.autoTimer = cfg.autoCheckEvery;
    var counts = g.strategy === 'smart' ? waitingCounts(g) : null;
    // Timer lights start switching early so the new green begins on schedule after amber + all-red.
    var lead = cfg.amberTime + cfg.allRedTime;
    g.lights.forEach(function (l) {
      if (!isLight(l) || g.time < (l.holdUntil || 0) || l.phases.length < 2) return;
      // Smart lights end the arrow early once the left-turners have gone.
      if (l.phase === 'arrow' && g.strategy === 'smart' && l.greenFor >= cfg.arrowMin && !leftTurnersWaiting(g, l)) {
        l.phase = 'green';
        l.greenFor = 0;
        return;
      }
      if (l.phase === 'arrow' && g.strategy === 'smart') return;
      if (l.phase !== 'green' && l.phase !== 'arrow') return;
      if (g.strategy === 'smart') {
        if (l.greenFor < cfg.autoMinGreen) return;
        var c = counts[l.key], redSide = 0;
        c.forEach(function (p, i) { if (i !== l.cur) redSide = Math.max(redSide, p.stopped); });
        // The green side counts every car still coming through, not just stopped ones: a flowing
        // green has few stopped cars, so counting only those flipped it back after 3 s, and every
        // switch costs 2.1 s of amber and all-red. Waiting for the red side to be well ahead (more
        // than `smartRatio` times as many) lets a green finish its platoon.
        var greenSide = c[l.cur].all;
        if (redSide > cfg.smartRatio * greenSide || (redSide > 0 && l.greenFor >= cfg.autoMaxGreen)) flip(g, l);
      } else {
        // Timer and wave: each phase gets an equal share of the cycle, east-west first.
        var t = (g.time + lead - l.offset) % cfg.cycleTime;
        if (t < 0) t += cfg.cycleTime;
        var wanted = Math.min(l.phases.length - 1, Math.floor(t / (cfg.cycleTime / l.phases.length)));
        if (l.cur !== wanted) flip(g, l);
      }
    });
  }

  function nextRoadIn(g) {
    var next = g.cfg.roadSchedule[g.nextRoad];
    return next ? Math.max(0, next.at - g.time) : null;
  }

  var api = {
    CONFIG: CONFIG,
    createGame: createGame,
    createChill: createChill,
    carPoint: carPoint,
    linkPoint: linkPoint,
    lanePoint: linkPoint,
    signal: signal,
    setTraffic: setTraffic,
    setStrategy: setStrategy,
    setArrows: setArrows,
    manualFlip: manualFlip,
    hourOfDay: hourOfDay,
    darkness: darkness,
    dayPhase: dayPhase,
    averageWait: averageWait,
    waitingToEnter: waitingToEnter,
    resetTally: resetTally,
    KINDS: KINDS,
    PLACES: PLACE_NAMES,
    // Does this place have any lights (so the light strategy matters)?
    placeHasLights: placeHasLights,
    isLight: isLight,
    kindNote: kindNote,
    currentWeather: currentWeather,
    sendAmbulance: sendAmbulance,
    setBuses: function (g, on) { g.buses = on; },
    setWeather: function (g, w) { g.weather = w; },
    step: step,
    flip: flip,
    lightAt: lightAt,
    edgeQueues: edgeQueues,
    nextRoadIn: nextRoadIn
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficSim = api;
})(this);
