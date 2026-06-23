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

// battleTime is captured as `bt` (drives the priest-buff inference); absent -> null
publish({ wave: 5, maxWave: 12, rebirthTimeSec: 60, currentMpm: 3, bestMpm: 6, wpm: 1.5, wpmReady: true, waveTimeSec: 2, completedWaves: 4, skippedWaves: 0, recommendation: 'wait', battleTime: 12345 });
const r2 = read().runs[1].samples;
chk('battleTime captured as bt', r2[r2.length - 1].bt === 12345);
chk('bt null when not published', store.runs[0].samples[0].bt === null);

// run context: the recorder's read-only JSON.parse observer captures an allowlisted,
// identity-free snapshot of body.user onto the current run.
// castle + hero are SIBLINGS of user under body (the real login-response shape)
JSON.parse(JSON.stringify({ body: {
  user: {
    gold: 5e84, gem: 160000, medal: 2.08e9, accuMedal: 2.03e11, maxWave: 6002, wave: 5415,
    numRevive: 311, goldPerSec: 7.6e71, vip: 15, tribe: 3, activeSkills: '1|1|1',
    favoritePets: '26|25|24',
    name: 'TestPlayer', userId: 'testuserid00000', accountId: 'acc', guildId: 'g'
  },
  castle: { enhance: 4093, levels: [802, 800, 790, 410, 405], specialLevels: [3, 2, 1] },
  hero: { team: [
    { id: 3678483, kindNum: 54, trans: 0, level: 12, enhance: 2 },
    { id: 9, kindNum: 12, trans: 1, level: 30, enhance: 0 }
  ] }
} }));
const live = global.window.__EF_SESSION_HISTORY_DATA__;
const cc = live.runs[live.runs.length - 1].ctx || {};
chk('ctx keeps long-term metrics, drops currencies + vip',
  cc.accuMedal === 2.03e11 && cc.maxWave === 6002 && cc.numRevive === 311
  && !('vip' in cc) && !('gold' in cc) && !('medal' in cc) && !('gem' in cc) && !('goldPerSec' in cc));
chk('ctx captured castle enhance + GOLD sum (per-run) + MEDAL sum (persistent)',
  cc.castleEnhance === 4093 && cc.castleGoldSum === (802 + 800 + 790 + 410 + 405) && cc.castleMedalSum === (3 + 2 + 1));
// a castle sync with an EMPTY levels array carries no gold-level data -> keep the last value
JSON.parse(JSON.stringify({ body: { castle: { enhance: 0, levels: [] } } }));
const cc2 = live.runs[live.runs.length - 1].ctx || {};
chk('empty-levels castle sync keeps the good value', cc2.castleEnhance === 4093 && cc2.castleGoldSum === (802 + 800 + 790 + 410 + 405));
// WITHIN a run (numRevive unchanged) a lagging / partial sync reporting LOWER gold levels must
// not shrink the run's captured peak (gold levels only climb during a run; syncs are debounced).
JSON.parse(JSON.stringify({ body: {
  user: { numRevive: 311 },
  castle: { enhance: 4093, levels: [100, 0, 0, 0, 0] },             // far below the captured 3207
  hero: { team: [
    { id: 3678483, kindNum: 54, trans: 0, level: 5, enhance: 2 },  // below the captured Lv12
    { id: 9, kindNum: 12, trans: 1, level: 8, enhance: 0 }          // below the captured Lv30
  ] }
} }));
const ccMax = live.runs[live.runs.length - 1].ctx || {};
chk('in-run lagging sync does not shrink the per-run peak',
  ccMax.castleGoldSum === (802 + 800 + 790 + 410 + 405) && ccMax.team[0].lvl === 12 && ccMax.team[1].lvl === 30);

