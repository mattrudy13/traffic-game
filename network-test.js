// Network test: builds the road network (maps.js + network.js) for every place and challenge
// stage and checks:
//   - it matches network-baseline.json: every lane's ends and stop line, which lanes end or are
//     closed, and every movement's turn, path length, whether it's allowed, and what it conflicts
//     with and yields to. The snapshot was saved when Stage 1 merged, after this network had been
//     checked against the engine before it (same stop lines, turn paths and allowed turns), so a
//     difference means the geometry or the rules changed;
//   - conflicts, yields and phases come out the way the junction rules say they should,
//     Suburb's cul-de-sacs and T-junctions work as maps.js describes, and Riverside's and Old
//     town's looser turning rule lets traffic onto the bridge and into the one-way pair;
//   - every movement's path joins its two links, and every allowed movement brings its car closer
//     to an exit.
//   node network-test.js          check
//   node network-test.js --save   re-save network-baseline.json (only for a change meant to move it)
// Takes ~1 s.
var fs = require('fs'), Sim = require('./sim.js'), Maps = require('./maps.js'), Net = require('./network.js');
var cfg = Sim.CONFIG, W = cfg.width, H = cfg.height;
var SNAPSHOT = __dirname + '/network-baseline.json';
var failures = [], checks = 0, snapshot = {};

