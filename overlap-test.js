// Overlap test: runs a few chill setups for a game day, counts turns, and samples every car
// (three points along its body, following curves and lane changes) for two cars drawn on top
// of each other. Any "overlapping-point samples" above 0 means a rule let cars collide.
// Run with:  node overlap-test.js   (takes ~1 min)
var Sim = require("./sim.js");
function seeded(seed){return function(){seed|=0;seed=(seed+0x6D2B79F5)|0;var t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
// The last setup adds buses, ambulances and snow (longer vehicles, cars moving over, weak brakes).
[[4, 0.29], [6, 0.6], [1, 0.6], [4, 0.4, true]].forEach(function (setup) {
  ['smart', 'wave'].forEach(function (st) {
    var extras = setup[2] ? { buses: true, ambulances: true, weather: 'snow' } : {};
    var g = Sim.createChill(setup[0], setup[1], Object.assign({ rng: seeded(5), strategy: st }, extras));
    var turns = { left: 0, right: 0 }, seen = {}, overlaps = 0, samples = 0, worst = null;
    for (var i = 1; i <= 360 * 60; i++) {
      Sim.step(g, 1 / 60);
      var pts = [];
      g.lanes.forEach(function (lane) {
        lane.cars.forEach(function (car) {
          if (car.plan && car.plan.turn !== 'straight' && car.s > car.plan.stop.boxStart && !seen[car.id]) { seen[car.id] = 1; turns[car.plan.turn]++; }
          // sample 3 points along the body
          [3, car.len / 2, car.len - 3].forEach(function (b) { var p = Sim.carPoint(lane, car, b); pts.push({ id: car.id, x: p.x, y: p.y }); });
        });
      });
      if (i % 6 === 0) {
        samples++;
        for (var a = 0; a < pts.length; a++) for (var b = a + 1; b < pts.length; b++) {
          if (pts[a].id === pts[b].id) continue;
          var d = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
          if (d < 8) { overlaps++; if (!worst) worst = { t: g.time.toFixed(1), x: pts[a].x.toFixed(0), y: pts[a].y.toFixed(0), d: d.toFixed(1) }; }
        }
      }
    }
    console.log(setup[0] + ' lights rate ' + setup[1] + (setup[2] ? ' + buses, ambulances, snow' : '') + ' ' + st + ': cars ' + g.score + ', left turns ' + turns.left + ', right turns ' + turns.right + ', overlapping-point samples ' + overlaps + (worst ? ' first at ' + JSON.stringify(worst) : ''));
  });
});