// --- revive-payload attribution -------------------------------------------------------
// Unit gold levels (team[].lvl) and castle gold levels RESET at each rebirth and are re-bought
// during the run; numRevive is BUMPED. The revive that starts the next run lands its reset/
// bumped payload in the ENDING run (the JSON observer sees it ~1 tick before the rebirth clock
// drops). It's identified by numRevive jumping past the run's count, so it must be kept out of
// the ending run (which keeps its own peak) and applied only to the new run.
JSON.parse(JSON.stringify({ body: {
  user: { numRevive: 312, accuMedal: 2.05e11, maxWave: 6002 },     // the revive bumps numRevive
  castle: { enhance: 4093, levels: [0, 0, 0, 0, 0], specialLevels: [5, 3, 2] }, // GOLD resets to 0; MEDAL persists/grows
  hero: { team: [                                                   // unit gold levels reset to 1
    { id: 3678483, kindNum: 54, trans: 0, level: 1, enhance: 2 },
    { id: 9, kindNum: 12, trans: 1, level: 1, enhance: 0 }
  ] }
} }));
publish({ wave: 1, maxWave: 6002, rebirthTimeSec: 4, currentMpm: 1, bestMpm: 6, wpm: 0, wpmReady: false, waveTimeSec: 2, completedWaves: 0, skippedWaves: 0, recommendation: 'wait' }); // rebirth clock drops -> new run
const rb = read().runs;
const ending = rb[rb.length - 2], fresh = rb[rb.length - 1];
chk('revive payload kept out of ending run: own revive count', ending.ctx.numRevive === 311);
chk('revive payload kept out of ending run: peak unit gold levels', ending.ctx.team[0].lvl === 12 && ending.ctx.team[1].lvl === 30);
chk('revive payload kept out of ending run: castle GOLD sum', ending.ctx.castleGoldSum === (802 + 800 + 790 + 410 + 405));
chk('revive payload kept out of ending run: castle MEDAL sum', ending.ctx.castleMedalSum === (3 + 2 + 1));
chk('new run takes the bumped revive count', fresh.ctx.numRevive === 312);
chk('new run takes the reset unit gold levels', fresh.ctx.team[0].lvl === 1 && fresh.ctx.team[1].lvl === 1);
chk('new run takes the reset castle GOLD levels (re-bought from 0)', fresh.ctx.castleGoldSum === 0);
chk('new run carries the persistent castle MEDAL levels (not reset)', fresh.ctx.castleMedalSum === (5 + 3 + 2));
chk('ctx captured team roster (kind/lvl/enh, no instance id)',
  Array.isArray(cc.team) && cc.team.length === 2 && cc.team[0].kind === 54 && cc.team[0].lvl === 12 && cc.team[0].enh === 2 && !('id' in cc.team[0]));
chk('ctx captured skills, not pets', cc.activeSkills === '1|1|1' && !('favoritePets' in cc));
chk('ctx EXCLUDES identity fields', !('name' in cc) && !('userId' in cc) && !('accountId' in cc) && !('guildId' in cc));

// ---- viewer detection logic (extracted from history.html, single source of truth) ----
const html = fs.readFileSync(path.join(__dirname, 'history.html'), 'utf8');
const sStart = html.indexOf('// ---------- Divine Blessing');
const sEnd = html.indexOf('function saveStore()');
chk('extracted detection block from history.html', sStart >= 0 && sEnd > sStart);
const V = new Function(html.slice(sStart, sEnd) + '\nreturn { deriveSpeedIntervals, detectBuffDown };')();

// unit-name map: built from UNIT_NAME_<n> locale keys only (other keys ignored)
const bStart = html.indexOf('function buildUnitNameMap');
const bEnd = html.indexOf('function unitLabel');
const buildUnitNameMap = new Function(html.slice(bStart, bEnd) + '\nreturn buildUnitNameMap;')();
const nm = buildUnitNameMap({ UNIT_NAME_54: 'Fairy II', UNIT_NAME_12: 'Wind Mage', HERO_GOLD_SKILL_DESC_1: 'x', UNIT_NAME_abc: 'y' });
chk('unit-name map: UNIT_NAME_<n> keys only', nm['54'] === 'Fairy II' && nm['12'] === 'Wind Mage' && !('abc' in nm) && Object.keys(nm).length === 2);

// unit-icon map: the roster kinds resolve to their EFUnits image basenames
const iconLine = (html.match(/const UNIT_ICON = \{[^}]*\};/) || [''])[0];
const UNIT_ICON = new Function(iconLine + '\nreturn UNIT_ICON;')();
chk('unit-icon map covers the roster', UNIT_ICON[54] === 'fairy' && UNIT_ICON[12] === 'WM' && UNIT_ICON[7] === 'EA' && UNIT_ICON[33] === 'EW' && UNIT_ICON[60] === 'DK');

// Build samples whose frame counter advances at a given game speed per 10s interval.
function buildSamples(speeds) {
  const out = [{ t: 0, wall: 1.7e12, bt: 0 }];
  let bt = 0, wall = 1.7e12, t = 0;
  for (const sp of speeds) { bt += sp * 60 * 10; wall += 10000; t += 10; out.push({ t, wall, bt: Math.round(bt) }); }
  return out;
}
const off = n => Array(n).fill(2);   // base speed (buff down)
const on  = n => Array(n).fill(5);   // base + Divine Blessing +3 (buff up)

