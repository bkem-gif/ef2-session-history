import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { installEnv } from "./_env.js";
import { installSessionHistory } from "../recorder.js";

let env, handle;

function install(config) {
    if (config) { env.window.__EF_SESSION_HISTORY_CONFIG__ = config; }
    handle = installSessionHistory(env.runtime);
    return handle;
}
// timer-free defaults: never throttle samples or persist
const FAST = { sampleIntervalMs: 0, persistIntervalMs: 0 };

beforeEach(() => { env = installEnv(); });
afterEach(() => { try { if (handle) { handle.detach(); } } catch (e) {} handle = null; env.restore(); });

test("creates a run on the first sample and persists on detach", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    handle.detach(); handle = null;
    const store = env.store();
    assert.equal(store.runs.length, 1);
    assert.equal(store.runs[0].samples.length, 1);
    assert.equal(store.runs[0].samples[0].wave, 500);
    assert.equal(store.runs[0].samples[0].mpm, 1000);
});

test("a backward jump in rebirthTimeSec (> slack) starts a new run", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    env.emitSample({ rebirthTimeSec: 50, wave: 10, currentMpm: 200 }); // 50 + 5 < 100 -> rebirth
    const store = env.store();
    assert.equal(store.runs.length, 2);
    assert.equal(store.runs[1].id, store.runs[0].id + 1);
});

test("rising or within-slack rebirthTimeSec stays one run", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    env.emitSample({ rebirthTimeSec: 130, wave: 520, currentMpm: 1100 }); // rising
    env.emitSample({ rebirthTimeSec: 127, wave: 521, currentMpm: 1120 }); // drop 3 <= slack 5
    assert.equal(env.store().runs.length, 1);
});

test("flattens the nested wave:sample shape (medalMpmState / bestMpmState)", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, medalMpmState: { currentMpm: 1234 }, bestMpmState: { mpm: 9999 } });
    const s = env.store().runs[0].samples[0];
    assert.equal(s.mpm, 1234);
    assert.equal(s.bestMpm, 9999);
});

test("peakWave and bestMpm track the running max across samples", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    env.emitSample({ rebirthTimeSec: 110, wave: 800, currentMpm: 1500 });
    env.emitSample({ rebirthTimeSec: 120, wave: 700, currentMpm: 1200 }); // lower — must not lower the maxes
    const run = env.store().runs[0];
    assert.equal(run.peakWave, 800);
    assert.equal(run.bestMpm, 1500);
});

test("decimates a run once it exceeds maxSamplesPerRun (keeps first + last)", () => {
    install({ ...FAST, maxSamplesPerRun: 4 });
    const waves = [10, 20, 30, 40, 50, 60];
    waves.forEach((w, i) => env.emitSample({ rebirthTimeSec: 100 + i, wave: w, currentMpm: 100 * (i + 1) }));
    const run = env.store().runs[0];
    assert.ok(run.samples.length <= 4, `expected <=4 samples, got ${run.samples.length}`);
    assert.equal(run.samples[0].wave, 10, "first sample kept");
    assert.equal(run.samples[run.samples.length - 1].wave, 60, "last sample kept");
});

test("captures the Soul Rest account record from body.user and exposes it", () => {
    install(FAST);
    env.parse({ user: { bestMedalPerMin: 5e9, bestMedalPerMinAt: "2026-06-25T10:00:00Z" } });
    const store = env.store();
    assert.equal(store.account.bestMedalPerMin, 5e9);
    assert.equal(env.window.__EF_SESSION_HISTORY_ACCOUNT__.bestMedalPerMin, 5e9);
    assert.ok(env.runtime.__logs.some(l => l[0] === "info" && String(l[2] || "").includes("bestMedalPerMin")), "logs the capture");
});

test("an off-device record (no matching run) is stored unattributed (runId null)", () => {
    install(FAST);
    env.parse({ user: { bestMedalPerMin: 8e9 } }); // no runs recorded -> off-device
    const recs = env.store().records;
    assert.equal(recs.length, 1);
    assert.equal(recs[0].runId, null);
    assert.equal(recs[0].mpm, 8e9);
});

test("a record that matches a recorded run is attributed to it", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 800, currentMpm: 5e9 }); // run bestMpm = 5e9
    env.parse({ user: { bestMedalPerMin: 5e9 } });
    const store = env.store();
    assert.equal(store.records[0].runId, store.runs[0].id);
});

