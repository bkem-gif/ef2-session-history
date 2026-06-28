/*
 * EF2 Session History — in-game "MPM Record" overlay.
 *
 * A small, draggable, transparent HUD that shows your all-time Soul Rest record
 * (bestMedalPerMin — the value idle income is paid on), your LIVE medals/min versus it,
 * a caution to swap to your medal relics, and an "ABOVE RECORD +X%" status with a green glow
 * the moment your live rate beats the record (a pure comparison — no projection).
 *
 * Data is read-only: live medals/min from the Wave Tracker's `wave:sample` event (corrected by the
 * Wave Tracker's medal-buff %, exactly as the viewer does), and the
 * record from the recorder's captured account (window.__EF_SESSION_HISTORY_ACCOUNT__, with the
 * persisted store as a fallback). It honours the viewer's settings (shared localStorage key) and
 * the runtime's per-plugin hide/show (data-ef-plugin-overlay). It never sends a move.
 */
import { fmtMedals } from "./shared/format.js";

export function installSessionOverlay(runtime) {
    const ID = "ef-session-record-overlay";
    const SETTINGS_KEY = "__EF_SESSION_HISTORY_SETTINGS__";
    const STORE_KEY = "__EF_SESSION_HISTORY__";
    const POS_KEY = "__EF_SESSION_OVERLAY_POS__";
    const MEDAL_BUFF_KEY = "__EF_WAVE_TRACKER_MEDAL_BUFF_PERCENT__";   // the Wave Tracker's medal-buff % input
    // fmtMedals (1e3=A, 1e6=B, …) is shared with the viewer — see shared/format.js

    // settings — shared with the viewer; each feature ON unless explicitly disabled
    function readSettings() { try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); return (s && typeof s === "object") ? s : {}; } catch (e) { return {}; } }
    let settings = readSettings();
    function feat(key) { return settings[key] !== false; }   // default ON

    // the record (bestMedalPerMin) — recorder's live account first, then the persisted store
    function readRecord() {
        try { const a = window.__EF_SESSION_HISTORY_ACCOUNT__; if (a && Number(a.bestMedalPerMin) > 0) return Number(a.bestMedalPerMin); } catch (e) {}
        try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); if (s && s.account && Number(s.account.bestMedalPerMin) > 0) return Number(s.account.bestMedalPerMin); } catch (e) {}
        return NaN;
    }

    // The Wave Tracker's medal-buff %, same correction the viewer applies. The live sample's
    // currentMpm is the BASE rate; multiply by (1 + pct/100) to match the server record
    // (bestMedalPerMin), which already reflects the buff. Record stays raw — mirrors the viewer.
    function readMedalMult() {
        try { const p = parseInt(localStorage.getItem(MEDAL_BUFF_KEY) || "", 10); return (Number.isFinite(p) && p >= 0) ? 1 + p / 100 : 1; } catch (e) { return 1; }
    }

    let liveMpmRaw = NaN, record = readRecord();
    let reviveEpochMs = NaN, lastSampleWallMs = 0, cdTimer = null;   // wall-clock anchor for the :59 revive countdown

    function el(tag, css, html) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
    let panel = null, body = null, minimized = false;

    function ensureStyle() {
        if (document.getElementById(ID + "-style")) return;
        const s = document.createElement("style"); s.id = ID + "-style";
        s.textContent =
            "#" + ID + "{position:fixed;bottom:8px;right:8px;z-index:2147483646;box-sizing:border-box;width:194px;padding:9px 11px;border-radius:10px;border:1px solid rgba(255,224,138,.35);background:rgba(18,16,12,.88);color:#f4ecd8;font:12px/1.3 -apple-system,system-ui,sans-serif;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);user-select:none;transition:border-color .25s,box-shadow .25s}" +
            "#" + ID + ".above{border-color:rgba(150,255,180,.9)}" +
            "#" + ID + ".above.pulse{animation:efsrglow 1.15s ease-in-out infinite}" +
            "@keyframes efsrglow{0%,100%{box-shadow:0 0 10px 1px rgba(120,255,160,.35)}50%{box-shadow:0 0 22px 5px rgba(120,255,160,.8)}}" +
            "#" + ID + " .hd{display:flex;align-items:center;gap:6px;font-weight:700;font-size:10px;letter-spacing:.07em;opacity:.8;margin-bottom:4px}" +
            "#" + ID + " .x{cursor:pointer;opacity:.55;font-size:14px;line-height:1;padding:0 2px}#" + ID + " .x:hover{opacity:1}" +
            "#" + ID + " .rec{font-size:23px;font-weight:800;color:#ffe08a;line-height:1.05}" +
            "#" + ID + " .relic{font-size:10px;color:#e8c266;margin-top:8px;text-align:center}" +
            "#" + ID + " .now{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;gap:6px}" +
            "#" + ID + " .now b{font-weight:700;color:#f4ecd8}" +
            "#" + ID + " .pct{opacity:.7}" +
            "#" + ID + " .bar{height:5px;border-radius:3px;background:rgba(255,255,255,.10);margin-top:5px;overflow:hidden}" +
            "#" + ID + " .fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#ffd27a,#ffe08a);transition:width .25s}" +
            "#" + ID + ".above .rec{color:#aaffc4}#" + ID + ".above .fill{background:linear-gradient(90deg,#6bffa0,#aaffc4)}" +
            "#" + ID + " .abv{margin-top:7px;font-weight:800;font-size:12px;color:#aaffc4;text-align:center;text-shadow:0 0 8px rgba(120,255,160,.6)}" +
            "#" + ID + " .cd{margin-top:6px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:5px}" +
            "#" + ID + " .cd-early{color:#ff6b6b}#" + ID + " .cd-near{color:#ffcf66}" +
            "#" + ID + " .cd-go{color:#7dffab;animation:efcd .7s ease-in-out infinite}" +
            "@keyframes efcd{0%,100%{opacity:1}50%{opacity:.4}}" +
            "#" + ID + " .cdq{flex:none;font-size:8px;font-weight:700;color:#cfc7b3;opacity:.55;border:1px solid currentColor;border-radius:50%;width:12px;height:12px;line-height:11px;text-align:center;cursor:help}" +
            "#" + ID + ".min .body{display:none}";
        document.head.appendChild(s);
    }

    function makeDraggable(p, handle) {
        handle.style.cursor = "move";
        let on = false, sx, sy, ox, oy;
        handle.addEventListener("mousedown", (e) => {
            if (e.target.classList && e.target.classList.contains("x")) return;   // keep the collapse button clickable
            const r = p.getBoundingClientRect();
            p.style.top = r.top + "px"; p.style.left = r.left + "px"; p.style.right = "auto"; p.style.bottom = "auto";
            on = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
            if (!on) return;
            p.style.left = Math.max(0, ox + e.clientX - sx) + "px";
            p.style.top = Math.max(0, oy + e.clientY - sy) + "px";
        });
        document.addEventListener("mouseup", () => {
            if (!on) return; on = false;
            try { localStorage.setItem(POS_KEY, JSON.stringify({ left: p.style.left, top: p.style.top })); } catch (e) {}
        });
    }

    function ensurePanel() {
        if (panel) return;
        ensureStyle();
        panel = el("div"); panel.id = ID;
        panel.dataset.efPluginOverlay = "session-history";   // runtime hide/show hook (EF2-Browser-Runtime v0.5.2+)
        const hd = el("div"); hd.className = "hd";
        hd.appendChild(el("span", null, "🏆"));
        hd.appendChild(el("span", "flex:1", "MPM RECORD"));
        const tog = el("span", null, "–"); tog.className = "x"; tog.title = "collapse";
        tog.onclick = () => { minimized = !minimized; panel.classList.toggle("min", minimized); tog.textContent = minimized ? "+" : "–"; };
        hd.appendChild(tog);
        panel.appendChild(hd);
        body = el("div"); body.className = "body"; panel.appendChild(body);
        (document.body || document.documentElement).appendChild(panel);
        try { const p = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (p && p.left) { panel.style.left = p.left; panel.style.top = p.top; panel.style.right = "auto"; panel.style.bottom = "auto"; } } catch (e) {}
        makeDraggable(panel, hd);
    }

    function render() {
        // overlay master toggle + "have a record" gate
        if (!feat("overlay") || !Number.isFinite(record)) { if (panel) panel.style.display = "none"; return; }
        ensurePanel();
        panel.style.display = "";
        const liveMpm = Number.isFinite(liveMpmRaw) ? liveMpmRaw * readMedalMult() : NaN;   // apply medal-buff %
        const haveLive = Number.isFinite(liveMpm);
        const above = haveLive && liveMpm > record;
        panel.classList.toggle("above", above);
        panel.classList.toggle("pulse", above && feat("overlayGlow"));
        const pct = haveLive ? Math.min(999, Math.round(liveMpm / record * 100)) : null;
        const fill = haveLive ? Math.min(100, liveMpm / record * 100) : 0;
        let html = '<div class="rec">' + fmtMedals(record) + '</div>';
        html += '<div class="now"><span style="opacity:.7">now</span><b>' + (haveLive ? fmtMedals(liveMpm) : "—") + '</b>'
            + '<span class="pct">' + (pct != null ? pct + "%" : "") + '</span></div>'
            + '<div class="bar"><div class="fill" style="width:' + fill + '%"></div></div>';
        if (above) html += '<div class="abv">▲ ABOVE RECORD +' + ((liveMpm / record - 1) * 100).toFixed(1) + '%</div>';
        if (above && feat("overlayCountdown")) html += '<div class="cd" id="ef-cd-line"></div>';
        if (feat("overlayRelic")) html += '<div class="relic">⚠️ swap to your medal relics</div>';
        body.innerHTML = html;
        tickCountdown();   // fill the countdown now; the interval keeps it ticking between samples
    }

    // --- :59 revive countdown ---------------------------------------------------------
    // The record = medals / floor(minutes elapsed), so within a minute it climbs and peaks just
    // before the whole-minute boundary. Count down (real wall-clock, extrapolated from the last
    // rebirthTimeSec) to that boundary so you can revive at the tip. Shown only when above record.
    function countdownState() {
        if (!feat("overlayCountdown") || !Number.isFinite(reviveEpochMs)) return null;
        if (Date.now() - lastSampleWallMs > 12000) return null;   // no recent sample -> run inactive
        const liveSec = (Date.now() - reviveEpochMs) / 1000;
        if (!Number.isFinite(liveSec) || liveSec < 0) return null;
        const s = 60 - (liveSec % 60);          // seconds until the floor steps (and MPM drops)
        return { s: s, zone: s <= 4 ? "go" : s <= 10 ? "near" : "early" };
    }
    function tickCountdown() {
        const line = document.getElementById("ef-cd-line");
        if (!line) return;
        const st = countdownState();
        if (!st) { line.style.display = "none"; return; }
        line.style.display = "";
        const n = Math.max(0, Math.ceil(st.s));
        const q = '<span class="cdq" title="Your MPM record = medals ÷ whole minutes elapsed, so it peaks in the last seconds before each game-minute ticks over. Revive on green to lock in a little more.">?</span>';
        if (st.zone === "go") { line.className = "cd cd-go"; line.innerHTML = '🟢 REVIVE NOW ' + q; }
        else if (st.zone === "near") { line.className = "cd cd-near"; line.innerHTML = '⚠️ revive in ' + n + 's ' + q; }
        else { line.className = "cd cd-early"; line.innerHTML = '🚨 revive in ' + n + 's ' + q; }
    }

    // live medals/min from the Wave Tracker (v0.5.3+ nested sample, or a flat shape)
    function mpmOf(s) { if (!s) return NaN; const m = s.medalMpmState ? Number(s.medalMpmState.currentMpm) : Number(s.currentMpm); return Number.isFinite(m) ? m : NaN; }
    const unsub = (runtime && runtime.events && typeof runtime.events.on === "function")
        ? runtime.events.on("wave:sample", (s) => { try {
            const rt = s ? Number(s.rebirthTimeSec) : NaN;
            if (Number.isFinite(rt) && rt >= 0) { reviveEpochMs = Date.now() - rt * 1000; lastSampleWallMs = Date.now(); }   // wall-clock anchor
            const m = mpmOf(s); if (Number.isFinite(m)) { liveMpmRaw = m; record = readRecord(); }
            render();
        } catch (e) {} })
        : function () {};

    const recTimer = setInterval(() => { const r = readRecord(); if (r !== record) { record = r; render(); } }, 4000);
    cdTimer = setInterval(tickCountdown, 250);   // smooth per-second countdown between samples
    function onStorage(e) {
        if (e.key === SETTINGS_KEY) { settings = readSettings(); render(); }
        else if (e.key === STORE_KEY) { record = readRecord(); render(); }
        else if (e.key === MEDAL_BUFF_KEY) { render(); }   // medal-buff % changed in the viewer / tracker
    }
    window.addEventListener("storage", onStorage);

    if (feat("overlay") && Number.isFinite(record)) ensurePanel();
    render();
    try { runtime.logger && runtime.logger.info && runtime.logger.info("session-history", "MPM record overlay installed"); } catch (e) {}

    return {
        detach() {
            try { unsub && unsub(); } catch (e) {}
            clearInterval(recTimer);
            if (cdTimer) clearInterval(cdTimer);
            window.removeEventListener("storage", onStorage);
            if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
            const st = document.getElementById(ID + "-style"); if (st && st.parentNode) st.parentNode.removeChild(st);
        }
    };
}
