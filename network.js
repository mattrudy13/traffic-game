/*
 * Green Wave road network: turns map data (maps.js) into what the simulation drives on.
 *
 *   link      one lane of one road, from the edge of one junction's box to the edge of the next
 *             (or a map edge). A car's `s` is the distance along its link. `stopLine` is where it
 *             waits before the next junction.
 *   node      a junction, a map edge or a cul-de-sac (deadend). A junction has arms (one per road, sorted by angle) and
 *             movements (incoming link -> outgoing link, with a path through the box).
 *   conflict  two movements whose paths come within a car's width (plus a margin) of each other.
 *             Worked out once from geometry, instead of hand-written rules per crossing type.
 *   yieldTo   the conflicting movements this one must find a gap in before it goes: a left turn
 *             yields to oncoming traffic, a side street at a two-way stop yields to the main road.
 *   phase     a group of movements a light lets go together (two opposite arms, or one arm).
 *   source    a link cars start on: from a map edge, or out of a cul-de-sac (`home`).
 *   d         a link's distance to exit: the longest drive to the edge using allowed movements.
 *             Every allowed movement leads to a link with a smaller d, which rules out gridlock
 *             (see buildDistances).
 *
 * Nothing here moves cars; sim.js does that. This file only builds the network once per map
 * (challenge mode rebuilds it when a road opens).
 */