function check(ok, msg) { checks++; if (!ok && failures.length < 40) failures.push(msg); if (!ok) failures.count = (failures.count || 0) + 1; }
function near(a, b, tol) { return Math.hypot(a.x - b.x, a.y - b.y) <= (tol || 0.01); }
function key(p) { return Math.round(p.x * 10) / 10 + ',' + Math.round(p.y * 10) / 10; }
function dirOf(h) { return ['E', 'S', 'W', 'N'][((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4]; }
// A compact, rounded record of one map's network, for the snapshot.
function round1(x) { return x === null || x === undefined ? null : Math.round(x * 10) / 10; }
// FNV-1a, as 8 hex digits.
function hash(text) {
  var h = 0x811c9dc5;
  for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}
function linkKey(l) { return l.from.id + '>' + l.to.id + '#' + l.index; }
function record(net) {
  var links = {}, moves = {};
  net.links.forEach(function (l) {
    var a = l.path.pts[0], b = l.path.pts[l.path.pts.length - 1];
    links[linkKey(l)] = [round1(a.x), round1(a.y), round1(b.x), round1(b.y), round1(l.stopLine), l.closed ? 1 : 0, l.ends ? 1 : 0];
  });
  net.movements.forEach(function (m) {
    var conflicts = m.conflicts.map(function (id) { var o = net.movements[id]; return linkKey(o.from) + '->' + linkKey(o.to); }).sort();
    var yields = m.yieldTo.map(function (y) { var o = net.movements[y.id]; return y.kind + ':' + linkKey(o.from) + '->' + linkKey(o.to); }).sort();
    // Conflicts and yields are kept as a count and a short hash of the sorted list, so the file
    // stays small; a change still shows up, and the count says which way it went.
    moves[linkKey(m.from) + '->' + linkKey(m.to)] = [m.turn, m.exit, m.allowed ? 1 : 0, round1(m.len),
      conflicts.length + ':' + hash(conflicts.join(' ')), yields.length + ':' + hash(yields.join(' '))];
  });
  return { links: links, moves: moves };
}

function compare(name, net, saved) {
  var now = record(net);
  snapshot[name] = now;
  if (!saved) return;
  var was = saved[name];
  check(!!was, name + ': not in network-baseline.json');
  if (!was) return;
  ['links', 'moves'].forEach(function (kind) {
    Object.keys(was[kind]).forEach(function (k) {
      check(k in now[kind], name + ' ' + kind + ' ' + k + ': gone');
      if (k in now[kind]) check(JSON.stringify(now[kind][k]) === JSON.stringify(was[kind][k]), name + ' ' + kind + ' ' + k + ': was ' + JSON.stringify(was[kind][k]) + ', now ' + JSON.stringify(now[kind][k]));
    });
    Object.keys(now[kind]).forEach(function (k) { check(k in was[kind], name + ' ' + kind + ' ' + k + ': new'); });
  });
}

// Rules that hold everywhere, whatever the map.
function general(name, net) {
  net.movements.forEach(function (m) {
    var where = name + ' ' + m.node.id + ' ' + dirOf(m.from.heading) + ' ' + m.turn + (m.turn === 'round' ? ' ' + m.exit : '');
    var a = m.path.pts[0], b = m.path.pts[m.path.pts.length - 1];
    check(near(a, m.from.path.pts[m.from.path.pts.length - 1]) && near(b, m.to.path.pts[0]), where + ': path does not join its links');
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

// Riverside and Old town (`turns: 'through'`): cars on a bank road can turn onto the bridge, cars on
// Old town's main street can turn into the one-way pair, and no lane runs the wrong way up a
// one-way street.
function throughRules(name, net) {
  function allowed(from, at, to) {
    return net.movements.some(function (m) { return m.allowed && m.from.from.id === from && m.node.id === at && m.to.to.id === to; });
  }
  if (name === 'riverside') {
    check(allowed('T1', 'NB', 'SB') && allowed('T2', 'NB', 'SB'), 'riverside: north bank road cannot turn onto the bridge');
    check(allowed('T3', 'SB', 'NB') && allowed('T4', 'SB', 'NB'), 'riverside: south bank road cannot turn onto the bridge');
  }
  if (name === 'oldtown') {
    check(allowed('mN', 'L1', 'RE'), 'oldtown: main street cannot turn into the eastbound one-way');
    check(allowed('mS', 'L2', 'RW'), 'oldtown: main street cannot turn into the westbound one-way');
  }
  net.roads.forEach(function (r) {
    if (!r.oneway) return;
    var back = net.links.filter(function (l) { return l.road === r && l.side === 'back'; });
    check(back.length === 0, name + ': one-way road ' + r.from.id + '-' + r.to.id + ' has a lane the wrong way');
  });
}

// Suburb's T-junctions and cul-de-sacs: every court is a source with a way out, no lane leads into
// a court, and at each two-way stop the side road yields to the main road it crosses or joins.
function suburbRules(net) {
  var courts = net.nodeList.filter(function (n) { return n.type === 'deadend'; });
  check(courts.length === 6, 'suburb: ' + courts.length + ' cul-de-sacs, expected 6');
  courts.forEach(function (c) {
    check(c.inLinks.length === 0, 'suburb ' + c.id + ': a lane leads into the cul-de-sac');
    var src = net.sources.filter(function (s) { return s.link.from === c; });
    check(src.length === 1 && src[0].home && isFinite(src[0].link.d), 'suburb ' + c.id + ': not a source with a way out');
  });
  var tees = net.nodeList.filter(function (n) { return n.type === 'junction' && n.arms.length === 3; });
  check(tees.length === 9, 'suburb: ' + tees.length + ' T-junctions, expected 9');
  tees.forEach(function (node) {
    if (node.control.type !== 'stop2') return;
    node.movements.forEach(function (m) {
      var minor = node.control.major.indexOf(m.from.toArm.toward.id) < 0;
      var cross = m.yieldTo.filter(function (y) { return y.kind === 'cross'; }).length;
      if (!minor) check(cross === 0, 'suburb ' + node.id + ': main road yields');
      else check(cross > 0, 'suburb ' + node.id + ': side road ' + m.turn + ' yields to nobody');
    });
  });
}

var save = process.argv[2] === '--save';
var saved = save ? null : JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
Sim.PLACES.forEach(function (place) {
  (place === 'downtown' ? [1, 2, 4, 6] : [4]).forEach(function (n) {
    var name = place + (place === 'downtown' ? ' ' + n : '');
    var net = Net.buildNetwork(Maps.placeMap(place, n, W, H), cfg);
    compare(name, net, saved);
    general(name, net);
    if (place === 'downtown') lightRules(name, net);
    if (place === 'main') stopRules(net);
    if (place === 'suburb') suburbRules(net);
    if (place === 'riverside' || place === 'oldtown') throughRules(name, net);
  });
});
[0, 35, 80, 140].forEach(function (t) {
  var name = 'challenge at ' + t + ' s';
  var net = Net.buildNetwork(Maps.challengeMap(t, W, H), cfg);
  compare(name, net, saved);
  general(name, net);
});

if (save) {
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot) + '\n');
  console.log('saved ' + Object.keys(snapshot).length + ' maps to network-baseline.json');
}
console.log(checks + ' checks');
if (failures.length) {
  failures.forEach(function (f) { console.log('  ' + f); });
  console.log(failures.count + ' failed');
  process.exitCode = 1;
} else {
  console.log('network matches network-baseline.json and the junction rules');
}
