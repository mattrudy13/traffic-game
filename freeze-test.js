// Freeze test: runs every chill setup (lights x traffic x strategy, 3 seeds) for two game days
// and reports the slowest 30 s stretch outside the quiet night. 0 means the grid froze.
// Run with:  node freeze-test.js   (takes ~15 s)
var Sim = require("./sim.js");
function seeded(seed){return function(){seed|=0;seed=(seed+0x6D2B79F5)|0;var t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
var bad = 0;
[1, 2, 4, 6].forEach(function (n) {
  [0.15, 0.29, 0.6].forEach(function (rate) {
    var row = [];
    ['smart', 'timer', 'wave'].forEach(function (st) {
      var worst = 1e9, samples = [], turned = 0;
      for (var seed = 1; seed <= 3; seed++) {
        var g = Sim.createChill(n, rate, { rng: seeded(seed), strategy: st }); var last = 0;
        for (var i = 1; i <= 720 * 60; i++) {
          Sim.step(g, 1 / 60);
          if (i % (30 * 60) === 0) {
            var hour = Sim.hourOfDay(g), quiet = hour < 6 || hour > 22;
            if (!quiet) worst = Math.min(worst, g.score - last);
            last = g.score;
            var a = Sim.averageWait(g); if (a !== null) samples.push(a);
          }
        }
      }
      if (worst === 0) bad++;
      var mean = samples.reduce(function (a, b) { return a + b; }, 0) / samples.length;
      row.push(st + ' ' + mean.toFixed(1) + 's min/30s ' + worst);
    });
    console.log(n + ' lights, rate ' + rate + ': ' + row.join(' | '));
  });
});
console.log(bad ? 'FROZE in ' + bad + ' setups' : 'no freezes');
