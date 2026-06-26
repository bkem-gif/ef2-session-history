# EF2 Session History — runtime plugin

Track your **Endless Frontier 2** runs over time. A small, **read-only** recorder + viewer for the EF2
Browser Runtime: it records the numbers per run, saves them in your browser, and draws them on a page you
can open anytime. **It only ever reads your own game — it never makes a move, spends anything, or sends a
network request.**

> This is the **plugin** form for the current EF2 Browser Runtime (its browser-plugin architecture). The
> older form — a `history.js` you imported into Rokhan's Wave Tracker by hand — is on the **`main`** branch.

## What you get

One entry per **rebirth run**, and for each run:

- **Charts** — medals/min and waves/min across the whole run, with each line's peak marked.
- **Run context** — a snapshot of where you were that run: max wave, revives, lifetime medals, best
  medal/min, your tribe and active skills, the **castle** (gold levels, medal levels, enhance), and your
  **deployed unit roster** with each unit's gold level, medal level, and transcend (with portraits).
- **Name & notes** — give a run a name and jot notes on it (e.g. "new DK build", "lucky blessing").
- **Compare runs** — overlay other runs on the chart and line up their context side by side.
- **Priest-buff shading** — shades the stretches where Divine Blessing looks like it was *down* (inferred
  from game speed; see [How it works](#how-it-works)).
- **Export** — download everything as CSV or JSON.

Everything lives in your browser's local storage — your data, on your machine. Nothing leaves your computer.

## Install

You need the plugin-capable **EF2 Browser Runtime** (Rokhan's project, obtained separately — see
[Attribution](#why-a-plugin-not-a-fork)). Below, **`<runtime>`** is the folder where it lives.

**1. Drop this folder into the runtime's `plugins/`, named `session-history/`:**

```sh
cp -R <this-repo> <runtime>/plugins/session-history
```

The runtime discovers it from `plugin.json`. Restart the runtime's local server (it logs active plugin
ids at startup). Enable/disable anytime via `plugin.json`'s `"enabled"`.

**2. Open the viewer** at your game's address with this path appended:

```
http://localhost:<port>/__ef_plugins__/session-history/history.html
```

It's served from the runtime (same origin as the game), which is how it reads the same saved data. Your
runs appear as soon as you've played one.

That's the whole recorder — no more importing `history.js` or pasting into the tracker. **One** optional
step enables the wave/MPM **charts**:

### For the wave/MPM charts: one line in the Wave Tracker plugin

The recorder gets your **run context** (progression, roster, castle) on its own. The **time-series**
(medals/min and waves/min over the run) is computed by the Wave Tracker, which doesn't publish it by
default. To enable the charts, add one line where the wave-tracker plugin computes its per-loop metrics.
Open (in a plain-text editor):

```
<runtime>/plugins/wave-tracker/index.js
```

Find the `overlay.setBattle({ … });` call, and **right after** its closing `});` paste:

```js
window.__EF_WAVE_SAMPLE__ = {
    wave,
    maxWave,
    rebirthTimeSec,
    currentMpm: medalMpmState.currentMpm,
    bestMpm: bestMpmState.mpm,
    wpm: wpmState.wpm,
    wpmReady: wpmState.ready,
    waveTimeSec,
    completedWaves,
    skippedWaves,
    recommendation: medalMpmState.recommendation,
    battleTime: controller.battleTime
};
```

Restart the runtime. The block's **left-hand names** are what the recorder expects; the **right-hand
values** are the wave-tracker's own variables at that spot — if a future runtime renames one, match the
names you see inside the `setBattle({ … })` right above. (The recorder also listens for a `wave:sample`
runtime event, so if a future Wave Tracker emits one you won't need this edit.) **Without it, run-context
history still records — only the wave/MPM charts stay empty.**

### Unit pictures

Unit icons ship in the **`EFUnits/`** folder and are served alongside the viewer, so the roster shows
portraits out of the box. They're named by the codes in the `UNIT_ICON` map near the top of `history.html`
(e.g. `WM.png`, `fairy.png`) — see [`EFUnits/ICON-MAP.md`](EFUnits/ICON-MAP.md) for the full code→unit
list. (Delete the folder and the roster falls back to plain unit names.)

## Files

| File | Purpose |
|------|---------|
| `plugin.json` | plugin manifest (id, entry, handle) |
| `plugin.js` | plugin entry — installs the recorder via the runtime API |
| `recorder.js` | the recorder: run segmentation, read-only run-context capture, persistence to `__EF_SESSION_HISTORY__` |
| `history.html` | the viewer — charts, run comparison, unit-icon roster |
| `EFUnits/` | unit icons (EF2 game art; see License) + `ICON-MAP.md` |
| `history.js` | the older Wave-Tracker-addon form (for the pre-plugin runtime; unused by the plugin) |
| `history.test.js` | `node history.test.js` — runs the recorder against synthetic data |

## How it works

- **Read, don't push.** This plugin runs entirely in the browser, read-only. `plugin.js` installs the
  recorder; the recorder reads run context through the runtime's sanctioned `runtime.hooks.onJsonParse`
  (the runtime owns the single `JSON.parse` wrap), and reads the per-loop wave/MPM numbers from
  `window.__EF_WAVE_SAMPLE__` (or a `wave:sample` runtime event). Nothing in the game is changed, only
  observed.
- **Runs & storage.** It records at most one data point every 2 seconds, starts a new run when the rebirth
  clock resets, keeps the most recent 30 runs, and trims very long runs so it stays small. Saved in
  `localStorage` under `__EF_SESSION_HISTORY__`.
- **Run context.** A small, **identity-free** slice is snapshotted onto each run — long-term progression
  only (lifetime medals, max wave, revives, best medal/min, tribe, skills, castle, unit roster). Spendable
  currencies and account identifiers are deliberately never stored. Each run is a **frozen snapshot**: gold
  levels (units and castle) reset every rebirth, so they're captured as that run's peak.
- **Priest-buff (Divine Blessing) shading.** The buff timer can't be read, but the `battleTime` frame
  counter advances faster at higher game speed, and Divine Blessing adds a fixed **+3** speed for 120 s.
  The viewer infers when the buff was *down* from a sustained low-speed stretch and shades it — a
  best-effort on/off signal, not an exact percentage, and it draws nothing without `battleTime`.
- **Read-only, always.** It observes and saves locally; it never sends an action or a network request.

## Why a plugin, not a fork

The Wave Tracker is part of the **EF2 Browser Runtime by Rokhan**
(<https://github.com/Rokhanhh/EF2-Browser-Runtime>) — this repo ships **none** of it. Only the plugin
(`plugin.js`, `recorder.js`, `history.html`) is original code (MIT); you drop it into the runtime you
already have. The one optional line above is an edit to *your* copy of the wave-tracker plugin, not
included here.

## License

This project's own code (`plugin.js`, `recorder.js`, `history.html`, `history.js`) is [MIT](LICENSE). The
unit images in `EFUnits/` are **Endless Frontier 2 game art, © its developer** — bundled for convenience
and **not** covered by the MIT license; all rights remain with the game's owner. The EF2 Browser Runtime is
not included; obtain it separately and use it under its author's terms.
