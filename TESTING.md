# Testing

The plugin ships with a zero‑dependency test suite that runs on the built‑in Node test runner
(Node 18+; developed on v24). No `npm install` is needed.

```bash
npm test            # run everything once
npm run test:watch  # re-run on change
npm run coverage    # node --test --experimental-test-coverage
```

## What's covered

| Suite | Target | Notes |
|---|---|---|
| `test/recorder.test.js` | `recorder.js` — the data layer | Integration: drives the real `wave:sample` event + `JSON.parse` hook and asserts the persisted `localStorage` store. Run segmentation/rebirth detection, nested→flat sample adapt, peak/best running max, decimation, context capture (currencies/progression/loadout, latest‑wins), Soul Rest account capture, record attribution (on‑ and off‑device), quota recovery with record protection, medal‑% capture, install guard, detach, sample throttle, flush‑on‑hide. |
| `test/overlay.test.js` | `overlay.js` — the in‑game HUD | DOM‑shim: record/settings gating, medal‑% correction, above‑record class + status %, glow toggle, the `:59` countdown zones (early/near/go), staleness hide, storage‑event reactivity, detach teardown. |
| `test/records.test.js` | `shared/records.js` | Canonical record derivation: `pctOf` (integer guard), `medalMult`, `deriveRecords` (running‑max, off‑device band, cap, buff‑affects‑ordering), `recordRankOf`. |
| `test/format.test.js` | `shared/format.js` | `tierLetters`, `fmtMedals` (tier rollover, non‑finite, sign‑safe negatives). |

## Architecture

`test/_env.js` builds a fresh fake environment per test and installs it on `globalThis`:
a Map‑backed `localStorage` (with a quota mode), a ~100‑line DOM shim (only what the overlay
touches), and a self‑contained mock `runtime` (`events` / `hooks.onJsonParse` / `logger`). The
components are ES‑module closures reading free globals, so each test does
`installEnv()` → `installSessionHistory(runtime)` / `installSessionOverlay(runtime)` →
drive inputs → assert the store / DOM → `detach()` + `restore()`. Time‑dependent cases use
`node:test` `mock.timers`.

## Single source of truth

`shared/records.js` and `shared/format.js` are imported by the recorder, the overlay, **and**
the viewer (`history.html` is an ES module) so the record set, the trophies, and number formatting
can never drift between surfaces — a past divergence here is what the suite now guards.

## Known follow‑up (not yet covered)

The viewer's pure chart‑math (`niceCeil`/`niceCeilTime`, `metricVal`, `deriveSpeedIntervals`,
`detectBuffDown`, `inAnySpan`, `feat`) is still inline in `history.html` and not unit‑tested.
Extracting it into a sibling `viewer-core.js` module (imported back by the viewer) is the next
hardening step; the chart *rendering* (canvas/DOM) stays integration‑verified via the preview.
