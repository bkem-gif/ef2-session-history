# EF2 Session History

Track your **Endless Frontier 2** runs over time. A small, **read-only** add-on for the EF2 Browser
Runtime: it quietly records the numbers from each rebirth run, saves them in your browser, and shows
them on a page you can open anytime. **It only ever reads your own game — it never makes a move, spends
anything, or sends anything anywhere.**

---

> ## 📊 Open your history page here:
>
> ### `http://localhost:8080/__ef_plugins__/session-history/history.html`
>
> Use the **same web address you play the game at** — same `localhost`, same port. Most people play at
> `http://localhost:8080/...`, so the address above is right. If your game is on a different port (the
> number after `localhost:`), use that same number here. **Bookmark this page.** Your runs appear after
> you've played for a bit.

---

## What you get

One entry per **rebirth run**, and for each run:

- **Charts** — medals/min and waves/min across the whole run, with each line's peak marked.
- **Run details** — max wave, revives, lifetime medals, best medal/min, your tribe and active skills, your
  **castle** (gold levels, medal levels, enhance), and your **deployed unit roster** with each unit's gold
  level, medal level, and transcend — shown with unit portraits.
- **Name & notes** — name a run and jot notes on it ("new DK build", "lucky blessing").
- **Compare runs** — overlay other runs on the chart and line up their details side by side.
- **Export** — download everything as CSV or JSON.

Everything stays in your browser. Nothing leaves your computer.

---

## Installing / updating to the new plugin version

The EF2 Browser Runtime now loads add-ons from a **`plugins`** folder. This makes Session History **much
easier** to set up than the old version — **no copying files into the Wave Tracker, and no pasting code.**

> **Did you use the old version?** (Back then you copied `history.js` next to the Wave Tracker's
> `index.js`, put `history.html` in the `web` folder, and pasted a snippet.) **You don't need any of that
> anymore.** Just update your runtime to the latest version and follow the three steps below. The old
> files won't break anything — they're simply no longer used.

### Just three steps

1. **Download this add-on.** Near the top of this page, make sure the branch button says **`plugin`**, then
   click the green **`< > Code`** button → **Download ZIP**. Unzip the file you get — inside is a folder of
   files, including one named `plugin.json`.

2. **Put the folder into your runtime.** Find your **EF2 Browser Runtime** folder, open the **`plugins`**
   folder inside it, and drop the unzipped folder in there — **renamed to `session-history`**. When you're
   done it should look like this:

   ```
   …/EF2-Browser-Runtime/plugins/session-history/plugin.json
   …/EF2-Browser-Runtime/plugins/session-history/history.html
   …/EF2-Browser-Runtime/plugins/session-history/  (and the rest)
   ```

3. **Restart the runtime** — close it and start it again. That's it. It's now recording in the background
   while you play.

Then open your history page at the address in the box near the top. ⬆️

---

## Want the charts? One small, optional edit

The **run details** (roster, castle, progression) record on their own — nothing extra needed. The
**charts** (medals/min and waves/min) need **one line** added to the Wave Tracker, because the runtime
doesn't share those moment-to-moment numbers by default.

Open this file in a **plain text editor** (Notepad on Windows, TextEdit on Mac — please not Word):

```
…/EF2-Browser-Runtime/plugins/wave-tracker/index.js
```

Use Find (Ctrl-F / ⌘F) to locate **`overlay.setBattle({`**. It's followed by a list that ends with a line
that's just `});`. **Right after that `});`**, paste this block:

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

Save the file and restart the runtime. The charts fill in as you play. (If a future runtime renames a
variable, just match the names you see inside the `setBattle({ … })` right above. Without this edit,
everything else still works — only the charts stay empty.)

---

## How it works

- **Read, don't touch.** This add-on runs in your browser and only *watches* the game through the
  runtime's official plugin tools. It never changes the game — it just observes and saves.
- **Runs & storage.** It saves at most one data point every couple of seconds, starts a new run when you
  rebirth, keeps your most recent 30 runs, and stores it all in your browser under
  `__EF_SESSION_HISTORY__`.
- **Run details.** It snapshots a small, **identity-free** slice of your progression each run (lifetime
  medals, max wave, revives, tribe, skills, castle, roster). Spendable currencies and any account
  identifiers are **never** stored.
- **Read-only, always.** It never sends an action or a network request.

## License

The code here (`plugin.js`, `recorder.js`, `history.html`, `history.js`) is [MIT](LICENSE). The unit images
in `EFUnits/` are **Endless Frontier 2 game art, © its developer** — bundled for convenience and **not**
covered by the MIT license. The EF2 Browser Runtime is by **Rokhan**
(<https://github.com/Rokhanhh/EF2-Browser-Runtime>); get it separately and use it under its author's terms.
