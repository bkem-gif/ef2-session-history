/*
 * EF2 Session History — in-game "MPM Record" overlay.
 *
 * A small, draggable, transparent HUD that shows your all-time Soul Rest record
 * (bestMedalPerMin — the value idle income is paid on), your LIVE medals/min versus it,
 * a caution to swap to your medal relics, and a green glow the moment your live rate
 * beats the record (a pure comparison — no projection).
 *
 * Data is read-only: live medals/min from the Wave Tracker's `wave:sample` event, and the
 * record from the recorder's captured account (window.__EF_SESSION_HISTORY_ACCOUNT__, with the
 * persisted store as a fallback). It honours the viewer's settings (shared localStorage key) and
 * the runtime's per-plugin hide/show (data-ef-plugin-overlay). It never sends a move.
 */
export function installSessionOverlay(runtime) {
    const ID = "ef-session-record-overlay";
    const SETTINGS_KEY = "__EF_SESSION_HISTORY_SETTINGS__";
    const STORE_KEY = "__EF_SESSION_HISTORY__";
    const POS_KEY = "__EF_SESSION_OVERLAY_POS__";

    // number format — matches the viewer / game (1e3 = A, 1e6 = B, 1e9 = C, …)
    function tierLetters(n) { let s = ""; while (n > 0) { n -= 1; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
    function fmtMedals(v) {
        if (!Number.isFinite(v)) return "—";
        let sc = v, t = 0;
        while (sc >= 1000) { sc /= 1000; t += 1; }
        let r = Math.round(sc * 100) / 100;
        if (r >= 1000) { r /= 1000; t += 1; }
        return t === 0 ? String(r) : (parseFloat(r.toFixed(2)) + tierLetters(t));
    }

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

    let liveMpm = NaN, record = readRecord();

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
        if (feat("overlayRelic")) html += '<div class="relic">⚠️ swap to your medal relics</div>';
        body.innerHTML = html;
    }

    // live medals/min from the Wave Tracker (v0.5.3+ nested sample, or a flat shape)
    function mpmOf(s) { if (!s) return NaN; const m = s.medalMpmState ? Number(s.medalMpmState.currentMpm) : Number(s.currentMpm); return Number.isFinite(m) ? m : NaN; }
    const unsub = (runtime && runtime.events && typeof runtime.events.on === "function")
        ? runtime.events.on("wave:sample", (s) => { try { const m = mpmOf(s); if (Number.isFinite(m)) { liveMpm = m; record = readRecord(); render(); } } catch (e) {} })
        : function () {};

    const recTimer = setInterval(() => { const r = readRecord(); if (r !== record) { record = r; render(); } }, 4000);
    function onStorage(e) {
        if (e.key === SETTINGS_KEY) { settings = readSettings(); render(); }
        else if (e.key === STORE_KEY) { record = readRecord(); render(); }
    }
    window.addEventListener("storage", onStorage);

    if (feat("overlay") && Number.isFinite(record)) ensurePanel();
    render();
    try { runtime.logger && runtime.logger.info && runtime.logger.info("session-history", "MPM record overlay installed"); } catch (e) {}

    return {
        detach() {
            try { unsub && unsub(); } catch (e) {}
            clearInterval(recTimer);
            window.removeEventListener("storage", onStorage);
            if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
            const st = document.getElementById(ID + "-style"); if (st && st.parentNode) st.parentNode.removeChild(st);
        }
    };
}
