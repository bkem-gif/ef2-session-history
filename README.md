# EF2 Session History

Records your **Endless Frontier 2** Wave Tracker runs over time and shows them as charts — wave
progress, MPM/WPM, completed/skipped waves — one set per **rebirth cycle**. It's a small, **read-only
addon** to the EF2 Browser Runtime's existing Wave Tracker: it observes the numbers the tracker already
computes, saves them locally, and draws them. Your own gameplay data only — it never sends a move or
makes a network request.

> **Prerequisite:** a runtime whose **Wave Tracker is enabled** — it ships with the EF2 Browser Runtime
> and is on by default (`showWaveTracker`). This repo does **not** include the Wave Tracker; you add
> session history *to* it.

## What's here

| File | Purpose |
|------|---------|
| `history.js` | the **recorder** — a self-contained script that polls the tracker's published sample, segments your play into runs (one per rebirth), downsamples a time series, and saves it to `localStorage["__EF_SESSION_HISTORY__"]`. |
| `history.html` | the **viewer** — a standalone page that reads that key and renders the charts. |
| `history.test.js` | a Node test of the recorder logic (run segmentation, rebirth split, field mapping). |

## Install — two one-line edits, nothing overwritten

The Wave Tracker is already in your runtime; you load the recorder and hand it each sample.

**1. Drop in the recorder.** Copy `history.js` into your runtime's
`web/bootstrap/runtime/wave-tracker/` (next to the tracker's `index.js`).

**2. Wire it into `wave-tracker/index.js`** — two additions, nothing removed:

```js
// a) at the top, with the other imports — loads the self-running recorder:
import "./history.js";
```

```js
// b) inside the tracker's loop, right where it builds its overlay snapshot
//    (just after it calls overlay.update(...)), publish that sample:
window.__EF_WAVE_SAMPLE__ = {
    wave, maxWave, rebirthTimeSec, currentMpm, bestMpm,
    wpm, wpmReady, waveTimeSec, completedWaves, skippedWaves, recommendation
};
```

Those names are the variables already in scope at that point in `index.js`. The recorder polls this
global, de-dups, throttles, and self-persists — there's no other wiring (no `flush()`, no API surface).

**3. Add the viewer.** Copy `history.html` into your runtime's `web/` folder so it's served
**same-origin** as the game (it must share the game page's `localStorage`). Open it at, e.g.,
`http://localhost:8080/endlessfrontier2/history.html` — use your runtime's port / base path.

**4. Restart and play.** The recorder fills as you play; open the viewer anytime to see your runs.

*(Optional polish: add a button to the tracker's `overlay.js` that opens `history.html`.)*

## Verify (optional)

```sh
node history.test.js     # drives the recorder with synthetic samples; exits non-zero on failure
```

## How it works

- **Publish → poll, not push.** The Wave Tracker keeps its metrics as locals; your one-line edit copies
  each loop's sample onto `window.__EF_WAVE_SAMPLE__`. `history.js` reads that on a timer (≤ once/second).
  Because the tracker assigns a fresh object each loop, a reference check both de-dups and notices when
  the game stops publishing.
- **Runs & storage.** One record at most every 10s; a new run begins when the rebirth clock drops; the
  last 30 runs are kept and long runs are decimated to stay within the storage quota.
- **Viewer.** `history.html` reads `localStorage["__EF_SESSION_HISTORY__"]` and renders the charts.
  Same-origin with the game is required so they share storage.
- **Read-only.** It observes the tracker's output and saves it locally; it never sends an action or a
  network request.

## Why an addon, not a fork

The Wave Tracker itself is part of the **EF2 Browser Runtime by Rokhan**
(<https://github.com/Rokhanhh/EF2-Browser-Runtime>) — this repo ships **none** of it. Only `history.js`
+ `history.html` (original code, MIT) live here; you add them to the Wave Tracker you already have.

## License

[MIT](LICENSE). Endless Frontier 2 game content and the EF2 Browser Runtime are not included or
redistributed here; you obtain the runtime separately and use it under its author's terms.
