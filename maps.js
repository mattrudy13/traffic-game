/*
 * Green Wave maps: every place as road-network data ({nodes, roads}), the format network.js builds
 * from and a map editor could save later.
 *
 *   nodes: { id: { x, y, type, control } }
 *     type     edge (cars enter and leave here) | junction (default) | deadend (a cul-de-sac:
 *              cars start here and drive out, nobody drives in)
 *     control  { type: light | stop2 | stop4 | round, major: [ids of the neighbour nodes on the
 *              main road] (stop2 only) }
 *   roads: [ { from, to, kind, lanes: [forward, back], weight, oneway, via, before, after } ]
 *     kind     street | avenue
 *     lanes    lanes going from -> to, and to -> from (0 for none)
 *     weight   scales the traffic that enters on this road (default 1)
 *     oneway   a one-way street: lanes [n, 0], only as wide as its lanes (a cul-de-sac's road
 *              has lanes [1, 0] too, but is drawn as a full street)
 *     via      bend points [x, y]: the road curves smoothly through them
 *     before, after   the points the road comes from and goes on to past its ends, so it carries
 *              on through a junction at the same angle (`chain` below fills these in)
 *   turns      'through' lets cars turn onto any road that runs straight on to the edge, not just
 *              one whose next junction is the edge (see network.js, buildDistances)
 *   scenery    things drawn under the roads: { type: 'river', pts, width }, { type: 'bridge',
 *              from, to, half } (railings either side of a road over water), { type: 'square',
 *              x, y, rx, ry } (a paved square)
 *
 * Downtown, Main Street and Crosstown are grids of straight roads running edge to edge, written as
 * grid specs that `gridMap` turns into nodes and roads. Suburb, Riverside and Old town are
 * hand-written.
 */
