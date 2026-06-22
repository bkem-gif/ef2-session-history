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

(function () {
    if (typeof window === "undefined" || window.__EF_SESSION_HISTORY_INSTALLED__) {
        return;
    }
    window.__EF_SESSION_HISTORY_INSTALLED__ = true;

    var STORAGE_KEY = "__EF_SESSION_HISTORY__";
    var SAMPLE_GLOBAL = "__EF_WAVE_SAMPLE__";
    var SCHEMA_VERSION = 1;

    var DEFAULTS = {
        pollIntervalMs: 1000,      // check the published sample at most this often
        sampleIntervalMs: 10000,   // record at most one point every 10s
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

    var store = loadStore();
    var currentRun = store.runs[store.runs.length - 1] || null;
    var lastSampleAt = 0;
    var lastPersistAt = 0;
    var lastRebirthTimeSec = currentRun ? num(currentRun.lastRebirthTimeSec) : NaN;
    var nextRunId = store.runs.reduce(function (max, run) { return Math.max(max, num(run.id) || 0); }, 0) + 1;

    function persist(now, force) {
        if (!force && now - lastPersistAt < config.persistIntervalMs) { return; }
        lastPersistAt = now;
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
            samples: []
        };
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
            rec: state.recommendation || null
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

        persist(now);
    }

    window.__EF_SESSION_HISTORY_DATA__ = store;

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

    if (typeof setInterval === "function") {
        setInterval(pollOnce, config.pollIntervalMs);
    }
    // Persist promptly when the page is hidden or closed (replaces an explicit flush).
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "hidden") { flush(); }
        });
    }
    if (typeof window.addEventListener === "function") {
        window.addEventListener("pagehide", flush);
        window.addEventListener("beforeunload", flush);
    }
})();
