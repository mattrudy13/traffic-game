// Network test: builds the new road network (maps.js + network.js) for every place and challenge
// stage, and checks it against what today's engine (sim.js) builds for the same map:
//   - every stop line and box edge is in the same spot, and lanes that end or close match;
//   - every turn today's engine offers exists as a movement, along the same path;
//   - every turn today's gridlock rule allows is also allowed by distance-to-exit;
//   - conflicts, yields and phases come out the way today's hand-written rules say they should;
//   - every movement's path joins its two links, and every allowed movement brings its car closer
//     to an exit.
// Run with:  node network-test.js   (takes ~1 s)
var Sim = require('./sim.js'), Maps = require('./maps.js'), Net = require('./network.js');
var cfg = Sim.CONFIG, W = cfg.width, H = cfg.height;
var failures = [], extraTurns = 0, checks = 0;

function check(ok, msg) { checks++; if (!ok && failures.length < 40) failures.push(msg); if (!ok) failures.count = (failures.count || 0) + 1; }
function near(a, b, tol) { return Math.hypot(a.x - b.x, a.y - b.y) <= (tol || 0.01); }
function key(p) { return Math.round(p.x * 10) / 10 + ',' + Math.round(p.y * 10) / 10; }
function dirOf(h) { return ['E', 'S', 'W', 'N'][((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4]; }
var HEADING = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

function compare(name, g, net) {
  var byEnd = {}, byStart = {};
  net.links.forEach(function (l) {
    byEnd[key(l.path.pts[l.path.pts.length - 1]) + dirOf(l.heading)] = l;
    byStart[key(l.path.pts[0]) + dirOf(l.heading)] = l;
  });
  var stops = 0;
  g.lanes.forEach(function (lane) {
    lane.stops.forEach(function (stop, i) {
      stops++;
      var where = name + ' lane ' + lane.dir + '@' + lane.coord + ' stop ' + i;
      var link = byEnd[key(Sim.lanePoint(lane, stop.boxStart)) + lane.dir];
      check(!!link, where + ': no link ends at its box');
      if (!link) return;
      check(near(Net.linkPoint(link, link.stopLine), Sim.lanePoint(lane, stop.line)), where + ': stop line moved');
      check(!!stop.laneEnds === link.ends, where + ': lane ends ' + !!stop.laneEnds + ' vs ' + link.ends);
      var after = byStart[key(Sim.lanePoint(lane, stop.boxEnd)) + lane.dir];
      check(!!after || stop.laneEnds, where + ': no link starts past its box');
      if (after) check(!!stop.closed === after.closed, where + ': closed ' + !!stop.closed + ' vs ' + after.closed);

      // The turns today's engine offers here, each with its own lane on the far side.
      var expected = [];
      var round = stop.light.control === 'round';
      Object.keys(stop.turns).forEach(function (t) {
        var turn = stop.turns[t];
        // Today every avenue lane lists both turns, but a car only turns left from the inner lane
        // and right from the curb lane (the other lane changes over first).
        if (!round && ((t === 'left' && lane.position === 'curb') || (t === 'right' && lane.position === 'inner'))) return;
        // A lane that ends at a roundabout lists its ways round too, but no car may take them.
        if (stop.laneEnds) return;
        var to = byStart[key(Sim.lanePoint(turn.lane, turn.stop.boxEnd)) + turn.lane.dir];
        expected.push({ label: t, to: to, arc: turn.arc, oldAllowed: round ? true : turn.stop.capacity === Infinity && !turn.stop.closed });
      });
      if (!round && !stop.laneEnds) expected.push({ label: 'straight', to: after, oldAllowed: true });
      expected.forEach(function (e) {
        var m = link.out.filter(function (m) { return m.to === e.to && (round ? m.exit === e.label : m.turn === e.label); })[0];
        check(!!m, where + ': no ' + e.label + ' movement');
        if (!m) return;
        if (e.arc) {
          var p0 = e.arc.pts ? e.arc.pts[0] : e.arc.p0, p2 = e.arc.pts ? e.arc.pts[e.arc.pts.length - 1] : e.arc.p2;
          check(near(m.path.pts[0], p0) && near(m.path.pts[m.path.pts.length - 1], p2), where + ' ' + e.label + ': path ends moved');
          check(Math.abs(m.len - e.arc.len) < 0.5, where + ' ' + e.label + ': path length ' + m.len.toFixed(1) + ' vs ' + e.arc.len.toFixed(1));
        }
        if (e.oldAllowed && !(e.to && e.to.closed)) check(m.allowed, where + ' ' + e.label + ': allowed today, not by distance to exit');
      });
      check(link.out.length === expected.length, where + ': ' + link.out.length + ' movements, expected ' + expected.length);
      link.out.forEach(function (m) {
        if (m.allowed && m.turn !== 'straight' && m.turn !== 'round' && !expected.some(function (e) { return e.label === m.turn && e.oldAllowed; })) extraTurns++;
      });
    });
  });
  var junctionLinks = net.links.filter(function (l) { return l.to.type === 'junction'; }).length;
  check(junctionLinks === stops, name + ': ' + junctionLinks + ' links into junctions, ' + stops + ' stops today');
  check(net.links.length === stops + g.lanes.length, name + ': ' + net.links.length + ' links, expected ' + (stops + g.lanes.length));
  check(net.lights.length === g.lights.filter(Sim.isLight).length, name + ': light count');
}

// Rules that hold everywhere, whatever the map.
function general(name, net) {
  net.movements.forEach(function (m) {
    var where = name + ' ' + m.node.id + ' ' + dirOf(m.from.heading) + ' ' + m.turn + (m.turn === 'round' ? ' ' + m.exit : '');
    var a = m.path.pts[0], b = m.path.pts[m.path.pts.length - 1];
    check(near(a, m.from.path.pts[1]) && near(b, m.to.path.pts[0]), where + ': path does not join its links');
    if (m.turn !== 'round') check(Math.abs(Math.atan2(Math.sin(a.angle - m.from.heading), Math.cos(a.angle - m.from.heading))) < 0.05, where + ': path starts at an angle');
    if (m.allowed) check(m.to.d < m.from.d, where + ': allowed but d does not shrink');
    if (m.turn === 'straight' && !m.to.closed) check(m.allowed, where + ': going straight on should always be allowed');
    m.yieldTo.forEach(function (y) { check(m.conflicts.indexOf(y.id) >= 0, where + ': yields to a movement it does not conflict with'); });
  });
  net.sources.forEach(function (s) {
    var l = s.link;
    // A lane with no way out of its own is fine if its neighbour has one: cars move over (a lane closing).
    var out = isFinite(l.d) || l.siblings.some(function (sib) { return isFinite(sib.d); });
    check(out, name + ' source ' + l.from.id + '#' + l.index + ': no way out');
  });
}

// Today's hand-written rules at a light, checked against geometry: Downtown's crossings are a
// north-south street across an east-west avenue.
function lightRules(name, net) {
  net.lights.forEach(function (node) {
    var where = name + ' ' + node.id;
    function mv(dir, turn) {
      return node.movements.filter(function (m) { return dirOf(m.from.heading) === dir && m.turn === turn && (turn !== 'straight' || m.from.index === 0); })[0];
    }
    function conflict(a, b) { return a.conflicts.indexOf(b.id) >= 0; }
    function yields(a, b) { return a.yieldTo.some(function (y) { return y.id === b.id; }); }
    var eL = mv('E', 'left'), wL = mv('W', 'left'), nL = mv('N', 'left'), sL = mv('S', 'left');
    var eS = mv('E', 'straight'), wS = mv('W', 'straight'), nS = mv('N', 'straight');
    var eR = mv('E', 'right'), wR = mv('W', 'right');
    check(eL && wL && nL && sL && eS && wS && nS && eR && wR, where + ': missing a movement');
    if (!(eL && wL && nL && sL && eS && wS && nS && eR && wR)) return;
    check(!conflict(eL, wL), where + ': avenue lefts should pass each other');
    check(conflict(nL, sL), where + ': street lefts should take turns');
    check(!conflict(eS, wS), where + ': opposite straights should not conflict');
    check(conflict(eS, nS), where + ': crossing straights should conflict');
    check(!conflict(eR, wR), where + ': opposite rights should not conflict');
    check(conflict(eL, wS) && yields(eL, wS), where + ': left should yield to oncoming straight');
    check(!yields(eL, wL), where + ': left should not yield to oncoming left');
    check(!yields(eS, wL), where + ': straight never yields');
    var tags = node.phases.map(function (p) { return p.tag; }).sort().join(',');
    check(tags === 'ew,ns', where + ': phases ' + tags);
    var ew = node.phases.filter(function (p) { return p.tag === 'ew'; })[0];
    var ns = node.phases.filter(function (p) { return p.tag === 'ns'; })[0];
    check(ew && ew.arrow.length === 2 && ns && ns.arrow.length === 0, where + ': only the avenue gets left arrows');
  });
}

// Main Street's two-way stops: the side street yields to the main (east-west) road.
function stopRules(net) {
  net.nodeList.filter(function (n) { return n.control && n.control.type === 'stop2'; }).forEach(function (node) {
    var where = 'main ' + node.id;
    node.movements.forEach(function (m) {
      var minor = dirOf(m.from.heading) === 'N' || dirOf(m.from.heading) === 'S';
      var crossYields = m.yieldTo.filter(function (y) { return y.kind === 'cross'; }).length;
      if (!minor) check(crossYields === 0, where + ': main road yields');
      if (minor && m.turn === 'straight') check(crossYields >= 2, where + ': side street straight should yield to both main directions');
    });
  });
}

Sim.PLACES.forEach(function (place) {
  (place === 'downtown' ? [1, 2, 4, 6] : [4]).forEach(function (n) {
    var name = place + (place === 'downtown' ? ' ' + n : '');
    var g = Sim.createChill(n, 0.3, { seed: 1, place: place });
    var net = Net.buildNetwork(Maps.placeMap(place, n, W, H), cfg);
    compare(name, g, net);
    general(name, net);
    if (place === 'downtown') lightRules(name, net);
    if (place === 'main') stopRules(net);
  });
});
[0, 35, 80, 140].forEach(function (t) {
  var schedule = cfg.roadSchedule.filter(function (r) { return r.at <= t; }).map(function (r) { return Object.assign({}, r, { at: 0 }); });
  var g = Sim.createGame({ seed: 1, roadSchedule: schedule });
  var net = Net.buildNetwork(Maps.challengeMap(t, W, H), cfg);
  compare('challenge at ' + t + ' s', g, net);
  general('challenge at ' + t + ' s', net);
});

console.log(checks + ' checks; distance to exit allows ' + extraTurns + ' turns today\'s rule does not');
if (failures.length) {
  failures.forEach(function (f) { console.log('  ' + f); });
  console.log(failures.count + ' failed');
  process.exitCode = 1;
} else {
  console.log('network matches today\'s engine');
}
