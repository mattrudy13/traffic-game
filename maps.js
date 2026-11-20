/*
 * Green Wave maps: every place as road-network data ({nodes, roads}), the format network.js builds
 * from and a map editor could save later.
 *
 *   nodes: { id: { x, y, type, control } }
 *     type     edge (cars enter and leave here) | junction (default) | deadend (a cul-de-sac:
 *              cars start here and drive out, nobody drives in)
 *     control  { type: light | stop2 | stop4 | round, major: [ids of the neighbour nodes on the
 *              main road] (stop2 only) }
 *   roads: [ { from, to, kind, lanes: [forward, back], weight } ]
 *     kind     street | avenue
 *     lanes    lanes going from -> to, and to -> from (0 for none)
 *     weight   scales the traffic that enters on this road (default 1)
 *
 * Downtown, Main Street and Crosstown are grids of straight roads running edge to edge, written as
 * grid specs that `gridMap` turns into nodes and roads. Suburb is hand-written (T-junctions and
 * cul-de-sacs); later maps will be too.
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