(function (root) {
  'use strict';

  // Downtown: 1, 2, 4 or 6 lights. The east-west roads are avenues; every crossing is a light.
  var DOWNTOWN = {
    1: [['v', 0.5], ['h', 0.5]],
    2: [['v', 0.3], ['v', 0.7], ['h', 0.5]],
    4: [['v', 0.3], ['v', 0.7], ['h', 0.34], ['h', 0.68]],
    6: [['v', 0.22], ['v', 0.5], ['v', 0.78], ['h', 0.34], ['h', 0.68]]
  };

  // The other places. Roads are [axis, pos, avenue, weight]. `control(vi, hi)` gets the crossing's
  // index among the north-south roads (west to east) and east-west roads (north to south).
  var PLACES = {
    main: {
      roads: [['v', 0.14], ['v', 0.38], ['v', 0.62], ['v', 0.86], ['h', 0.24], ['h', 0.62, true]],
      streetWeight: 0.5,
      control: function (vi, hi) {
        if (hi === 0) return { type: 'stop4' };
        return vi === 2 ? { type: 'light' } : { type: 'stop2', major: 'ew' };
      }
    },
    suburb: { map: suburbMap },
    riverside: { map: riversideMap },
    oldtown: { map: oldtownMap },
    crosstown: {
      roads: [['v', 0.17], ['v', 0.5, true, 0.6], ['v', 0.83], ['h', 0.24], ['h', 0.64, true, 0.6]],
      control: function (vi, hi) {
        if (vi === 1 && hi === 1) return { type: 'round' };
        if (vi === 1 || hi === 1) return { type: 'light' };
        return { type: 'stop4' };
      }
    }
  };

  // Challenge mode: roads open over time (seconds); all crossings are lights, no avenues.
  // The same schedule as sim.js's CONFIG.roadSchedule.
  var CHALLENGE = [
    { opensAt: 0, axis: 'v', pos: 0.5 },
    { opensAt: 0, axis: 'h', pos: 0.36 },
    { opensAt: 35, axis: 'v', pos: 0.22 },
    { opensAt: 80, axis: 'h', pos: 0.68 },
    { opensAt: 140, axis: 'v', pos: 0.78 }
  ];

  function lightsEverywhere() { return { type: 'light' }; }

  // Suburb, hand-written ("streets and courts", chosen from the Stage 2 mockups). Two through roads
  // cross at a roundabout. Quiet streets branch off them at T-junctions, where the side road stops,
  // and short courts (cul-de-sacs, type `deadend`) branch off the quiet streets. Cars start in the
  // courts and drive out; nobody drives in, so a court's road only has the lane leading out
  // (lanes [1, 0], from the court to the junction). It is still drawn full width, like any street.
  // Quiet streets carry half the traffic of the through roads at their map edge (weight 0.5).
  function suburbMap() {
    function edge(x, y) { return { x: x, y: y, type: 'edge' }; }
    function stop2(x, y, a, b) { return { x: x, y: y, control: { type: 'stop2', major: [a, b] } }; }
    function court(x, y) { return { x: x, y: y, type: 'deadend' }; }
    var nodes = {
      n666: edge(666, 0), s666: edge(666, 680), w449: edge(0, 449), e449: edge(1280, 449),
      w170: edge(0, 170), e300: edge(1280, 300), s330: edge(330, 680),
      R: { x: 666, y: 449, control: { type: 'round' } },
      // On the north-south through road: the north street comes in from the west, the east street from the east.
      M1: stop2(666, 170, 'n666', 'M2'), M2: stop2(666, 300, 'M1', 'R'),
      // Along the north street, and the east street.
      P1: stop2(230, 170, 'w170', 'P2'), P2: stop2(470, 170, 'P1', 'M1'), Q1: stop2(870, 300, 'M2', 'e300'),
      // On the east-west through road: a street south to the edge, and a spine into the south-east courts.
      S1: stop2(330, 449, 'w449', 'R'), S2: stop2(330, 575, 'S1', 's330'),
      S3: stop2(960, 449, 'R', 'e449'), S4: { x: 960, y: 575, control: { type: 'stop4' } },
      C1: court(230, 330), C2: court(470, 50), C3: court(870, 140), C5: court(520, 575), C6: court(790, 575), C7: court(1140, 575)
    };
    function road(from, to, weight, lanes) { return { from: from, to: to, kind: 'street', lanes: lanes || [1, 1], weight: weight || 1 }; }
    function courtRoad(from, to) { return road(from, to, 0.5, [1, 0]); }
    var roads = [
      road('n666', 'M1'), road('M1', 'M2'), road('M2', 'R'), road('R', 's666'),
      road('w449', 'S1'), road('S1', 'R'), road('R', 'S3'), road('S3', 'e449'),
      road('w170', 'P1', 0.5), road('P1', 'P2', 0.5), road('P2', 'M1', 0.5),
      road('M2', 'Q1', 0.5), road('Q1', 'e300', 0.5),
      road('S1', 'S2', 0.5), road('S2', 's330', 0.5),
      road('S3', 'S4', 0.5),
      courtRoad('C1', 'P1'), courtRoad('C2', 'P2'), courtRoad('C3', 'Q1'),
      courtRoad('C5', 'S2'), courtRoad('C6', 'S4'), courtRoad('C7', 'S4')
    ];
    return { nodes: nodes, roads: roads };
  }

  // One road drawn as a single line through several junctions: `pts` are node ids and [x, y] bend
  // points. Returns a road for each stretch between two nodes, each carrying on smoothly into the
  // next. A chain of nodes in a straight line gives plain straight roads.
  function chain(nodes, pts, props) {
    function xy(p) { return typeof p === 'string' ? [nodes[p].x, nodes[p].y] : p; }
    var P = pts.map(xy), straight = pts.every(function (p) { return typeof p === 'string'; }) && P.every(function (p, i) {
      if (i < 2) return true;
      var a = P[0], b = P[1];
      return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-6;
    });
    var roads = [], start = 0;
    for (var i = 1; i < pts.length; i++) {
      if (typeof pts[i] !== 'string') continue;
      var road = Object.assign({ from: pts[start], to: pts[i], kind: 'street', lanes: [1, 1] }, props);
      if (!straight) {
        road.via = P.slice(start + 1, i);
        if (start > 0) road.before = P[start - 1];
        if (i < pts.length - 1) road.after = P[i + 1];
      }
      roads.push(road);
      start = i;
    }
    return roads;
  }
  function edge(x, y) { return { x: x, y: y, type: 'edge' }; }
  function light(x, y) { return { x: x, y: y, control: { type: 'light' } }; }
  function stop2(x, y, a, b) { return { x: x, y: y, control: { type: 'stop2', major: [a, b] } }; }

  // Riverside ("meander", chosen from the Stage 3 mockups). The river winds west to east across
  // the middle; a bank road follows it on each side, and diagonal streets come in from the map
  // edges to meet them. One avenue bridge links the banks, with a light at each end: every trip
  // across the river uses it. Lights also where the busier diagonals meet the bank roads.
  function riversideMap() {
    var nodes = {
      wN: edge(0, 210), eN: edge(1280, 190), wS: edge(0, 430), eS: edge(1280, 410),
      n640: edge(640, 0), s640: edge(640, 680), n180: edge(180, 0), n1010: edge(1010, 0), s230: edge(230, 680), s1090: edge(1090, 680),
      // The bridge ends, on the north and south bank roads.
      NB: light(640, 245), SB: light(640, 475),
      // Where the diagonals meet the bank roads.
      // T2 sits well east of the bridge: westbound cars queue for the bridge light between them,
      // and with room for only 5 the queue reached the map edge on busy evenings.
      T1: light(400, 215), T2: stop2(1000, 165, 'NB', 'eN'), T3: stop2(400, 435, 'wS', 'SB'), T4: light(880, 415)
    };
    var roads = [].concat(
      chain(nodes, ['wN', [200, 180], 'T1', 'NB', [820, 205], 'T2', [1140, 160], 'eN']),
      chain(nodes, ['wS', [200, 400], 'T3', 'SB', 'T4', [1080, 370], 'eS']),
      chain(nodes, ['n640', 'NB', 'SB', 's640'], { kind: 'avenue', lanes: [2, 2] }),
      // The diagonals bend to meet the bank roads closer to square: met at a shallow angle, a
      // junction's box has to reach far along each road to clear the other one.
      chain(nodes, ['n180', [350, 100], 'T1'], { weight: 0.7 }), chain(nodes, ['s1090', [920, 540], 'T4'], { weight: 0.7 }),
      chain(nodes, ['n1010', 'T2'], { weight: 0.4 }), chain(nodes, ['s230', [360, 560], 'T3'], { weight: 0.4 })
    );
    return {
      nodes: nodes, roads: roads, turns: 'through',
      scenery: [
        { type: 'river', width: 112, pts: [[-80, 325], [0, 320], [200, 290], [400, 325], [640, 360], [880, 305], [1080, 260], [1280, 300], [1360, 305]] },
        { type: 'bridge', from: [640, 292], to: [640, 428], half: 59 }
      ]
    };
  }

  // Old town ("split round the square", chosen from the Stage 3 mockups). The west-east road splits
  // at a small roundabout into a one-way pair that curves round the market square and joins again
  // at a second roundabout, so the pair carries all west-east through traffic. A short main street
  // crosses the square north-south, with the town's only lights where it meets the pair. Old
  // lanes run out to the edges at odd angles.
  function oldtownMap() {
    var nodes = {
      wW: edge(0, 340), eE: edge(1280, 340), mN: edge(640, 0), mS: edge(640, 680),
      n300: edge(300, 0), s980: edge(980, 680), sW: edge(120, 680), nE: edge(1160, 0),
      RW: { x: 230, y: 340, control: { type: 'round' } }, RE: { x: 1050, y: 340, control: { type: 'round' } },
      L1: light(640, 212), L2: light(640, 468),
      N1: stop2(430, 232, 'RW', 'L1'), S2: stop2(850, 448, 'RE', 'L2')
    };
    var one = { oneway: true, lanes: [1, 0] };
    var roads = [].concat(
      chain(nodes, ['RW', [300, 262], 'N1', 'L1', [850, 232], [980, 262], 'RE'], one),   // eastbound, north of the square
      chain(nodes, ['RE', [980, 418], 'S2', 'L2', [430, 448], [300, 418], 'RW'], one),   // westbound, south of it
      chain(nodes, ['mN', 'L1', 'L2', 'mS']),
      chain(nodes, ['wW', 'RW']), chain(nodes, ['RE', 'eE']),
      chain(nodes, ['n300', 'N1'], { weight: 0.5 }), chain(nodes, ['S2', 's980'], { weight: 0.5 }),
      chain(nodes, ['RW', [170, 500], 'sW'], { weight: 0.5 }), chain(nodes, ['RE', [1110, 180], 'nE'], { weight: 0.5 })
    );
    return {
      nodes: nodes, roads: roads, turns: 'through',
      scenery: [{ type: 'square', x: 640, y: 340, rx: 300, ry: 92 }]
    };
  }

  // A grid spec -> {nodes, roads}. Roads run edge to edge and every crossing is a junction.
  // Node ids come from coordinates (j640_340, edges n640 / s640 / w340 / e340), so they stay the
  // same when challenge mode opens another road and the network is rebuilt.
  function gridMap(spec, width, height) {
    var nodes = {}, roads = [];
    var vs = [], hs = [];
    spec.roads.forEach(function (r) {
      var road = { c: Math.round(r.pos * (r.axis === 'v' ? width : height)), avenue: !!r.avenue, weight: r.weight || 1 };
      (r.axis === 'v' ? vs : hs).push(road);
    });
    vs.sort(function (a, b) { return a.c - b.c; });
    hs.sort(function (a, b) { return a.c - b.c; });
    var control = spec.control || lightsEverywhere;

    function jid(v, h) { return 'j' + v.c + '_' + h.c; }
    vs.forEach(function (v, vi) {
      hs.forEach(function (h, hi) {
        var c = control(vi, hi);
        var node = { x: v.c, y: h.c, type: 'junction', control: { type: c.type } };
        nodes[jid(v, h)] = node;
        if (c.type === 'stop2') {
          // The main road's two neighbours: west and east for an east-west main road, else north and south.
          node.control.major = c.major === 'ew'
            ? [vi > 0 ? jid(vs[vi - 1], h) : 'w' + h.c, vi < vs.length - 1 ? jid(vs[vi + 1], h) : 'e' + h.c]
            : [hi > 0 ? jid(v, hs[hi - 1]) : 'n' + v.c, hi < hs.length - 1 ? jid(v, hs[hi + 1]) : 's' + v.c];
        }
      });
    });
    function chain(ids, r) {
      for (var i = 0; i + 1 < ids.length; i++) {
        roads.push({ from: ids[i], to: ids[i + 1], kind: r.avenue ? 'avenue' : 'street',
          lanes: r.avenue ? [2, 2] : [1, 1], weight: r.weight });
      }
    }
    // North-south roads run north to south (forward = southbound); east-west ones west to east.
    vs.forEach(function (v) {
      nodes['n' + v.c] = { x: v.c, y: 0, type: 'edge' };
      nodes['s' + v.c] = { x: v.c, y: height, type: 'edge' };
      chain(['n' + v.c].concat(hs.map(function (h) { return jid(v, h); }), ['s' + v.c]), v);
    });
    hs.forEach(function (h) {
      nodes['w' + h.c] = { x: 0, y: h.c, type: 'edge' };
      nodes['e' + h.c] = { x: width, y: h.c, type: 'edge' };
      chain(['w' + h.c].concat(vs.map(function (v) { return jid(v, h); }), ['e' + h.c]), h);
    });
    return { nodes: nodes, roads: roads };
  }

  // The map for a place: Downtown with 1/2/4/6 lights, or one of the other places.
  function placeMap(place, lights, width, height) {
    if (PLACES[place]) {
      var p = PLACES[place];
      if (p.map) return p.map(width, height);
      var map = gridMap({
        roads: p.roads.map(function (r) { return { axis: r[0], pos: r[1], avenue: !!r[2], weight: r[3] || 1 }; }),
        control: p.control
      }, width, height);
      map.streetWeight = p.streetWeight || 1;
      return map;
    }
    var layout = DOWNTOWN[lights] || DOWNTOWN[4];
    return gridMap({
      roads: layout.map(function (r) { return { axis: r[0], pos: r[1], avenue: r[0] === 'h' }; })
    }, width, height);
  }

  // Challenge mode's map at `time`: only the roads open by then.
  function challengeMap(time, width, height) {
    return gridMap({ roads: CHALLENGE.filter(function (r) { return r.opensAt <= time; }) }, width, height);
  }

  var api = {
    DOWNTOWN: DOWNTOWN,
    PLACES: PLACES,
    CHALLENGE: CHALLENGE,
    gridMap: gridMap,
    placeMap: placeMap,
    challengeMap: challengeMap
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficMaps = api;
})(this);