test("survives a localStorage quota error without throwing, sparing a record run", () => {
    install(FAST);
    // a record-setting run
    env.emitSample({ rebirthTimeSec: 100, wave: 800, currentMpm: 9e9 });
    env.parse({ user: { bestMedalPerMin: 9e9 } });
    const recordRunId = env.store().records[0].runId;
    assert.equal(recordRunId, env.store().runs[0].id);
    // now clamp quota hard and push many more runs
    env.localStorage.__setQuota(400);
    assert.doesNotThrow(() => {
        for (let i = 0; i < 40; i++) {
            env.emitSample({ rebirthTimeSec: 100, wave: 100, currentMpm: 100 });        // start run i
            env.emitSample({ rebirthTimeSec: 10, wave: 50, currentMpm: 50 });           // rebirth -> next
        }
    });
    // the record run must still exist among the runs the recorder protected
    assert.ok(env.window.__EF_SESSION_HISTORY_DATA__.runs.some(r => r.id === recordRunId), "record run protected");
});

test("reads the medal-buff % onto the run's medalPct", () => {
    install(FAST);
    env.localStorage.setItem("__EF_WAVE_TRACKER_MEDAL_BUFF_PERCENT__", "20");
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    assert.equal(env.store().runs[0].medalPct, 20);
});

test("the install guard makes a second install a no-op", () => {
    install(FAST);
    const second = installSessionHistory(env.runtime);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    // only the first install recorded; second is inert
    assert.equal(env.store().runs.length, 1);
    second.detach(); // no-op detach, safe
});

test("detach clears the install guard and stops the sample subscription", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    handle.detach();
    assert.equal(env.window.__EF_SESSION_HISTORY_INSTALLED__, false);
    const before = env.store().runs[0].samples.length;
    env.emitSample({ rebirthTimeSec: 110, wave: 600, currentMpm: 1100 }); // after detach -> ignored
    assert.equal(env.store().runs[0].samples.length, before);
    handle = null;
});

test("sample throttle drops a too-soon second sample (mocked clock)", (t) => {
    t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"] });
    env.window.performance.now = () => Date.now();
    install({ sampleIntervalMs: 2000, persistIntervalMs: 0 });
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 }); // first always recorded
    t.mock.timers.tick(1000);
    env.emitSample({ rebirthTimeSec: 101, wave: 501, currentMpm: 1010 }); // 1s < 2s -> dropped
    t.mock.timers.tick(1600);
    env.emitSample({ rebirthTimeSec: 103, wave: 503, currentMpm: 1030 }); // 2.6s -> recorded
    assert.equal(env.store().runs[0].samples.length, 2);
});

test("captures run context (currencies/progression/loadout) from body.user onto the run", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    env.parse({ user: { accuMedal: 1234, maxWave: 900, accuWave: 5, numRevive: 2, tribe: 1 }, castle: { enhance: 7 }, hero: { team: [{ kindNum: 10 }] } });
    const ctx = env.store().runs[0].ctx;
    assert.equal(ctx.accuMedal, 1234);
    assert.equal(ctx.maxWave, 900);
    assert.equal(ctx.numRevive, 2);
    assert.equal(ctx.tribe, 1);
    assert.equal(ctx.castleEnhance, 7);
    assert.ok(Array.isArray(ctx.team) && ctx.team.length === 1, "captures the hero team");
});

test("persistent context fields update to the latest sync", () => {
    install(FAST);
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 });
    env.parse({ user: { accuMedal: 100, maxWave: 800 } });
    env.parse({ user: { accuMedal: 250, maxWave: 950 } });
    const ctx = env.store().runs[0].ctx;
    assert.equal(ctx.accuMedal, 250);
    assert.equal(ctx.maxWave, 950);
});

test("flushes a pending change to localStorage when the page is hidden", () => {
    install({ sampleIntervalMs: 0, persistIntervalMs: 999999 }); // throttle normal persists
    env.emitSample({ rebirthTimeSec: 100, wave: 500, currentMpm: 1000 }); // first persist always writes
    env.emitSample({ rebirthTimeSec: 110, wave: 600, currentMpm: 1100 }); // within interval -> throttled
    assert.equal(env.store().runs[0].samples.length, 1, "2nd sample not persisted yet (throttled)");
    env.document.visibilityState = "hidden";
    env.document._emit("visibilitychange");
    assert.equal(env.store().runs[0].samples.length, 2, "hide flushed the pending 2nd sample");
});
