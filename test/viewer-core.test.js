import { test } from "node:test";
import assert from "node:assert/strict";
import {
    fmtShortDate, niceCeil, niceCeilTime, metricVal,
    btOf, deriveSpeedIntervals, detectBuffDown, inAnySpan,
} from "../viewer-core.js";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("fmtShortDate blanks falsy/epoch-0/invalid, labels real dates", () => {
    assert.equal(fmtShortDate(NaN), "");
    assert.equal(fmtShortDate("not a date"), "");
    assert.equal(fmtShortDate(0), "");          // P4
    assert.equal(fmtShortDate(null), "");        // P4
    assert.equal(fmtShortDate(undefined), "");
    assert.ok(fmtShortDate(Date.parse("2026-06-25")).length > 0);
});

test("niceCeil rounds up to 1/2/5 × 10ⁿ", () => {
    assert.equal(niceCeil(0), 1);
    assert.equal(niceCeil(-5), 1);
    assert.equal(niceCeil(1), 1);
    assert.equal(niceCeil(1.5), 2);
    assert.equal(niceCeil(3), 5);
    assert.equal(niceCeil(7), 10);
    assert.equal(niceCeil(50), 50);
    assert.equal(niceCeil(205), 500);
    assert.ok(near(niceCeil(0.05), 0.05));
});

test("niceCeilTime snaps up to a fine minute step with ~5% headroom", () => {
    assert.equal(niceCeilTime(0), 1);
    assert.equal(niceCeilTime(-3), 1);
    assert.equal(niceCeilTime(205), 220);
    assert.equal(niceCeilTime(10), 12);
    assert.ok(near(niceCeilTime(1), 1.2, 1e-9));
    assert.ok(near(niceCeilTime(0.1), 0.12, 1e-9));
});

test("metricVal: missing -> NaN, real zero kept", () => {
    assert.ok(Number.isNaN(metricVal(null)));
    assert.ok(Number.isNaN(metricVal(undefined)));
    assert.ok(Number.isNaN(metricVal("")));
    assert.equal(metricVal(0), 0);
    assert.equal(metricVal("5"), 5);
    assert.ok(Number.isNaN(metricVal("abc")));
});

test("btOf parses the frame counter or null", () => {
    assert.equal(btOf({ bt: 600 }), 600);
    assert.equal(btOf({ bt: "600" }), 600);
    assert.equal(btOf({ bt: null }), null);
    assert.equal(btOf({ bt: "" }), null);
    assert.equal(btOf({}), null);
    assert.equal(btOf(null), null);
});

test("inAnySpan respects endpoints within tolerance", () => {
    const spans = [{ x0: 4, x1: 6 }];
    assert.equal(inAnySpan(5, spans), true);
    assert.equal(inAnySpan(4, spans), true);
    assert.equal(inAnySpan(6, spans), true);
    assert.equal(inAnySpan(3.9, spans), false);
    assert.equal(inAnySpan(5, []), false);
});

const smp = (bt, wallSec, t) => ({ bt, wall: wallSec * 1000, t });

test("deriveSpeedIntervals: needs two valid samples; speed = Δframes/(60·Δs)", () => {
    assert.deepEqual(deriveSpeedIntervals([]), []);
    assert.deepEqual(deriveSpeedIntervals([smp(0, 0, 0)]), []);
    const one = deriveSpeedIntervals([smp(0, 0, 0), smp(600, 10, 10)]);
    assert.equal(one.length, 1);
    assert.ok(near(one[0].speed, 1));
    assert.equal(one[0].afterReload, false);
});

test("deriveSpeedIntervals: a reset across a >20s gap flags afterReload; a short reset doesn't", () => {
    const reload = deriveSpeedIntervals([smp(600, 0, 0), smp(0, 30, 30), smp(600, 40, 40)]);
    assert.equal(reload.length, 1);
    assert.equal(reload[0].afterReload, true);
    const stage = deriveSpeedIntervals([smp(600, 0, 0), smp(0, 5, 5), smp(600, 15, 15)]);
    assert.equal(stage.length, 1);
    assert.equal(stage[0].afterReload, false);
});

test("deriveSpeedIntervals drops bad intervals (tiny gap, huge gap, implausible speed, null bt)", () => {
    assert.deepEqual(deriveSpeedIntervals([smp(0, 0, 0), smp(60, 0.4, 0.4)]), []);     // dwall <= 0.5
    assert.deepEqual(deriveSpeedIntervals([smp(0, 0, 0), smp(60, 400, 400)]), []);     // dwall > 300
    assert.deepEqual(deriveSpeedIntervals([smp(0, 0, 0), smp(1e6, 1, 1)]), []);        // speed > 100
    assert.deepEqual(deriveSpeedIntervals([smp(null, 0, 0), smp(600, 10, 10)]), []);   // null bt
});

const iv = (speed, i, afterReload = false) => ({ x0: i, x1: i + 1, speed, afterReload });

test("detectBuffDown: ok:false without enough data or visible spread", () => {
    assert.equal(detectBuffDown([]).ok, false);
    assert.equal(detectBuffDown([iv(3, 0), iv(3, 1), iv(3, 2)]).ok, false);            // < 4 battle intervals
    assert.equal(detectBuffDown([iv(3, 0), iv(3, 1), iv(3, 2), iv(3, 3)]).ok, false);  // no plateau spread
});

test("detectBuffDown: splits two plateaus into down spans", () => {
    const ivs = [5, 5, 2, 2, 5, 5, 2, 2].map((s, i) => iv(s, i));
    const r = detectBuffDown(ivs);
    assert.equal(r.ok, true);
    assert.equal(r.spans.length, 2);
    assert.ok(near(r.spans[0].x0, 2));
    assert.ok(near(r.spans[1].x0, 6));
});

test("detectBuffDown: suppresses the post-reload leading-down until the buff is seen up", () => {
    const speeds = [2, 2, 5, 5, 2, 2, 5, 5];
    const ivs = speeds.map((s, i) => iv(s, i, i === 0));   // reload at the very start
    const r = detectBuffDown(ivs);
    assert.equal(r.ok, true);
    assert.equal(r.spans.length, 1, "leading post-reload down suppressed");
    assert.ok(near(r.spans[0].x0, 4));
});
