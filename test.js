// Runs every test script at once and says which passed. Each script sets a failing exit code
// when it finds a problem. Run with:  node test.js   (takes ~1 min: the scripts run side by side)
var spawn = require('child_process').spawn;
var TESTS = ['freeze-test.js', 'overlap-test.js', 'compare-test.js', 'extras-test.js', 'kinds-test.js', 'places-test.js'];
var start = Date.now(), done = 0, failed = [];
TESTS.forEach(function (file) {
  var out = '';
  var child = spawn(process.execPath, [file], { cwd: __dirname });
  child.stdout.on('data', function (d) { out += d; });
  child.stderr.on('data', function (d) { out += d; });
  child.on('close', function (code) {
    var lines = out.trim().split('\n');
    console.log((code === 0 ? 'pass  ' : 'FAIL  ') + file + ': ' + lines[lines.length - 1]);
    if (code !== 0) { failed.push(file); console.log(out); }
    if (++done === TESTS.length) {
      console.log((failed.length ? failed.length + ' failed' : 'all ' + TESTS.length + ' passed') + ' in ' + Math.round((Date.now() - start) / 1000) + ' s');
      process.exitCode = failed.length ? 1 : 0;
    }
  });
});
