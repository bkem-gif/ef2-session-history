import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installEnv } from "./_env.js";
import { installSessionOverlay } from "../overlay.js";

let env, ov;

function seedRecord(mpm) { env.window.__EF_SESSION_HISTORY_ACCOUNT__ = { bestMedalPerMin: mpm }; }
function panel() { return env.document.getElementById("ef-session-record-overlay"); }
function cdLine() { return env.document.getElementById("ef-cd-line"); }

beforeEach(() => { env = installEnv(); });
afterEach(() => { try { if (ov) { ov.detach(); } } catch (e) {} ov = null; env.restore(); });

test("no record -> no panel is built", () => {
    ov = installSessionOverlay(env.runtime);
    assert.equal(panel(), null);
});

test("overlay disabled in settings -> panel hidden", () => {
    seedRecord(50);
    env.localStorage.setItem("__EF_SESSION_HISTORY_SETTINGS__", JSON.stringify({ overlay: false }));
    ov = installSessionOverlay(env.runtime);
    assert.equal(panel(), null);
});

test("record present -> panel built with the runtime hide/show attribute", () => {
    seedRecord(50);
    ov = installSessionOverlay(env.runtime);
    assert.ok(panel(), "panel exists");
    assert.equal(panel().dataset.efPluginOverlay, "session-history");
});

test("applies the medal-buff % to the live 'now' value", () => {
    seedRecord(50);
    env.localStorage.setItem("__EF_WAVE_TRACKER_MEDAL_BUFF_PERCENT__", "20");
    ov = installSessionOverlay(env.runtime);
    env.emitSample({ rebirthTimeSec: 100, medalMpmState: { currentMpm: 100 } }); // raw 100 -> 120
    assert.ok(panel().textContent.includes("120"), "now shows medal-corrected 120");
    assert.ok(!panel().textContent.includes("100%"), "not the raw 100");
});

test("above record -> 'above' class + correct +% in the status line", () => {
    seedRecord(50);
    ov = installSessionOverlay(env.runtime);
    env.emitSample({ rebirthTimeSec: 100, medalMpmState: { currentMpm: 60 } }); // 60 vs 50 -> +20%
    assert.ok(panel().classList.contains("above"));
    assert.ok(panel().textContent.includes("ABOVE RECORD +20.0%"));
});

test("below record -> no 'above' class, no countdown line", () => {
    seedRecord(50);
    ov = installSessionOverlay(env.runtime);
    env.emitSample({ rebirthTimeSec: 100, medalMpmState: { currentMpm: 40 } }); // below
    assert.ok(!panel().classList.contains("above"));
    assert.equal(cdLine(), null);
});

test("glow toggle off -> no pulse class even when above", () => {
    seedRecord(50);
    env.localStorage.setItem("__EF_SESSION_HISTORY_SETTINGS__", JSON.stringify({ overlayGlow: false }));
    ov = installSessionOverlay(env.runtime);
    env.emitSample({ rebirthTimeSec: 100, medalMpmState: { currentMpm: 60 } });
    assert.ok(panel().classList.contains("above"));
    assert.ok(!panel().classList.contains("pulse"));
});

test("countdown zones: early / near / go by seconds-to-boundary", (t) => {
    t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"] });
    env.window.performance.now = () => Date.now();
    seedRecord(50);
    ov = installSessionOverlay(env.runtime);
    // :10 -> s=50 -> early
    env.emitSample({ rebirthTimeSec: 25 * 60 + 10, medalMpmState: { currentMpm: 100 } });
    assert.ok(cdLine().className.includes("cd-early"), "early at :10");
    // :52 -> s=8 -> near
    env.emitSample({ rebirthTimeSec: 25 * 60 + 52, medalMpmState: { currentMpm: 100 } });
    assert.ok(cdLine().className.includes("cd-near"), "near at :52");
    // :58 -> s=2 -> go
    env.emitSample({ rebirthTimeSec: 25 * 60 + 58, medalMpmState: { currentMpm: 100 } });
    assert.ok(cdLine().className.includes("cd-go"), "go at :58");
    assert.ok(cdLine().textContent.includes("REVIVE NOW"));
});

test("countdown hides when no sample for >12s (run inactive)", (t) => {
    t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"] });
    env.window.performance.now = () => Date.now();
    seedRecord(50);
    ov = installSessionOverlay(env.runtime);
    env.emitSample({ rebirthTimeSec: 25 * 60 + 58, medalMpmState: { currentMpm: 100 } });
    assert.ok(cdLine().className.includes("cd-go"));
    t.mock.timers.tick(13000); // no new sample -> the 250ms ticker should hide it
    assert.equal(cdLine().style.display, "none");
});

test("reacts to a medal-% storage event (re-renders the corrected now)", () => {
    seedRecord(50);
    ov = installSessionOverlay(env.runtime);
    env.emitSample({ rebirthTimeSec: 100, medalMpmState: { currentMpm: 100 } });
    assert.ok(panel().textContent.includes("100"));
    env.localStorage.setItem("__EF_WAVE_TRACKER_MEDAL_BUFF_PERCENT__", "50");
    env.fireStorage("__EF_WAVE_TRACKER_MEDAL_BUFF_PERCENT__"); // 100 -> 150
    assert.ok(panel().textContent.includes("150"), "re-rendered with 150");
});

test("detach removes the panel and the style node", () => {
    seedRecord(50);
    ov = installSessionOverlay(env.runtime);
    assert.ok(panel());
    ov.detach(); ov = null;
    assert.equal(panel(), null);
    assert.equal(env.document.getElementById("ef-session-record-overlay-style"), null);
});
