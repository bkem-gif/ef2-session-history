// EF2 Session History — recorder.
//
// A self-contained, read-only addon to the EF2 Browser Runtime's Wave Tracker.
// It polls the per-loop sample the tracker publishes on `window.__EF_WAVE_SAMPLE__`,
// segments your play into runs (one run = one rebirth cycle), downsamples a time
// series, and persists it to localStorage. The standalone viewer (history.html)
// reads the same key and renders the charts.
//
// Wiring (two one-line edits to the tracker's index.js — see README):
//   import "./history.js";                                    // load this recorder
//   window.__EF_WAVE_SAMPLE__ = { wave, maxWave, ... };       // publish each sample
//
// It owns its own lifecycle: it polls, throttles, and self-persists (incl. on
// page hide). Nothing calls into it; it never sends a move or a network request.
//
// It also observes JSON.parse (read-only) to snapshot a small, identity-free slice
// of the server-synced `body.user` (currencies, progression, rates, castle, loadout)
// onto each run, so the viewer can compare runs and show deltas.

export function installSessionHistory(runtime) {
    if (typeof window === "undefined" || window.__EF_SESSION_HISTORY_INSTALLED__) {
        return { detach: function () {} };
    }
    window.__EF_SESSION_HISTORY_INSTALLED__ = true;

    var STORAGE_KEY = "__EF_SESSION_HISTORY__";
    var SAMPLE_GLOBAL = "__EF_WAVE_SAMPLE__";
    var MEDAL_BUFF_KEY = "__EF_WAVE_TRACKER_MEDAL_BUFF_PERCENT__"; // the Wave Tracker's medal-buff input
    var SCHEMA_VERSION = 1;

    var DEFAULTS = {
        pollIntervalMs: 1000,      // check the published sample at most this often
        sampleIntervalMs: 2000,    // record at most one point every 2s
        persistIntervalMs: 15000,  // flush to localStorage at most this often
        maxRuns: 30,               // keep the most recent N runs
        maxSamplesPerRun: 600,     // decimate older points past this to stay quota-safe
        rebirthResetSlackSec: 5    // rebirthTime dropping by more than this starts a run
    };
    var config = Object.assign({}, DEFAULTS, window.__EF_SESSION_HISTORY_CONFIG__ || {});

    function nowMono() {
        return (window.performance && typeof performance.now === "function") ? performance.now() : Date.now();
    }
    function num(value) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    function round(value, decimals) {
        if (decimals === undefined) { decimals = 2; }
        var parsed = num(value);
        if (!Number.isFinite(parsed)) { return null; }
        var factor = Math.pow(10, decimals);
        return Math.round(parsed * factor) / factor;
    }

    // Drop every other sample, keeping the first and last, to halve resolution
    // while preserving the overall shape of a long run.
    function decimate(samples) {
        if (samples.length < 3) { return samples; }
        var kept = [];
        for (var i = 0; i < samples.length; i += 1) {
            if (i % 2 === 0 || i === samples.length - 1) { kept.push(samples[i]); }
        }
        return kept;
    }

    function loadStore() {
        try {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.runs)) {
                    return parsed;
                }
            }
        } catch (error) {
            // Corrupt or unavailable storage falls back to a fresh store.
        }
        return { version: SCHEMA_VERSION, runs: [] };
    }

    // The medal-buff % the Wave Tracker has stored (integer >= 0), or null if unset.
    function readMedalPct() {
        try {
            var p = parseInt(window.localStorage.getItem(MEDAL_BUFF_KEY) || "", 10);
            return (Number.isFinite(p) && p >= 0) ? p : null;
        } catch (e) { return null; }
    }

    var store = loadStore();
    var currentRun = store.runs[store.runs.length - 1] || null;
    var pendingCtx = null; // next run's snapshot, built from revive-payload(s) before startRun materialises that run
    var lastSampleAt = 0;
    var lastPersistAt = 0;
    var lastRebirthTimeSec = currentRun ? num(currentRun.lastRebirthTimeSec) : NaN;
    var nextRunId = store.runs.reduce(function (max, run) { return Math.max(max, num(run.id) || 0); }, 0) + 1;

    // Before writing, adopt edits made externally (in the viewer) so our in-memory copy
    // doesn't clobber them: `medalPct` (a correction) for past runs, and the viewer-only
    // `name` / `notes` for ALL runs (the recorder never sets those, so even the run being
    // actively recorded should keep a name/note the user just typed).
    function clampStr(v, max) {
        return (typeof v === "string" && v.length) ? v.slice(0, max) : null;
    }
    function mergeExternalEdits() {
        try {
            var ext = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
            if (!ext || !Array.isArray(ext.runs)) { return; }
            var byId = {};
            for (var i = 0; i < ext.runs.length; i++) { byId[ext.runs[i].id] = ext.runs[i]; }
            for (var j = 0; j < store.runs.length; j++) {
                var r = store.runs[j];
                var e = byId[r.id];
                if (!e) { continue; }
                var nm = clampStr(e.name, 80);
                if (nm) { r.name = nm; } else { delete r.name; }
                var nt = clampStr(e.notes, 2000);
                if (nt) { r.notes = nt; } else { delete r.notes; }
                if (currentRun && r.id === currentRun.id) { continue; } // its medalPct comes from readMedalPct()
                var ep = parseInt(e.medalPct, 10);
                r.medalPct = (Number.isFinite(ep) && ep >= 0) ? ep : null;
            }
        } catch (err) {}
    }

    function persist(now, force) {
        if (!force && now - lastPersistAt < config.persistIntervalMs) { return; }
        lastPersistAt = now;
        mergeExternalEdits();
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (error) {
            // If we hit the quota, drop the oldest run and try once more.
            if (store.runs.length > 1) {
                store.runs.shift();
                try {
                    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
                } catch (retryError) {
                    // Give up silently; recording must never break gameplay.
                }
            }
        }
        window.__EF_SESSION_HISTORY_DATA__ = store;
    }

    function startRun(state, nowWallMs) {
        var run = {
            id: nextRunId,
            startedAtWall: nowWallMs,
            bundleVersion: window.appBundleVersion || "unknown",
            startWave: Number.isFinite(num(state.wave)) ? Math.floor(num(state.wave)) : null,
            peakWave: null,
            bestMpm: null,
            lastRebirthTimeSec: num(state.rebirthTimeSec),
            medalPct: readMedalPct(),
            // Adopt the snapshot the observer has been building for this new run from the revive
            // payload (per-run levels reset, persistent fields carried). If none was captured
            // (e.g. a reload, not a revive), start empty and let the next sync seed it.
            ctx: pendingCtx,
            samples: []
        };
        pendingCtx = null;
        nextRunId += 1;
        store.runs.push(run);
        while (store.runs.length > config.maxRuns) { store.runs.shift(); }
        currentRun = run;
        return run;
    }

    function record(state) {
        if (!state || typeof state !== "object") { return; }

        var now = nowMono();
        var nowWallMs = Date.now();
        var rebirthTimeSec = num(state.rebirthTimeSec);

        // Detect a rebirth: the run clock jumped backwards.
        var isNewRun = !currentRun
            || (Number.isFinite(rebirthTimeSec)
                && Number.isFinite(lastRebirthTimeSec)
                && rebirthTimeSec + config.rebirthResetSlackSec < lastRebirthTimeSec);

        if (Number.isFinite(rebirthTimeSec)) { lastRebirthTimeSec = rebirthTimeSec; }

        if (isNewRun) {
            // The ending run already keeps its own end-of-run context: the revive payload that
            // resets unit/castle gold levels and bumps numRevive is recognised in captureCtx (by
            // the numRevive jump) and routed to pendingCtx, never the ending run. startRun adopts
            // pendingCtx as the new run's snapshot, so we don't touch the ending run's ctx here.
            startRun(state, nowWallMs);
            lastSampleAt = 0; // force an immediate first sample for the new run
        }

        // Time-throttle within a run.
        if (lastSampleAt && now - lastSampleAt < config.sampleIntervalMs) { return; }
        lastSampleAt = now;

        var wave = num(state.wave);
        var mpm = num(state.currentMpm);
        var sample = {
            t: round(rebirthTimeSec, 1), // x-axis: seconds since rebirth
            wall: nowWallMs,
            wave: Number.isFinite(wave) ? Math.floor(wave) : null,
            maxWave: Number.isFinite(num(state.maxWave)) ? Math.floor(num(state.maxWave)) : null,
            mpm: round(mpm),
            bestMpm: round(state.bestMpm),
            wpm: state.wpmReady ? round(state.wpm) : null,
            waveSec: round(state.waveTimeSec),
            done: Number.isFinite(num(state.completedWaves)) ? Math.floor(num(state.completedWaves)) : null,
            skip: Number.isFinite(num(state.skippedWaves)) ? Math.floor(num(state.skippedWaves)) : null,
            rec: state.recommendation || null,
            bt: Number.isFinite(num(state.battleTime)) ? Math.floor(num(state.battleTime)) : null // in-game frame counter; viewer derives game speed
        };

        currentRun.samples.push(sample);
        currentRun.lastRebirthTimeSec = lastRebirthTimeSec;
        if (Number.isFinite(wave)) {
            currentRun.peakWave = Math.max(num(currentRun.peakWave) || 0, Math.floor(wave));
        }
        if (Number.isFinite(mpm)) {
            currentRun.bestMpm = Math.max(num(currentRun.bestMpm) || 0, mpm);
        }

        if (currentRun.samples.length > config.maxSamplesPerRun) {
            currentRun.samples = decimate(currentRun.samples);
        }

        var mp = readMedalPct();
        if (mp != null) { currentRun.medalPct = mp; }

        persist(now);
    }

    window.__EF_SESSION_HISTORY_DATA__ = store;

    // --- read-only run context from the server-synced body.user --------------------
    // The same payload the Wave Tracker reads through JSON.parse. We snapshot a
    // curated, identity-free subset (currencies, progression, rates, castle, loadout)
    // onto the current run so the viewer can compare runs and show deltas. Strictly
    // read-only: we observe JSON.parse's result, never alter it, never send anything.
    // Identity fields (userId/name/uid/accountId/guildId) are NOT in the allowlist.
    // long-term progression only — spendable currencies (gold/goldPerSec/gem/redGem/
    // honorCoin/current medals) are deliberately NOT tracked: they fluctuate with
    // spending and aren't meaningful run-to-run. accuMedal (lifetime) + bestMedalPerMin
    // are kept as monotonic long-term metrics, not balances.
    // --- FIELD MODEL (verified against the game bundle) -----------------------------------
    // Run-context fields fall into three classes, each captured differently:
    //   PERSISTENT (account-level, never reset at rebirth; monotonic): accuMedal, maxWave,
    //     accuWave, bestMedalPerMin, tribe, maxTeamSlots, numRevive, lastReviveStartWave,
    //     activeSkills, castle `enhance`, castle MEDAL levels (`specialLevels[]`), and each
    //     unit's medal `enhance` + `trans`.  -> take the LATEST server value.
    //   PER-RUN (reset to 0 / Lv1 each rebirth by the game's resetCastleGoldInfo()/resetLevel(),
    //     then re-bought during the run): each unit's GOLD level (`team[].level`) and the
    //     castle GOLD levels (`levels[]`).  -> keep the running MAX within the run (a peak); the
    //     game debounces these ~3s and the carrying bodies are sparse, so a lagging/partial sync
    //     must never shrink the captured peak. (That peak is the value the server was TOLD about
    //     — a lower bound on the true peak, since a rebirth inside the 3s debounce drops the
    //     pending upload.)
    //   BOUNDARY: numRevive. The revive that starts the next run bumps it and, in the SAME body,
    //     resets the per-run levels. That body arrives ~1s before the Wave Tracker's rebirth
    //     clock drops, so it's routed to the NEXT run's snapshot, never the run that just ended.
    // `wave` (current wave) is intentionally NOT captured — it resets at the boundary (so it'd be
    // wrong-attributed) and is already in the per-sample data.
    var CTX_NUM = ["accuMedal", "maxWave", "accuWave", "numRevive",
        "lastReviveStartWave", "bestMedalPerMin", "tribe", "maxTeamSlots"];
    var CTX_STR = ["activeSkills"];   // pets intentionally excluded (different game mode)
    // A per-run snapshot. Deep-copies the one nested field (`team`) so a completed
    // run's roster can never be mutated by a later live capture — each run is frozen.
    function cloneCtx(c) {
        if (!c) { return c; }
        var o = {};
        for (var k in c) {
            if (!Object.prototype.hasOwnProperty.call(c, k)) { continue; }
            o[k] = (k === "team" && Array.isArray(c[k]))
                ? c[k].map(function (u) { return { kind: u.kind, lvl: u.lvl, enh: u.enh, tr: u.tr }; })
                : c[k];
        }
        return o;
    }
    var lastCtxPersistAt = 0;
    // a signature of the slow-changing structural fields (castle + roster) so we can
    // save those promptly while leaving fast currency churn on the normal throttle.
    function ctxStructSig(c) {
        if (!c) { return ""; }
        var t = c.team ? c.team.map(function (u) { return u.kind + ":" + u.lvl + ":" + u.enh + ":" + u.tr; }).join(",") : "";
        return [c.castleEnhance, c.castleGoldSum, c.castleMedalSum].join("/") + "/" + t;
    }
    function sumArray(a) {
        if (!Array.isArray(a) || !a.length) { return null; }
        var s = 0;
        for (var i = 0; i < a.length; i++) {
            var v = Number(a[i]);
            if (!Number.isFinite(v)) { return null; }
            s += v;
        }
        return s;
    }
    // Merge a parsed body's allowlisted, identity-free fields into a run snapshot `ctx`, per the
    // FIELD MODEL above, and return it. `seed` = true when this body STARTS a fresh run snapshot:
    // the post-rebirth reset values are taken as-is so the new run begins at its true Lv1/0
    // baseline; otherwise per-run gold levels take the running MAX. Persistent fields always take
    // the latest; fields ABSENT from this body are carried forward untouched. Scalars live at
    // body.user; the roster + castle are SIBLINGS at body.hero / body.castle (body.user.* is a
    // fallback for older shapes).
    function mergeCtx(ctx, body, seed) {
        if (!ctx) { ctx = {}; }
        var user = (body.user && typeof body.user === "object") ? body.user : null;
        var castle = body.castle || (user && user.castle);
        var hero = body.hero || (user && user.hero);
        if (user) {
            for (var i = 0; i < CTX_NUM.length; i++) {
                var n = Number(user[CTX_NUM[i]]);
                if (Number.isFinite(n)) { ctx[CTX_NUM[i]] = n; }
            }
            for (var j = 0; j < CTX_STR.length; j++) {
                if (typeof user[CTX_STR[j]] === "string") { ctx[CTX_STR[j]] = user[CTX_STR[j]]; }
            }
        }
        if (castle && typeof castle === "object") {
            var ce = Number(castle.enhance);
            if (Number.isFinite(ce) && ce > 0) { ctx.castleEnhance = ce; }            // persistent (medal enhancement)
            var gold = sumArray(castle.levels);                                       // GOLD levels -> per-run peak
            if (gold != null) {
                ctx.castleGoldSum = seed ? gold : Math.max(Number(ctx.castleGoldSum) || 0, gold);
            }
            var medal = sumArray(castle.specialLevels);                               // MEDAL levels -> persistent
            if (medal != null) { ctx.castleMedalSum = medal; }
        }
        if (hero && Array.isArray(hero.team)) {                                       // the deployed unit roster
            var prevLvl = {};
            if (!seed && Array.isArray(ctx.team)) {
                for (var p = 0; p < ctx.team.length; p++) { prevLvl[ctx.team[p].kind] = ctx.team[p].lvl; }
            }
            var team = [];
            for (var h = 0; h < hero.team.length; h++) {
                var m = hero.team[h];
                if (m && typeof m === "object" && Number.isFinite(Number(m.kindNum))) {
                    var kind = Number(m.kindNum);
                    var lvl = Number(m.level) || 0;                                   // gold level -> per-run peak
                    var pk = prevLvl[kind];                                           // keep this run's max if higher
                    if (Number.isFinite(pk) && pk > lvl) { lvl = pk; }
                    team.push({ kind: kind, lvl: lvl, enh: Number(m.enhance) || 0, tr: Number(m.trans) || 0 });
                }
            }
            if (team.length) { ctx.team = team; }                                     // drop instance id; keep comparables
        }
        return ctx;
    }
    // Does this body carry any allowlisted run-context data at all?
    function bodyHasCtx(body) {
        if (!body || typeof body !== "object") { return false; }
        var user = (body.user && typeof body.user === "object") ? body.user : null;
        return !!(user || body.castle || body.hero || (user && (user.castle || user.hero)));
    }
    // Read-only observer of JSON.parse'd server responses. Routes each body to the right run
    // snapshot, with the run BOUNDARY driven by numRevive (the only reliable boundary signal).
    // A finished run's snapshot is frozen the instant numRevive jumps and is never overwritten:
    // the revive body (reset levels + bumped numRevive) is built into `pendingCtx` — the NEXT
    // run's snapshot — which startRun adopts when it materialises that run a moment later.
    function captureCtx(body) {
        if (!bodyHasCtx(body)) { return; }
        var user = (body.user && typeof body.user === "object") ? body.user : null;
        var incomingRev = user ? Number(user.numRevive) : NaN;
        var runRev = (currentRun && currentRun.ctx) ? Number(currentRun.ctx.numRevive) : NaN;
        var isRevive = Number.isFinite(incomingRev) && Number.isFinite(runRev) && incomingRev > runRev;

        if (isRevive || !currentRun) {
            // Next run's snapshot (revive payload, or buffering before the very first run).
            // Seed it the first time; merge later bodies of that same not-yet-started run.
            pendingCtx = mergeCtx(pendingCtx, body, pendingCtx == null);
            return;
        }

        var beforeSig = ctxStructSig(currentRun.ctx);
        currentRun.ctx = mergeCtx(currentRun.ctx, body, currentRun.ctx == null);
        currentRun.ctx.at = Date.now();
        // Persist so context changes made OUTSIDE battle (e.g. a castle upgrade in the menu)
        // reach the viewer, not just on the next recorded sample. Structural changes (castle /
        // roster) save promptly — capped to once per 2s so bulk upgrades can't thrash
        // localStorage; fast currency churn uses the normal throttle.
        var nowM = nowMono();
        if (ctxStructSig(currentRun.ctx) !== beforeSig && nowM - lastCtxPersistAt > 2000) {
            lastCtxPersistAt = nowM;
            persist(nowM, true);
        } else {
            persist(nowM);
        }
    }
    // Run-context capture via the runtime's sanctioned JSON.parse hook (the runtime owns the
    // single JSON.parse wrap — plugins must not patch it directly).
    var unobserveParse = (runtime && runtime.hooks && typeof runtime.hooks.onJsonParse === "function")
        ? runtime.hooks.onJsonParse(function (parsed) {
            try {
                if (parsed && parsed.body) { captureCtx(parsed.body); }
            } catch (error) {
                // Context capture must never break the game's parsing.
            }
        })
        : function () {};

    // --- self-running loop: pull the published sample, never get pushed to. ---
    // The tracker reassigns __EF_WAVE_SAMPLE__ to a fresh object every loop, so a
    // reference check both de-dups and detects "the game stopped publishing".
    var lastSeen = null;
    function pollOnce() {
        try {
            var s = window[SAMPLE_GLOBAL];
            if (s && s !== lastSeen) { lastSeen = s; record(s); }
        } catch (error) {
            // Recording must never break gameplay.
        }
    }
    function flush() { persist(nowMono(), true); }

    // Expose a manual tick for tests/diagnostics; harmless in production.
    window.__EF_SESSION_HISTORY_TICK__ = pollOnce;

    var pollTimer = (typeof setInterval === "function") ? setInterval(pollOnce, config.pollIntervalMs) : null;
    // Preferred path: if the Wave Tracker plugin emits a per-loop sample as a runtime event,
    // record it directly. Falls back to the __EF_WAVE_SAMPLE__ poll above (the existing one-line
    // publish). See the plugin README for wiring the wave-tracker.
    var unsubscribeSample = (runtime && runtime.events && typeof runtime.events.on === "function")
        ? runtime.events.on("wave:sample", function (sample) { try { if (sample) { record(sample); } } catch (error) {} })
        : function () {};
    // Persist promptly when the page is hidden or closed (replaces an explicit flush).
    function onVisibilityChange() { if (document.visibilityState === "hidden") { flush(); } }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window.addEventListener === "function") {
        window.addEventListener("pagehide", flush);
        window.addEventListener("beforeunload", flush);
    }

    return {
        detach: function () {
            if (pollTimer) { clearInterval(pollTimer); }
            unsubscribeSample();
            if (typeof unobserveParse === "function") { unobserveParse(); }
            if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
                document.removeEventListener("visibilitychange", onVisibilityChange);
            }
            if (typeof window.removeEventListener === "function") {
                window.removeEventListener("pagehide", flush);
                window.removeEventListener("beforeunload", flush);
            }
            flush();
            window.__EF_SESSION_HISTORY_INSTALLED__ = false;
        }
    };
}
