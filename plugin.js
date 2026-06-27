/*
 * Session History — runtime plugin.
 *
 * Read-only session recorder (the user's existing recorder, ported from the old
 * wave-tracker addon). It segments play into runs (one per rebirth), records a
 * downsampled wave/MPM time series, and snapshots an identity-free slice of the
 * server-synced `body.user/hero/castle` per run. Persists to localStorage
 * `__EF_SESSION_HISTORY__`; the bundled viewer reads the same key.
 *
 * Two data sources (see recorder.js):
 *   - Run context: `runtime.hooks.onJsonParse` (sanctioned, replaces the old direct
 *     JSON.parse patch) — fully self-contained, needs nothing from the wave-tracker.
 *   - Per-loop sample series: polls `window.__EF_WAVE_SAMPLE__` AND listens for a
 *     `wave:sample` runtime event. The Wave Tracker publishes neither by default, so
 *     the time-series needs ONE line added to the wave-tracker plugin (see README):
 *       window.__EF_WAVE_SAMPLE__ = { wave, maxWave, currentMpm, rebirthTimeSec, ... };
 *     or, preferred:  runtime.events.emit("wave:sample", sample);
 *   The run-context capture works regardless.
 *
 * Viewer: open  /__ef_plugins__/session-history/history.html  (served same-origin, so
 * it reads the recorder's localStorage). Read-only throughout: never sends a move.
 */
import { installSessionHistory } from "./recorder.js";
import { installSessionOverlay } from "./overlay.js";

export default {
    id: "session-history",
    handleKey: "__EF_SESSION_HISTORY_HANDLE__",

    setup(runtime) {
        const handle = installSessionHistory(runtime);
        const overlay = installSessionOverlay(runtime);   // in-game MPM record HUD (data-ef-plugin-overlay)
        runtime.logger.info(
            "session-history",
            "recorder + MPM record overlay installed — viewer at /__ef_plugins__/session-history/history.html"
        );

        return {
            detach() {
                if (handle && typeof handle.detach === "function") { handle.detach(); }
                if (overlay && typeof overlay.detach === "function") { overlay.detach(); }
            }
        };
    }
};
