// Pure helpers for the session-history viewer (history.html imports these).
// Extracted so the chart-axis math and the Divine Blessing (game-speed/buff) inference can be
// unit-tested directly. No DOM, no module state — pure functions of their arguments.

// Short "Mon D" date label; falsy / epoch-0 -> blank (not a 1970 label).
export function fmtShortDate(at) {
    if (at == null || at === 0) { return ""; }
    try { const d = new Date(at); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
    catch (e) { return ""; }
}

// Round a y-axis max up to a clean 1/2/5 × 10ⁿ ceiling.
export function niceCeil(value) {
    if (value <= 0) { return 1; }
    const exp = Math.floor(Math.log10(value));
    const base = 10 ** exp;
    const frac = value / base;
    const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
    return nice * base;
}

// The x-axis (rebirth time) needs a TIGHTER ceiling than the y-axes. niceCeil's coarse 1/2/5
// steps stretch a ~205-min run all the way to 500 (frac 2.05 -> 5), wasting more than half the
// width. Round up to a fine, clean minute step instead, leaving a little headroom.
export function niceCeilTime(value) {
    if (value <= 0) { return 1; }
    const base = 10 ** Math.floor(Math.log10(value));   // 1, 10, 100 …
    const step = base / 5;                               // fine sub-tick: 0.2, 2, 20 …
    return Math.ceil((value * 1.05) / step) * step;      // ~5% headroom, snapped up to the step
}

// null / "" / missing -> NaN, so a not-yet-measured value is a gap on the line and "-" in the
// tooltip, never a real 0.
export function metricVal(v) {
    return (v === null || v === undefined || v === "") ? NaN : Number(v);
}

// ---------- Divine Blessing (priest +3 speed buff) inference ----------
// We can't read the game's buff timer (closure-private, tamper-sealed), but the in-game frame
// counter `bt` advances +1 per 60 fps logic tick, and the game runs those ticks faster at higher
// game speed. So the speed multiplier is gameSpeed ≈ Δframes / (60 × ΔwallSeconds). Divine
// Blessing adds a discrete +3 for 120 s, so an unusually-LOW speed plateau = buff down.
export function btOf(s) {
    const v = s ? s.bt : undefined;
    if (v === null || v === undefined || v === "") { return null; }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

const RELOAD_GAP_SEC = 20;   // a frame-counter reset across a wall gap this big = a reload (vs a stage change)
const MAX_GAP_SEC = 300;     // ignore derived speed across very long idle / offline gaps

// Per-interval game-speed multiplier between consecutive samples. Intervals spanning a battle
// reset (frame counter drops), a too-short gap, or an implausible rate are dropped. x0/x1 are
// rebirth-time minutes (the chart's x units).
export function deriveSpeedIntervals(samples) {
    const out = [];
    let pendingReload = false;
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i];
        const bt0 = btOf(a), bt1 = btOf(b);
        if (bt0 === null || bt1 === null) { continue; }
        const dframes = bt1 - bt0;
        const dwall = (Number(b.wall) - Number(a.wall)) / 1000;
        if (!(dframes >= 0)) {                                   // frame counter reset
            if (dwall > RELOAD_GAP_SEC) { pendingReload = true; }  // ...across a gap = a reload (Divine Blessing resets)
            continue;
        }
        if (!(dwall > 0.5) || dwall > MAX_GAP_SEC) { continue; }   // bad / long-gap interval
        const speed = dframes / (60 * dwall);
        if (!Number.isFinite(speed) || speed > 100) { continue; }  // clock jump etc.
        out.push({ x0: (Number(a.t) || 0) / 60, x1: (Number(b.t) || 0) / 60, speed, afterReload: pendingReload });
        pendingReload = false;
    }
    return out;
}

const BATTLE_SPEED_FLOOR = 0.5;   // below this = not in an active battle (menu/idle)
const MIN_PLATEAU_GAP = 2;        // the +3 buff must show at least this much spread

// Classify in-battle intervals as buff-up vs buff-down by splitting the two speed plateaus (which
// sit ~3 apart) at a drift-aware local floor, smoothing single-sample flicker, then merging
// contiguous down intervals into spans. Returns ok:false when there's no `bt` data or the buff
// state doesn't visibly vary (draw nothing rather than guess).
export function detectBuffDown(intervals) {
    const battle = intervals.filter(iv => iv.speed >= BATTLE_SPEED_FLOOR);
    if (battle.length < 4) { return { ok: false, spans: [] }; }
    const sorted = battle.map(iv => iv.speed).slice().sort((a, b) => a - b);
    const pct = q => sorted[Math.max(0, Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1))))];
    const lo = pct(0.20), hi = pct(0.80);
    if (hi - lo < MIN_PLATEAU_GAP) { return { ok: false, spans: [] }; }
    const thresh = lo + (hi - lo) / 2;
    const sp = battle.map(iv => iv.speed);
    // Drift-aware split: classify each interval against a LOCAL floor — the min over a window
    // spanning a buff cycle — so the boundary follows the moving baseline. Where the window sees
    // only one plateau, fall back to the global threshold so a one-sided window never invents a down.
    const W = 9; // ±9 intervals (~3 min at 10s/sample) — wide enough to span a cycle
    const raw = sp.map((v, i) => {
        let mn = Infinity, mx = -Infinity;
        for (let j = Math.max(0, i - W); j <= Math.min(sp.length - 1, i + W); j++) {
            if (sp[j] < mn) { mn = sp[j]; }
            if (sp[j] > mx) { mx = sp[j]; }
        }
        return (mx - mn >= MIN_PLATEAU_GAP) ? v < mn + MIN_PLATEAU_GAP / 2 : v < thresh;
    });
    // median-of-3 smoothing kills single-sample flicker
    const down = raw.map((v, i) => {
        const a = i > 0 ? raw[i - 1] : v, c = i < raw.length - 1 ? raw[i + 1] : v;
        return (a ? 1 : 0) + (v ? 1 : 0) + (c ? 1 : 0) >= 2;
    });
    // After a reload, Divine Blessing resets — don't flag the initial unbuffed stretch until the
    // buff is seen UP again. Stage changes keep the timer, so only reloads count.
    let suppressing = false;
    for (let i = 0; i < battle.length; i++) {
        if (battle[i].afterReload) { suppressing = true; }
        if (!down[i]) { suppressing = false; }        // buff seen up -> resume flagging real lapses
        else if (suppressing) { down[i] = false; }    // suppress the post-reload leading-down
    }
    // merge contiguous down intervals into spans, but don't bridge a time gap
    const spans = [];
    const EPS = 0.05; // minutes (~3 s) tolerance for "adjacent"
    for (let i = 0; i < battle.length; i++) {
        if (!down[i]) { continue; }
        const start = battle[i].x0;
        let end = battle[i].x1;
        while (i + 1 < battle.length && down[i + 1] && Math.abs(battle[i + 1].x0 - end) <= EPS) { i++; end = battle[i].x1; }
        spans.push({ x0: start, x1: end });
    }
    return { ok: true, spans, thresh };
}

// Is a rebirth-minute inside any down span? (1e-9 endpoint tolerance.)
export function inAnySpan(xMin, spans) {
    for (const sp of spans) { if (xMin >= sp.x0 - 1e-9 && xMin <= sp.x1 + 1e-9) { return true; } }
    return false;
}