(function (root) {
  'use strict';

  // Lane width, median and speed (as a multiple of the base speed) for each kind of road.
  function kindSpec(kind, cfg) {
    if (kind === 'avenue') return { laneWidth: cfg.avenueLaneWidth, median: cfg.avenueMedian, speed: cfg.avenueSpeedFactor };
    if (kind === 'street') return { laneWidth: cfg.roadWidth / 2, median: 0, speed: 1 };
    throw new Error('unknown road kind: ' + kind);
  }

  // Two movements conflict when their paths come within carWidth + CONFLICT_MARGIN px.
  // Why 4: an avenue's two opposite left turns pass ~19 px apart (see movementPath) and should be
  // able to go together on an arrow; two opposite left turns on a street pass ~10 px apart and must not.
  var CONFLICT_MARGIN = 4;
  // Within this many radians of dead ahead counts as straight on; within this of a U-turn is skipped.
  var STRAIGHT = 0.35;
  // An avenue left turn bends this far into the box (see movementPath).
  var EARLY_BEND = 14;
  var CURVE_STEPS = 48;

  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function unit(angle) { return { x: Math.cos(angle), y: Math.sin(angle) }; }

  // ------------------------------------------------------------------ paths

  // A path is sampled points with headings and distance along it: {pts, dist, len}.
  // Headings come from the neighbouring points, as the roundabout code always did.
  function makePath(pts) {
    var dist = [0], len = 0;
    for (var j = 0; j < pts.length; j++) {
      if (pts[j].angle === undefined) {
        var a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
        pts[j].angle = Math.atan2(b.y - a.y, b.x - a.x);
      }
      if (j > 0) { len += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y); dist.push(len); }
    }
    return { pts: pts, dist: dist, len: len };
  }

  // Point and heading `d` px along a path.
  function pathPoint(path, d) {
    var pts = path.pts, dist = path.dist;
    if (d <= 0) return { x: pts[0].x, y: pts[0].y, angle: pts[0].angle };
    if (d >= path.len) { var e = pts[pts.length - 1]; return { x: e.x, y: e.y, angle: e.angle }; }
    var lo = 0, hi = dist.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (dist[mid] < d) lo = mid; else hi = mid; }
    var a = pts[lo], b = pts[hi], f = (d - dist[lo]) / (dist[hi] - dist[lo]);
    var da = wrap(b.angle - a.angle);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: a.angle + da * f };
  }

  // Quadratic Bézier from p0 to p2 bending through c, with exact headings from its derivative.
  function bezierPath(p0, c, p2) {
    var pts = [];
    for (var i = 0; i <= CURVE_STEPS; i++) {
      var t = i / CURVE_STEPS, u = 1 - t;
      var dx = 2 * u * (c.x - p0.x) + 2 * t * (p2.x - c.x);
      var dy = 2 * u * (c.y - p0.y) + 2 * t * (p2.y - c.y);
      pts.push({
        x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
        angle: Math.atan2(dy, dx)
      });
    }
    return makePath(pts);
  }

  // Where the line through `a` heading `ha` meets the line through `b` heading `hb`.
  function lineMeet(a, ha, b, hb) {
    var u = unit(ha), v = unit(hb);
    var den = u.x * v.y - u.y * v.x;
    if (Math.abs(den) < 1e-9) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    var t = ((b.x - a.x) * v.y - (b.y - a.y) * v.x) / den;
    return { x: a.x + u.x * t, y: a.y + u.y * t };
  }

  // The path round a roundabout: a smooth bend from the lane onto the circle, counterclockwise
  // round it, and a bend off onto the new lane. Ported from sim.js's makeRoundPath, but working
  // from the links' headings instead of N/E/S/W, so arms may come in at any angle.
  // Screen y points down, so counterclockwise on screen means the angle shrinks.
  function roundPath(node, from, to) {
    var R = node.ring, cx = node.x, cy = node.y;
    var p0 = endOf(from), p2 = startOf(to);
    var inSide = from.heading + Math.PI, outSide = to.heading;
    // How far each lane runs from the centre, across its own heading.
    var offIn = Math.abs(cross(unit(from.heading), { x: p0.x - cx, y: p0.y - cy }));
    var offOut = Math.abs(cross(unit(to.heading), { x: p2.x - cx, y: p2.y - cy }));
    var thIn = inSide - (Math.asin(Math.min(0.9, offIn / R)) + 0.15);
    var thOut = outSide + Math.asin(Math.min(0.9, offOut / R));
    var sweep = mod2pi(thIn - thOut);
    if (sweep < 0.3) sweep += 2 * Math.PI;
    var ring = function (th) { return { x: cx + R * Math.cos(th), y: cy + R * Math.sin(th) }; };
    var tangent = function (th) { return { x: Math.sin(th), y: -Math.cos(th) }; };
    var pts = [];
    // Cubic Hermite bends: start and end points with their headings.
    function bend(a, ta, b, tb) {
      var k = Math.hypot(b.x - a.x, b.y - a.y) * 1.1;
      for (var i = 0; i <= 12; i++) {
        var t = i / 12, t2 = t * t, t3 = t2 * t;
        var h1 = 2 * t3 - 3 * t2 + 1, h2 = t3 - 2 * t2 + t, h3 = -2 * t3 + 3 * t2, h4 = t3 - t2;
        pts.push({ x: h1 * a.x + h2 * k * ta.x + h3 * b.x + h4 * k * tb.x, y: h1 * a.y + h2 * k * ta.y + h3 * b.y + h4 * k * tb.y });
      }
    }
    bend(p0, unit(from.heading), ring(thIn), tangent(thIn));
    var startIdx = pts.length - 1, steps = Math.max(6, Math.ceil(sweep * R / 4));
    for (var i = 1; i <= steps; i++) pts.push(ring(thIn - sweep * i / steps));
    var endIdx = pts.length - 1;
    pts.pop();
    bend(ring(thOut), tangent(thOut), p2, unit(to.heading));
    var path = makePath(pts);
    path.R = R; path.uIn = -thIn; path.sweep = sweep;
    path.ringStart = path.dist[startIdx]; path.ringEnd = path.dist[endIdx];
    return path;
  }

  function mod2pi(a) { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; }
  function cross(a, b) { return a.x * b.y - a.y * b.x; }
  function startOf(link) { return link.path.pts[0]; }
  function endOf(link) { return link.path.pts[link.path.pts.length - 1]; }

  // The path a movement takes through the box.
  function movementPath(node, from, to, turn) {
    if (turn === 'round') return roundPath(node, from, to);
    var p0 = endOf(from), p2 = startOf(to);
    if (turn === 'straight') return makePath([{ x: p0.x, y: p0.y }, { x: p2.x, y: p2.y }]);
    // A turn bends through the spot where the two lanes' centre lines cross. An avenue left turn
    // starts bending early instead (a few px into the box), so the two opposite left-turners pass
    // beside each other rather than crossing paths, the way real drivers do, and can both go on an arrow.
    var c = lineMeet(p0, from.heading, p2, to.heading);
    if (turn === 'left' && from.kind === 'avenue') {
      var u = unit(from.heading);
      c = { x: p0.x + u.x * EARLY_BEND, y: p0.y + u.y * EARLY_BEND };
    }
    return bezierPath(p0, c, p2);
  }

  // Shortest distance between segments ab and cd (0 if they cross).
  function segDist(a, b, c, d) {
    var d1 = cross({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - a.x, y: c.y - a.y });
    var d2 = cross({ x: b.x - a.x, y: b.y - a.y }, { x: d.x - a.x, y: d.y - a.y });
    var d3 = cross({ x: d.x - c.x, y: d.y - c.y }, { x: a.x - c.x, y: a.y - c.y });
    var d4 = cross({ x: d.x - c.x, y: d.y - c.y }, { x: b.x - c.x, y: b.y - c.y });
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
    return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
  }
  function pointSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    var t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }

  // Do two paths come within `reach` px of each other anywhere?
  function pathsMeet(p, q, reach) {
    var bp = bounds(p), bq = bounds(q);
    if (bp.x0 - reach > bq.x1 || bq.x0 - reach > bp.x1 || bp.y0 - reach > bq.y1 || bq.y0 - reach > bp.y1) return false;
    for (var i = 1; i < p.pts.length; i++) {
      for (var j = 1; j < q.pts.length; j++) {
        if (segDist(p.pts[i - 1], p.pts[i], q.pts[j - 1], q.pts[j]) < reach) return true;
      }
    }
    return false;
  }
  function bounds(path) {
    if (path.box) return path.box;
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    path.pts.forEach(function (p) {
      b.x0 = Math.min(b.x0, p.x); b.x1 = Math.max(b.x1, p.x);
      b.y0 = Math.min(b.y0, p.y); b.y1 = Math.max(b.y1, p.y);
    });
    path.box = b;
    return b;
  }

  // ------------------------------------------------------------------ building

  // How far from a junction's centre its box reaches along `arm`: far enough to clear every
  // road that crosses it. For two roads at right angles that is the other road's half-width,
  // as before. A roundabout's box is its circle, the same on every arm.
  function setback(node, arm, cfg) {
    if (node.type !== 'junction') return 0;
    if (node.control.type === 'round') return node.ring + cfg.roundLane / 2;
    var best = 0;
    node.arms.forEach(function (other) {
      if (other === arm) return;
      var a = wrap(other.angle - arm.angle), s = Math.abs(Math.sin(a));
      if (s < 0.1) return;   // the same road carrying on: it doesn't cross this arm
      best = Math.max(best, other.half / s + arm.half * Math.abs(Math.cos(a)) / s);
    });
    return best;
  }

  function edgeName(node, cfg) {
    if (node.x <= 0) return 'west';
    if (node.x >= cfg.width) return 'east';
    if (node.y <= 0) return 'north';
    if (node.y >= cfg.height) return 'south';
    return null;
  }

  function buildNetwork(map, cfg) {
    var net = { nodes: {}, nodeList: [], roads: [], links: [], movements: [], sources: [], exits: [], lights: [] };

    Object.keys(map.nodes).forEach(function (id) {
      var n = map.nodes[id];
      var node = {
        id: id, x: n.x, y: n.y, type: n.type || 'junction',
        control: n.control ? Object.assign({}, n.control) : (n.type === 'edge' || n.type === 'deadend' ? null : { type: 'none' }),
        arms: [], inLinks: [], outLinks: [], movements: [], phases: []
      };
      if (node.type === 'edge') node.edge = edgeName(node, cfg);
      net.nodes[id] = node;
      net.nodeList.push(node);
    });

    // Roads, and the arm each one makes at both its ends.
    map.roads.forEach(function (r, ri) {
      var a = net.nodes[r.from], b = net.nodes[r.to];
      if (!a || !b) throw new Error('road ' + ri + ' joins a missing node: ' + r.from + ' -> ' + r.to);
      var kind = r.kind || 'street', spec = kindSpec(kind, cfg), lanes = r.lanes || [1, 1];
      var road = {
        id: ri, from: a, to: b, kind: kind, lanes: lanes, spec: spec, weight: r.weight || 1,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        // Half the road's width: the median plus its widest side.
        half: spec.median / 2 + spec.laneWidth * Math.max(lanes[0], lanes[1])
      };
      road.armAtFrom = { road: road, node: a, toward: b, angle: road.angle, half: road.half, inLinks: [], outLinks: [] };
      road.armAtTo = { road: road, node: b, toward: a, angle: wrap(road.angle + Math.PI), half: road.half, inLinks: [], outLinks: [] };
      a.arms.push(road.armAtFrom);
      b.arms.push(road.armAtTo);
      net.roads.push(road);
    });

    net.nodeList.forEach(function (node) {
      node.arms.sort(function (p, q) { return p.angle - q.angle; });
      if (node.type === 'junction' && node.control.type === 'round') {
        // The circle's lane runs `ring` px out, clear of every road, with `lanes` lanes (1 for now).
        node.ring = Math.max.apply(null, node.arms.map(function (a) { return a.half; })) + 12;
        node.control.lanes = node.control.lanes || 1;
      }
      node.arms.forEach(function (arm) { arm.setback = setback(node, arm, cfg); });
    });

    // Links: one per lane per road, from box edge to box edge. Traffic keeps right, so a road's
    // forward lanes sit on the right of its from -> to direction, inner lane (index 0) by the middle.
    net.roads.forEach(function (road) {
      [['fwd', road.from, road.to, road.armAtFrom, road.armAtTo, road.lanes[0]],
       ['back', road.to, road.from, road.armAtTo, road.armAtFrom, road.lanes[1]]].forEach(function (side) {
        var start = side[1], end = side[2], startArm = side[3], endArm = side[4], count = side[5];
        var heading = Math.atan2(end.y - start.y, end.x - start.x), u = unit(heading);
        var right = { x: -u.y, y: u.x };   // screen y points down, so this is the driver's right
        var siblings = [];
        for (var i = 0; i < count; i++) {
          var off = road.spec.median / 2 + road.spec.laneWidth * (i + 0.5);
          var p0 = { x: start.x + u.x * startArm.setback + right.x * off, y: start.y + u.y * startArm.setback + right.y * off };
          var p1 = { x: end.x - u.x * endArm.setback + right.x * off, y: end.y - u.y * endArm.setback + right.y * off };
          var link = {
            id: net.links.length, road: road, side: side[0], index: i, count: count,
            position: count === 1 ? 'single' : i === 0 ? 'inner' : i === count - 1 ? 'curb' : 'middle',
            from: start, to: end, fromArm: startArm, toArm: endArm,
            kind: road.kind, offset: off, width: road.spec.laneWidth,
            maxSpeed: cfg.maxSpeed * road.spec.speed, weight: road.weight,
            heading: heading, path: makePath([p0, p1]),
            out: [], in: [], siblings: siblings,
            closed: false,   // no car may be on it (the stretch before a roundabout a lane ends at)
            ends: false,     // no way on from its far end: cars must change lanes before then
            d: Infinity
          };
          link.len = link.path.len;
          // Compass direction for roads along the map's axes (null otherwise).
          var q = Math.round(heading / (Math.PI / 2));
          link.dir = Math.abs(heading - q * Math.PI / 2) < 0.01 ? ['W', 'N', 'E', 'S', 'W'][q + 2] : null;
          link.axis = link.dir === 'E' || link.dir === 'W' ? 'ew' : link.dir ? 'ns' : null;
          link.stopLine = end.type === 'edge' ? null : link.len - cfg.stopGap;
          siblings.push(link);
          startArm.outLinks.push(link);
          endArm.inLinks.push(link);
          start.outLinks.push(link);
          end.inLinks.push(link);
          net.links.push(link);
        }
      });
    });

    net.nodeList.forEach(function (node) {
      if (node.type !== 'junction') return;
      buildMovements(net, node);
      buildConflicts(net, node, cfg);
      buildYields(net, node);
      buildGroups(net, node);
      if (node.control.type === 'light') { buildPhases(net, node); net.lights.push(node); }
    });

    // A lane that ends at a roundabout after another junction: the whole stretch from that junction
    // on is closed, so cars merge before it. (Merging between a light and the roundabout didn't work:
    // see README, Places.) One that comes straight from the map edge stays open and merges on the way.
    net.links.forEach(function (link) {
      if (link.ends && link.to.control && link.to.control.type === 'round' && link.from.type === 'junction') link.closed = true;
    });

    buildDistances(net);

    net.links.forEach(function (link) {
      // Cars start at the map edge, and in cul-de-sacs (homes).
      if (link.from.type === 'edge') net.sources.push({ link: link, edge: link.from.edge, weight: link.weight });
      if (link.from.type === 'deadend') net.sources.push({ link: link, home: true, weight: link.weight });
      if (link.to.type === 'edge') net.exits.push(link);
    });
    return net;
  }

  // Movements: for every lane arriving at a junction, the lanes it may carry on into.
  //   straight  into the same lane (inner stays inner) on the road straight ahead
  //   left      from the inner lane into the inner lane of the road to the left
  //   right     from the curb lane into the curb lane of the road to the right
  //   round     a roundabout: drive the circle and leave by any other arm, into its curb lane.
  //             Lanes beyond the circle's own lane count end before it.
  function buildMovements(net, node) {
    var round = node.control.type === 'round';
    node.inLinks.forEach(function (from) {
      if (round && from.index >= node.control.lanes) { from.ends = true; return; }
      node.arms.forEach(function (arm) {
        if (arm === from.toArm || !arm.outLinks.length) return;
        var rel = wrap(arm.angle - from.heading);
        var dir = Math.abs(rel) < STRAIGHT ? 'straight'
          : rel < 0 && rel > -(Math.PI - STRAIGHT) ? 'left'    // y points down: a left turn turns the heading negative
          : rel > 0 && rel < Math.PI - STRAIGHT ? 'right' : null;
        if (!dir) return;
        var outs = arm.outLinks, to;
        if (round) to = outs[outs.length - 1];
        else if (dir === 'straight') to = outs[from.index];
        else if (dir === 'left') to = from.index === 0 ? outs[0] : null;
        else to = from.index === from.count - 1 ? outs[outs.length - 1] : null;
        if (!to) return;
        var turn = round ? 'round' : dir;
        var m = {
          id: net.movements.length, node: node, from: from, to: to, turn: turn,
          exit: dir,           // which way the car leaves, relative to how it came in
          path: movementPath(node, from, to, turn),
          conflicts: [], merges: [], yieldTo: [],
          allowed: false,
          leadsOut: to.to.type === 'edge'   // the road it turns onto has no more junctions
        };
        m.len = m.path.len;
        from.out.push(m);
        to.in.push(m);
        node.movements.push(m);
        net.movements.push(m);
      });
      if (!from.out.length) from.ends = true;
    });
  }

  // Which movements can't be in the box at the same time. Two from the same lane just follow each
  // other. Two into the same lane always meet at the end (a merge): that counts as a conflict too,
  // so a car never enters while another is in the box heading for the same spot.
  function buildConflicts(net, node, cfg) {
    var reach = cfg.carWidth + CONFLICT_MARGIN, ms = node.movements;
    for (var i = 0; i < ms.length; i++) {
      for (var j = i + 1; j < ms.length; j++) {
        var a = ms[i], b = ms[j];
        if (a.from === b.from) continue;
        var merge = a.to === b.to;
        if (merge || pathsMeet(a.path, b.path, reach)) {
          a.conflicts.push(b.id); b.conflicts.push(a.id);
          if (merge) { a.merges.push(b.id); b.merges.push(a.id); }
        }
      }
    }
  }

  // Who must find a gap before going (on top of the box being clear of conflicting cars):
  //   a left turn yields to oncoming traffic it crosses ('gap'), but not to oncoming left turns,
  //     which take turns with it in the box instead;
  //   at a two-way stop, the side street yields to the main road movements it crosses or joins ('cross').
  // A roundabout's entries yield to the circle, which sim.js works out from the cars on it.
  function buildYields(net, node) {
    if (node.control.type === 'round') return;
    var major = node.control.type === 'stop2' ? node.control.major || [] : null;
    function isMajor(arm) { return major && major.indexOf(arm.toward.id) >= 0; }
    node.movements.forEach(function (m) {
      var seen = {};
      function add(o, kind) { if (!seen[o.id]) { seen[o.id] = 1; m.yieldTo.push({ id: o.id, kind: kind }); } }
      m.conflicts.forEach(function (id) {
        var o = net.movements[id];
        var oncoming = Math.abs(wrap(o.from.heading - m.from.heading)) > Math.PI - STRAIGHT;
        if (m.turn === 'left' && oncoming && o.turn !== 'left') add(o, 'gap');
        if (major && !isMajor(m.from.toArm) && isMajor(o.from.toArm)) add(o, 'cross');
      });
    });
  }

  // A junction's arm groups: each pair of opposite arms goes together, and an arm with no opposite
  // goes alone. `tag` is 'ew' or 'ns' for a group along the map's axes. Lights turn groups into
  // phases; all-way stops let one group go at a time.
  function buildGroups(net, node) {
    var used = {};
    node.groups = [];
    node.arms.forEach(function (arm, i) {
      if (used[i]) return;
      used[i] = 1;
      var arms = [arm];
      node.arms.forEach(function (other, j) {
        if (!used[j] && arms.length === 1 && Math.abs(wrap(other.angle - arm.angle)) > Math.PI - STRAIGHT) { used[j] = 1; arms.push(other); }
      });
      var a = mod2pi(arm.angle) % Math.PI;
      node.groups.push({ arms: arms, tag: a < 0.1 || a > Math.PI - 0.1 ? 'ew' : Math.abs(a - Math.PI / 2) < 0.1 ? 'ns' : null });
    });
    // East-west first: timer and green-wave lights start their cycle with it.
    var rank = { ew: 0, ns: 1 };
    node.groups.sort(function (p, q) { return (p.tag in rank ? rank[p.tag] : 2) - (q.tag in rank ? rank[q.tag] : 2); });
    node.groups.forEach(function (grp, i) { grp.arms.forEach(function (arm) { arm.group = i; }); });
  }

  // A light's phases, one per arm group with traffic coming in. A phase on an avenue gets a
  // left-turn arrow: its left turns, which go first while oncoming traffic is held.
  function buildPhases(net, node) {
    node.groups.forEach(function (grp) {
      var moves = node.movements.filter(function (m) { return grp.arms.indexOf(m.from.toArm) >= 0; });
      if (!moves.length) return;
      var phase = {
        id: node.phases.length, node: node, arms: grp.arms, movements: moves, tag: grp.tag,
        arrow: grp.arms.length === 2 ? moves.filter(function (m) { return m.turn === 'left' && m.from.kind === 'avenue'; }) : []
      };
      moves.forEach(function (m) { m.phase = phase; });
      node.phases.push(phase);
    });
  }

  // Which movements are allowed, and each link's distance to exit `d`.
  //
  // Gridlock is a loop of cars, each waiting for space the next one holds. If every allowed move
  // takes a car to a link with a smaller d, no such loop can exist: following "who waits on whom"
  // round it, d would have to keep shrinking and still come back to where it started. So the rule
  // is "only move onto a link with a smaller d", and the work is choosing d so that the moves
  // people expect are allowed. That's done backwards: pick the allowed moves first, refusing any
  // that would close a loop of moves, then measure d over what's left.
  //
  // Moves are picked in this order, each one only if it doesn't let a car come back to where it was:
  //   1. going straight on (always fine: straight roads run to an edge);
  //   2. turns onto a road that runs straight out of the map, and every way off a roundabout
  //      (today's rules, kept so Stage 1 matches today's traffic);
  //   3. for a road side left with no way out at all (no lane on it can carry on, e.g. a
  //      T-junction's stem from Stage 2), its other turns, shortest way out first.
  // d is then the longest drive to the edge using allowed moves only, so every allowed move
  // lowers it. The cost: no driving round a block, and nobody drives into a dead end.
  //
  // Why not d = plain shortest distance to an exit, as first planned: a car past the first light
  // of a long avenue was "further" from an exit than a car about to turn off before it, so going
  // straight on would have been forbidden.
  function buildDistances(net) {
    var links = net.links, moves = net.movements;
    moves.forEach(function (m) { m.allowed = false; });
    var shortest = shortestToExit(net);

    // Could a car on link `a` reach link `b` using allowed moves?
    function reaches(a, b) {
      var seen = {}, stack = [a];
      while (stack.length) {
        var l = stack.pop();
        if (l === b) return true;
        if (seen[l.id]) continue;
        seen[l.id] = 1;
        l.out.forEach(function (m) { if (m.allowed) stack.push(m.to); });
      }
      return false;
    }
    function tryAllow(m) {
      if (m.allowed || m.from.closed || m.to.closed || reaches(m.to, m.from)) return;
      m.allowed = true;
    }
    // A link has a way out if it is an exit or an allowed move leads to one that has.
    function waysOut() {
      var out = {}, changed = true;
      links.forEach(function (l) { if (l.to.type === 'edge' && !l.closed) out[l.id] = true; });
      while (changed) {
        changed = false;
        links.forEach(function (l) {
          if (!out[l.id] && l.out.some(function (m) { return m.allowed && out[m.to.id]; })) { out[l.id] = true; changed = true; }
        });
      }
      return out;
    }

    moves.forEach(function (m) { if (m.turn === 'straight') tryAllow(m); });
    moves.forEach(function (m) { if (m.turn === 'round' || m.leadsOut) tryAllow(m); });
    var out = waysOut();
    links.forEach(function (l) {
      // A lane whose neighbour has a way out changes lanes instead (as at a lane closing today).
      if (out[l.id] || l.closed || l.siblings.some(function (sib) { return out[sib.id]; })) return;
      // Every turn, not just the shortest: on Suburb, sending a T-junction's stem all one way
      // piled it onto one busy crossing and cut the capacity mark from 80 to 65.
      l.out.slice().sort(function (a, b) { return a.len + shortest[a.to.id] - (b.len + shortest[b.to.id]); }).forEach(tryAllow);
    });
    // A move into a link that still has no way out would strand the car: take it back.
    out = waysOut();
    moves.forEach(function (m) { if (m.allowed && !out[m.to.id]) m.allowed = false; });

    // d: the longest allowed drive from a link's start to the edge (Infinity: no way out).
    var memo = {};
    function d(l) {
      if (memo[l.id] !== undefined) return memo[l.id];
      if (!out[l.id]) return (memo[l.id] = Infinity);
      var best = l.to.type === 'edge' ? 0 : -Infinity;
      l.out.forEach(function (m) { if (m.allowed) best = Math.max(best, m.len + d(m.to)); });
      return (memo[l.id] = l.len + best);
    }
    links.forEach(function (l) { l.d = d(l); });
  }

  // The shortest drive from each link's start to any map edge over every movement, allowed or not
  // (Dijkstra, run backwards from the exits). Only used to rank a must-turn lane's choices.
  function shortestToExit(net) {
    var dist = {}, done = {}, queue = [];
    net.links.forEach(function (l) {
      dist[l.id] = Infinity;
      if (l.to.type === 'edge' && !l.closed) { dist[l.id] = l.len; queue.push(l); }
    });
    while (queue.length) {
      // A few hundred links at most: picking the smallest by a scan is plenty fast.
      var bi = 0;
      for (var i = 1; i < queue.length; i++) if (dist[queue[i].id] < dist[queue[bi].id]) bi = i;
      var link = queue.splice(bi, 1)[0];
      if (done[link.id]) continue;
      done[link.id] = 1;
      link.in.forEach(function (m) {
        var from = m.from;
        if (from.closed || done[from.id]) return;
        var dd = from.len + m.len + dist[link.id];
        if (dd < dist[from.id]) { dist[from.id] = dd; queue.push(from); }
      });
    }
    return dist;
  }

  // Point and heading `s` px along a link.
  function linkPoint(link, s) { return pathPoint(link.path, s); }

  var api = {
    buildNetwork: buildNetwork,
    pathPoint: pathPoint,
    linkPoint: linkPoint,
    CONFLICT_MARGIN: CONFLICT_MARGIN
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficNetwork = api;
})(this);
