import { test } from "node:test";
import assert from "node:assert/strict";
import { tierLetters, fmtMedals } from "../shared/format.js";

test("tierLetters maps tier index to the alphabet (A=1e3, B=1e6, C=1e9…)", () => {
    assert.equal(tierLetters(0), "");
    assert.equal(tierLetters(1), "A");
    assert.equal(tierLetters(26), "Z");
    assert.equal(tierLetters(27), "AA");
    assert.equal(tierLetters(28), "AB");
    assert.equal(tierLetters(52), "AZ");
    assert.equal(tierLetters(53), "BA");
    assert.equal(tierLetters(702), "ZZ");
    assert.equal(tierLetters(703), "AAA");
    assert.equal(tierLetters(-1), "");
});

test("fmtMedals formats positives and rolls tiers correctly", () => {
    assert.equal(fmtMedals(0), "0");
    assert.equal(fmtMedals(5), "5");
    assert.equal(fmtMedals(999), "999");
    assert.equal(fmtMedals(1000), "1A");
    assert.equal(fmtMedals(1500), "1.5A");
    assert.equal(fmtMedals(1234567), "1.23B");
    assert.equal(fmtMedals(999999), "1B");      // rounding rolls 999.999A -> 1B
    assert.equal(fmtMedals(1e9), "1C");
    assert.equal(fmtMedals(6.5e9), "6.5C");
    assert.equal(fmtMedals(0.5), "0.5");
});

test("fmtMedals returns an em-dash for non-finite input", () => {
    assert.equal(fmtMedals(NaN), "—");
    assert.equal(fmtMedals(Infinity), "—");
    assert.equal(fmtMedals(-Infinity), "—");
    assert.equal(fmtMedals(undefined), "—");
});

test("fmtMedals is sign-safe for negatives (P3 fix)", () => {
    assert.equal(fmtMedals(-1500000), "-1.5B");
    assert.equal(fmtMedals(-999), "-999");
    assert.equal(fmtMedals(-1e9), "-1C");
});