// A) clean alternating buff -> two down spans over the two off blocks
const A = V.detectBuffDown(V.deriveSpeedIntervals(buildSamples([...off(12), ...on(12), ...off(12)])));
chk('A: derived speed flags buff-down', A.ok === true);
chk('A: two down spans (the two off blocks)', A.spans.length === 2);
chk('A: threshold sits between the plateaus', A.thresh > 2.5 && A.thresh < 4.5);

// B) no battleTime data -> infer nothing
const B = V.detectBuffDown(V.deriveSpeedIntervals(buildSamples([2, 5, 2, 5]).map(s => ({ t: s.t, wall: s.wall }))));
chk('B: no bt data -> ok:false', B.ok === false && B.spans.length === 0);

// C) constant speed (buff never varies) -> draw nothing rather than guess
const C = V.detectBuffDown(V.deriveSpeedIntervals(buildSamples(Array(20).fill(3))));
chk('C: no plateau spread -> ok:false', C.ok === false);

// D) a battle reset (frame counter drops) is skipped, never a negative speed
const reset = buildSamples([2, 2, 2]); reset[3].bt = 50; // frames dropped mid-run
const dIv = V.deriveSpeedIntervals(reset);
chk('D: reset interval dropped, no negative speed', dIv.every(iv => iv.speed >= 0) && dIv.length < reset.length - 1);

// E) baseline drift PAST the +3 buff (idle stat growth) — the drift-aware local split
// must still separate on/off where a single global threshold misclassified early ON
// intervals. Regression guard for the workflow-found weakness.
(function () {
  const N = 180, speeds = [], truthDown = [];
  for (let i = 0; i < N; i++) {
    const base = 2 + 4 * i / (N - 1);      // drifts 2 -> 6 across the run (+4 > the +3 buff)
    const buffOn = (i % 24) < 12;          // 120s up / 120s down
    speeds.push(base + (buffOn ? 3 : 0));
    truthDown.push(!buffOn);               // interval k advances by speeds[k]
  }
  const ivs = V.deriveSpeedIntervals(buildSamples(speeds));
  const det = V.detectBuffDown(ivs);
  let tp = 0, fp = 0, fn = 0;
  ivs.forEach((iv, k) => {
    const mid = (iv.x0 + iv.x1) / 2;
    const pred = det.ok && det.spans.some(s => mid >= s.x0 && mid <= s.x1);
    if (pred && truthDown[k]) tp++; else if (pred && !truthDown[k]) fp++; else if (!pred && truthDown[k]) fn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  chk('E: drift past +3 keeps precision >= 0.9 (local split tracks the moving baseline)', det.ok && precision >= 0.9);
  chk('E: drift past +3 keeps recall >= 0.9', recall >= 0.9);
})();

// F) restart/reload: Divine Blessing resets on reload, so the post-reload unbuffed
// stretch must NOT be flagged as a lapse — only real up->down lapses are.
(function () {
  const start = 1.7e12, samples = [{ t: 0, wall: start, bt: 0 }];
  let wall = start, bt = 0;
  const push = sp => { bt += sp * 600; wall += 10000; samples.push({ t: Math.round((wall - start) / 1000), wall, bt }); };
  for (let i = 0; i < 12; i++) push(5);            // session 1: buff up
  for (let i = 0; i < 6; i++) push(2);             // session 1: buff lapses (after up -> should flag)
  bt = 0; wall += 60000;                           // ---- reload: frame counter resets + 60s downtime ----
  samples.push({ t: Math.round((wall - start) / 1000), wall, bt });
  for (let i = 0; i < 8; i++) push(2);             // session 2: post-reload, buff not yet recast (must NOT flag)
  for (let i = 0; i < 6; i++) push(5);             // session 2: buff recast (up)
  for (let i = 0; i < 6; i++) push(2);             // session 2: buff lapses again (after up -> should flag)
  const ivs = V.deriveSpeedIntervals(samples);
  const det = V.detectBuffDown(ivs);
  const covered = x => det.ok && det.spans.some(s => x >= s.x0 && x <= s.x1);
  chk('F: reload boundary detected (afterReload)', ivs.some(iv => iv.afterReload));
  chk('F: session-1 lapse (after up) flagged', covered(2.5));
  chk('F: post-reload unbuffed stretch NOT flagged', !covered(4.5));
  chk('F: session-2 lapse (after recast) flagged', covered(7.0));
})();

console.log(fail ? ('\n✗ ' + fail + ' failed, ' + pass + ' passed') : ('\n✓ all ' + pass + ' passed') + ' — session-history');
process.exit(fail ? 1 : 0);
