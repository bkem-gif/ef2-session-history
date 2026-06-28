// Shared record-run derivation for the session-history plugin.
//
// The recorder (cleanup protection) and the viewer (trophy tags / strip / ghost) must agree on
// which runs are records — a past divergence here silently lost trophies or protected the wrong
// run. This is the ONE canonical implementation both import.

// A run's medal-buff % — only a valid NON-NEGATIVE INTEGER counts, else null. (Integer guard is
// canonical: a fractional medalPct can only arrive via a manual localStorage edit, and the
// surfaces must treat it identically.)
export function pctOf(run) {
    const v = run ? run.medalPct : undefined;
    if (v === null || v === undefined || v === "") { return null; }
    const p = Number(v);
    return (Number.isInteger(p) && p >= 0) ? p : null;
}

// Effective medals/min multiplier for a run (1 when there's no valid buff).
export function medalMult(run) {
    const p = pctOf(run);
    return p != null ? 1 + p / 100 : 1;
}

// Derive the record-setting runs from history: a run is a record when its corrected peak
// (bestMpm × medalMult) beats every earlier run's. Newest (= highest) first, capped at
// maxRecords. If the server's all-time best (account.bestMedalPerMin) clearly exceeds the best
// local run — e.g. a record set on another device — it leads the list UNATTRIBUTED (runId null).
// Pure: returns a new array, never mutates its inputs.
export function deriveRecords(runs, account, maxRecords = 5) {
    const sorted = (runs || []).slice().sort((a, b) => (a.startedAtWall || a.id || 0) - (b.startedAtWall || b.id || 0));
    let max = 0;
    const recs = [];
    for (const r of sorted) {
        const peak = Number(r.bestMpm) * medalMult(r);
        if (Number.isFinite(peak) && peak > max) { max = peak; recs.push({ runId: r.id, mpm: peak, at: r.startedAtWall || null }); }
    }
    recs.reverse();   // newest (= highest) first
    const server = (account && Number(account.bestMedalPerMin) > 0) ? Number(account.bestMedalPerMin) : NaN;
    if (Number.isFinite(server) && (!recs.length || server > recs[0].mpm * 1.05)) {
        recs.unshift({ runId: null, mpm: server, at: (account && account.bestMedalPerMinAt) || null });
    }
    return recs.slice(0, maxRecords);
}

// Rank of a run among the record list (1 = current/highest, 2.. = previous), else 0.
export function recordRankOf(records, runId) {
    if (runId == null || !Array.isArray(records)) { return 0; }
    const i = records.findIndex(e => e && e.runId === runId);
    return i < 0 ? 0 : i + 1;
}
