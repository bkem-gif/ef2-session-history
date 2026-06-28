import { test } from "node:test";
import assert from "node:assert/strict";
import { pctOf, medalMult, deriveRecords, recordRankOf } from "../shared/records.js";

test("pctOf accepts only non-negative integers (the canonical rule)", () => {
    assert.equal(pctOf({ medalPct: 50 }), 50);
    assert.equal(pctOf({ medalPct: 0 }), 0);
    assert.equal(pctOf({ medalPct: "50" }), 50);
    assert.equal(pctOf({ medalPct: null }), null);
    assert.equal(pctOf({ medalPct: undefined }), null);
    assert.equal(pctOf({ medalPct: "" }), null);
    assert.equal(pctOf({ medalPct: 50.5 }), null);   // P0: fractional rejected (was accepted by recorder)
    assert.equal(pctOf({ medalPct: -10 }), null);
    assert.equal(pctOf({ medalPct: "abc" }), null);
    assert.equal(pctOf(null), null);
    assert.equal(pctOf(undefined), null);
});

test("medalMult turns the % into a multiplier (1 when no valid buff)", () => {
    assert.equal(medalMult({ medalPct: 50 }), 1.5);
    assert.equal(medalMult({ medalPct: 0 }), 1);
    assert.equal(medalMult({ medalPct: 200 }), 3);
    assert.equal(medalMult({ medalPct: null }), 1);
    assert.equal(medalMult({}), 1);
    assert.equal(medalMult({ medalPct: 50.5 }), 1);  // P0: fractional ignored (recorder once gave 1.505)
});

test("deriveRecords picks running-max peaks, newest first", () => {
    assert.deepEqual(deriveRecords([], null), []);
    assert.deepEqual(
        deriveRecords([{ id: 1, bestMpm: 100, startedAtWall: 1 }], null),
        [{ runId: 1, mpm: 100, at: 1 }]
    );
    const runs = [
        { id: 1, bestMpm: 100, startedAtWall: 1 },
        { id: 2, bestMpm: 200, startedAtWall: 2 },
        { id: 3, bestMpm: 150, startedAtWall: 3 },   // not a new high
    ];
    assert.deepEqual(deriveRecords(runs, null), [
        { runId: 2, mpm: 200, at: 2 },
        { runId: 1, mpm: 100, at: 1 },
    ]);
});

test("deriveRecords: ties need a STRICT increase; NaN peaks are skipped", () => {
    const tie = [{ id: 1, bestMpm: 100, startedAtWall: 1 }, { id: 2, bestMpm: 100, startedAtWall: 2 }];
    assert.deepEqual(deriveRecords(tie, null), [{ runId: 1, mpm: 100, at: 1 }]);
    const withNaN = [{ id: 1, bestMpm: 100, startedAtWall: 1 }, { id: 2, bestMpm: undefined, startedAtWall: 2 }];
    assert.deepEqual(deriveRecords(withNaN, null), [{ runId: 1, mpm: 100, at: 1 }]);
});

test("deriveRecords sorts by startedAtWall, falling back to id", () => {
    const runs = [{ id: 2, bestMpm: 200 }, { id: 1, bestMpm: 100 }];   // no startedAtWall -> sort by id
    assert.deepEqual(deriveRecords(runs, null), [{ runId: 2, mpm: 200, at: null }, { runId: 1, mpm: 100, at: null }]);
});

test("deriveRecords prepends an off-device server record only when clearly higher (>5%)", () => {
    const runs = [{ id: 1, bestMpm: 100, startedAtWall: 1 }];
    // clearly higher -> off-device entry leads, unattributed
    assert.deepEqual(deriveRecords(runs, { bestMedalPerMin: 1000, bestMedalPerMinAt: "x" }), [
        { runId: null, mpm: 1000, at: "x" },
        { runId: 1, mpm: 100, at: 1 },
    ]);
    // within 5% band -> not prepended (float-jitter dedup)
    assert.deepEqual(deriveRecords(runs, { bestMedalPerMin: 101 }), [{ runId: 1, mpm: 100, at: 1 }]);
    // equal -> not prepended
    assert.deepEqual(deriveRecords(runs, { bestMedalPerMin: 100 }), [{ runId: 1, mpm: 100, at: 1 }]);
    // zero/negative server -> ignored
    assert.deepEqual(deriveRecords(runs, { bestMedalPerMin: 0 }), [{ runId: 1, mpm: 100, at: 1 }]);
});

test("deriveRecords with no local runs surfaces the server record off-device", () => {
    assert.deepEqual(deriveRecords([], { bestMedalPerMin: 8e9, bestMedalPerMinAt: "t" }), [
        { runId: null, mpm: 8e9, at: "t" },
    ]);
});

test("deriveRecords caps at maxRecords (newest 5)", () => {
    const runs = [];
    for (let i = 1; i <= 8; i++) { runs.push({ id: i, bestMpm: i * 100, startedAtWall: i }); }
    const recs = deriveRecords(runs, null, 5);
    assert.equal(recs.length, 5);
    assert.equal(recs[0].runId, 8);   // newest/highest
    assert.equal(recs[4].runId, 4);
});

test("deriveRecords applies the medal-buff to the peak (ordering can change)", () => {
    // run 2 raw 90 but +20% -> 108, beating run 1's 100
    const runs = [
        { id: 1, bestMpm: 100, startedAtWall: 1, medalPct: 0 },
        { id: 2, bestMpm: 90, startedAtWall: 2, medalPct: 20 },
    ];
    const recs = deriveRecords(runs, null);
    assert.equal(recs[0].runId, 2);
    assert.ok(Math.abs(recs[0].mpm - 108) < 1e-9);
});

test("recordRankOf returns 1-based rank or 0", () => {
    const recs = [{ runId: 5 }, { runId: 3 }];
    assert.equal(recordRankOf(recs, 5), 1);
    assert.equal(recordRankOf(recs, 3), 2);
    assert.equal(recordRankOf(recs, 9), 0);
    assert.equal(recordRankOf(recs, null), 0);
    assert.equal(recordRankOf(recs, undefined), 0);
    assert.equal(recordRankOf(null, 5), 0);
});
