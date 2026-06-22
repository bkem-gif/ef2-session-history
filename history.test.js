/*
 * Tests for the session-history recorder (history.js) — no browser needed.
 *
 * Loads the real recorder, mocks the few browser globals it touches (window,
 * localStorage, document), publishes synthetic Wave Tracker samples on
 * window.__EF_WAVE_SAMPLE__, and drives it via the recorder's own tick hook.
 * Checks the localStorage schema the viewer (history.html) depends on:
 * run segmentation, rebirth split, field mapping, and reference de-dup.
 *
 *   node history.test.js     # exits non-zero on failure
 */
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'history.js'), 'utf8');

const ls = (function () {
  let s = {};
  return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } };
})();
global.window = {
  localStorage: ls, addEventListener() {}, appBundleVersion: 'test',
  // zero the throttles so every published sample records deterministically
  __EF_SESSION_HISTORY_CONFIG__: { sampleIntervalMs: 0, persistIntervalMs: 0 }
};
global.document = { addEventListener() {}, visibilityState: 'visible' };
global.setInterval = function () {};            // don't auto-run; we tick manually
eval(code);

const tick = global.window.__EF_SESSION_HISTORY_TICK__;
const publish = o => { global.window.__EF_WAVE_SAMPLE__ = o; tick(); };
const read = () => JSON.parse(ls.getItem('__EF_SESSION_HISTORY__'));

// run 1
publish({ wave: 10, maxWave: 10, rebirthTimeSec: 100, currentMpm: 5, bestMpm: 5, wpm: 2, wpmReady: true, waveTimeSec: 3, completedWaves: 8, skippedWaves: 2, recommendation: 'go' });
publish({ wave: 12, maxWave: 12, rebirthTimeSec: 120, currentMpm: 6, bestMpm: 6, wpm: 2.2, wpmReady: true, waveTimeSec: 3, completedWaves: 10, skippedWaves: 2, recommendation: 'go' });
// rebirth (clock drops) -> new run
publish({ wave: 1, maxWave: 12, rebirthTimeSec: 5, currentMpm: 1, bestMpm: 6, wpm: 0, wpmReady: false, waveTimeSec: 2, completedWaves: 0, skippedWaves: 0, recommendation: 'wait' });
publish({ wave: 3, maxWave: 12, rebirthTimeSec: 30, currentMpm: 2, bestMpm: 6, wpm: 1, wpmReady: true, waveTimeSec: 2, completedWaves: 2, skippedWaves: 0, recommendation: 'wait' });

const store = read();
let pass = 0, fail = 0;
const chk = (n, c) => { (c ? pass++ : fail++); console.log('  ' + (c ? 'PASS' : 'FAIL') + ' ' + n); };

chk('persisted store v1', !!store && store.version === 1);
chk('two runs (rebirth split)', store.runs.length === 2);
chk('run1 has 2 samples', store.runs[0].samples.length === 2);
chk('run1 peakWave=12', store.runs[0].peakWave === 12);
chk('run2 startWave=1 (rebirth)', store.runs[1].startWave === 1);
chk('run2 has 2 samples', store.runs[1].samples.length === 2);
chk('fields mapped (wave/mpm/rec)', store.runs[0].samples[0].wave === 10 && store.runs[0].samples[0].mpm === 5 && store.runs[0].samples[0].rec === 'go');
chk('wpm null when not ready', store.runs[1].samples[0].wpm === null);
const before = store.runs[1].samples.length;
tick(); // same published object -> reference de-dup, no new sample
chk('reference de-dup on re-tick', read().runs[1].samples.length === before);

console.log(fail ? ('\n✗ ' + fail + ' failed, ' + pass + ' passed') : ('\n✓ all ' + pass + ' passed') + ' — session-history recorder');
process.exit(fail ? 1 : 0);
