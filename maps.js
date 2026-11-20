/*
 * Green Wave maps: every place as road-network data ({nodes, roads}), the format network.js builds
 * from and a map editor could save later.
 *
 *   nodes: { id: { x, y, type, control } }
 *     type     edge (cars enter and leave here) | junction (default)
 *     control  { type: light | stop2 | stop4 | round, major: [ids of the neighbour nodes on the
 *              main road] (stop2 only) }
 *   roads: [ { from, to, kind, lanes: [forward, back], weight } ]
 *     kind     street | avenue
 *     lanes    lanes going from -> to, and to -> from
 *     weight   scales the traffic that enters on this road (default 1)
 *
 * Every place today is a grid of straight roads running edge to edge, so the places are written as
 * grid specs and `gridMap` turns a spec into nodes and roads. Later stages add hand-written maps
 * (T-junctions, dead ends, curves) that skip the grid step.
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
    suburb: {
      roads: [['v', 0.22, false, 0.5], ['v', 0.52], ['v', 0.8, false, 0.5], ['h', 0.3, false, 0.5], ['h', 0.66]],
      control: function (vi, hi) {
        if (vi === 1 && hi === 1) return { type: 'round' };
        if (vi === 1) return { type: 'stop2', major: 'ns' };
        if (hi === 1) return { type: 'stop2', major: 'ew' };
        return { type: 'stop4' };
      }
    },
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
