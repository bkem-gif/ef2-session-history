// Shared number formatting for the session-history plugin (recorder/overlay/viewer).
// Single source of truth so the surfaces never drift on how a medals value renders.

// 1e3 = A, 1e6 = B, 1e9 = C, … (matches the game's large-number alphabet).
export function tierLetters(n) {
    let s = "";
    while (n > 0) { n -= 1; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
}

// Compact medals: 1500 -> "1.5A", 6.5e9 -> "6.5C". Non-finite -> "—". Sign-safe for negatives.
export function fmtMedals(v) {
    if (!Number.isFinite(v)) { return "—"; }
    const neg = v < 0;
    let scaled = Math.abs(v), tier = 0;
    while (scaled >= 1000) { scaled /= 1000; tier += 1; }
    let r = Math.round(scaled * 100) / 100;
    if (r >= 1000) { r /= 1000; tier += 1; }   // rounding/float drift pushed it into the next tier
    const body = tier === 0 ? String(r) : (parseFloat(r.toFixed(2)) + tierLetters(tier));
    return (neg ? "-" : "") + body;
}
