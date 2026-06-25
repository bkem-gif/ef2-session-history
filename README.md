# EF2 Session History

Track your **Endless Frontier 2** runs over time. This is a small, **read-only** add-on to the EF2
Browser Runtime's built-in Wave Tracker: it quietly records the numbers the tracker already shows, saves
them in your browser, and draws them on a page you can open anytime. **It only ever reads your own game —
it never makes a move, spends anything, or sends a network request.**

## What you get

One entry per **rebirth run**, and for each run:

- **Charts** — medals/min and waves/min across the whole run, with each line's peak marked.
- **Run context** — a snapshot of where you were that run: max wave, revives, lifetime medals, best
  medal/min, your tribe and active skills, the **castle** (gold levels, medal levels, enhance), and your
  **deployed unit roster** with each unit's gold level, medal level, and transcend.
- **Name & notes** — give a run a name and jot notes on it (e.g. "new DK build", "lucky blessing").
- **Compare runs** — pick other runs from a dropdown to overlay them on the chart and line up their
  context side by side, so you can see what changed between rebirths.
- **Priest-buff shading** — the chart shades the stretches where Divine Blessing looks like it was *down*
  (inferred from game speed; see [How it works](#how-it-works)).
- **Export** — download everything as CSV or JSON.

Everything lives in your browser's local storage — your data, on your machine. Nothing leaves your computer.

> **You need:** the EF2 Browser Runtime with its **Wave Tracker enabled** (it's on by default). This
> add-on plugs into that tracker; it doesn't include or replace it.

## Install

You'll add two files and paste a short snippet into one of the tracker's files. It's all copy-and-paste,
and you're only *adding* lines — nothing is overwritten, so if something goes wrong you can delete what you
added and you're back to a working version.

Below, **`<runtime>`** means the folder where your EF2 Browser Runtime lives. **To find it:** it's wherever
you unzipped or installed the runtime — commonly your **Downloads** or home folder on Windows,
**Applications** or your home folder on Mac, or your home folder on Linux. Look for a folder named
**`EF2-Browser-Runtime`** (or similar). You're in the right place if you can see a **`web/`** folder inside
it.

### Step 1 — Add the recorder
Copy **`history.js`** into this folder (it sits right next to a file named `index.js`):

```
<runtime>/web/bootstrap/runtime/wave-tracker/
```

### Step 2 — Add the viewer
Copy **`history.html`** into:

```
<runtime>/web/
```

It has to be in `web/` so it opens at the same web address as the game — that's how it reads the same saved
data.

### Step 3 — Connect them (one file, two small pastes)
Open this file in a plain-text editor — **Notepad** or **Notepad++** on Windows, **TextEdit** or **VS Code**
on Mac (please not Word or Google Docs — they add formatting that breaks code):

```
<runtime>/web/bootstrap/runtime/wave-tracker/index.js
```

**(a)** At the **very top** of the file, add this line:

```js
import "./history.js";
```

**(b)** Use your editor's Find (⌘F / Ctrl-F) to locate this line:

```js
overlay.setBattle({
```

It's followed by a list of values that ends with a line containing just `});`. **Right after that
closing `});`**, paste this block:

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
    battleTime: this.battleTime
};
```

This hands the recorder a copy of each moment's numbers. The **names on the left** are what the recorder
expects; the **values on the right** are the tracker's own variables at that spot. The block above matches
the current runtime — if a future version renames a variable, just match the names you see inside the
`setBattle({ … })` right above it.

Save the file.

### Step 4 — Restart and play
Restart the runtime, or just reload the game page (press **F5**, or **⌘R** on Mac) — or close the tab and
reopen your game's address. Then play as usual; the recorder fills up in the background.

### Step 5 — Open the viewer
Go to your game's address with **`/history.html`** added to the end. Your game's address is the one you
already use to play — often something like `http://localhost:8080/...`; if you're not sure, copy it from
your browser's address bar where you launch the game. For example, if you play at
`http://localhost:8080/endlessfrontier2`, open:

```
http://localhost:8080/endlessfrontier2/history.html
```

Your runs appear as soon as you've played one.

**Did it work?** Play for a minute, then open the viewer. A chart means you're set. If it says there's no
data yet, double-check that the Step 3(b) block was pasted **right after** the `setBattle({ … });` block,
and that you opened `history.html` at the **same address** as the game. (And if the game itself won't load
after your edit, you most likely have a typo — delete the block you pasted in Step 3, save, and reload.)

*Nice-to-have: add a button in the tracker's `overlay.js` that opens `history.html`, so you don't have to
type the address.*

### Unit pictures
Unit icons ship in the **`EFUnits/`** folder, so the roster shows little portraits out of the box. They're
named by the codes in the `UNIT_ICON` map near the top of `history.html` (e.g. `WM.png`, `fairy.png`) — see
[`EFUnits/ICON-MAP.md`](EFUnits/ICON-MAP.md) for the full code→unit list. (Delete the folder and the roster
falls back to plain unit names.)

## Check the recorder logic (optional, for developers)

```sh
node history.test.js     # runs the recorder against synthetic data; exits non-zero if anything is wrong
```

## How it works

- **Read, don't push.** The Wave Tracker computes its numbers each loop; your snippet copies them onto
  `window.__EF_WAVE_SAMPLE__`. `history.js` reads that on a timer (about once a second) — the tracker
  isn't changed, only observed.
- **Runs & storage.** It records at most one data point every 2 seconds, starts a new run when the rebirth
  clock resets, keeps the most recent 30 runs, and trims very long runs so it stays small (a few MB at
  most). It's saved in `localStorage` under `__EF_SESSION_HISTORY__` (the run charts) and
  `__EF_SESSION_HISTORY_META__` (your names and notes).
- **Run context.** The recorder also watches the decrypted server data the game already receives (a
  read-only `JSON.parse` observer) and snapshots a small, **identity-free** slice onto each run — long-term
  progression only (lifetime medals, max wave, revives, best medal/min, tribe, skills, castle, unit
  roster). Spendable currencies and account identifiers are deliberately never stored. Each run is a
  **frozen snapshot**: gold levels (units and castle) reset every rebirth, so they're captured as that
  run's peak.
- **Priest-buff (Divine Blessing) shading.** The game's buff timer can't be read, but the `battleTime`
  frame counter advances faster at higher game speed, and Divine Blessing adds a fixed **+3** to speed for
  120 s. So the viewer infers when the buff was *down* from a sustained low-speed stretch and shades it.
  It's a best-effort on/off signal, not an exact percentage, and it draws nothing without `battleTime`.
- **Read-only, always.** It observes and saves locally; it never sends an action or a network request.

## Why an add-on, not a fork

The Wave Tracker is part of the **EF2 Browser Runtime by Rokhan**
(<https://github.com/Rokhanhh/EF2-Browser-Runtime>) — this repo ships **none** of it. Only `history.js` and
`history.html` (original code, MIT) live here; you add them to the tracker you already have.

## License

This project's own code (`history.js`, `history.html`) is [MIT](LICENSE). The unit images in `EFUnits/` are
**Endless Frontier 2 game art, © its developer** — bundled here for convenience and **not** covered by the MIT
license; all rights remain with the game's owner. The EF2 Browser Runtime is not included; obtain it
separately and use it under its author's terms.
