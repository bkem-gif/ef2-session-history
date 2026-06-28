// Self-contained test environment for the session-history plugin.
//
// The components (recorder.js / overlay.js) are ES-module closures that read free globals
// (window, document, localStorage, performance, timers) and a `runtime` argument. This module
// builds a fresh fake environment per test and installs it on globalThis. No external deps.
//
// Usage:
//   import { installEnv } from "./_env.js";
//   let env;
//   beforeEach(() => { env = installEnv(); });
//   afterEach(() => { env.restore(); });

// ---- localStorage ------------------------------------------------------------------
export function makeLocalStorage() {
    const map = new Map();
    let quota = Infinity;
    return {
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) {
            const s = String(v);
            let total = s.length;
            for (const [kk, vv] of map) { if (kk !== k) { total += vv.length; } }
            if (total > quota) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
            map.set(k, s);
        },
        removeItem(k) { map.delete(k); },
        clear() { map.clear(); },
        __map: map,
        __setQuota(bytes) { quota = bytes; },
    };
}

// ---- minimal DOM shim --------------------------------------------------------------
function parseIdTags(html) {
    const out = [];
    const tags = String(html).match(/<[^>]+>/g) || [];
    for (const t of tags) {
        const idm = t.match(/\bid="([^"]+)"/);
        if (!idm) { continue; }
        const cm = t.match(/\bclass="([^"]+)"/);
        out.push({ id: idm[1], className: cm ? cm[1] : "" });
    }
    return out;
}
function stripTags(html) {
    return String(html).replace(/<[^>]*>/g, "");
}

export function makeDocument() {
    const idMap = new Map();

    function makeClassList(el) {
        const set = new Set();
        const sync = () => { el.className = [...set].join(" "); };
        return {
            add(...c) { c.forEach(x => set.add(x)); sync(); },
            remove(...c) { c.forEach(x => set.delete(x)); sync(); },
            toggle(c, force) {
                const want = force === undefined ? !set.has(c) : !!force;
                if (want) { set.add(c); } else { set.delete(c); }
                sync();
                return want;
            },
            contains(c) { return set.has(c); },
            _set: set,
        };
    }

    function registerSubtree(el) { if (el && el.id) { idMap.set(el.id, el); } (el.children || []).forEach(registerSubtree); }
    function unregisterSubtree(el) { if (el && el.id && idMap.get(el.id) === el) { idMap.delete(el.id); } (el.children || []).forEach(unregisterSubtree); }

    function makeElement(tag) {
        const el = {
            tagName: String(tag || "").toUpperCase(),
            id: "",
            className: "",
            children: [],
            parentNode: null,
            style: {},
            dataset: {},
            _innerHTML: "",
            _contributedIds: [],
            _listeners: {},
        };
        el.classList = makeClassList(el);
        Object.defineProperty(el, "innerHTML", {
            get() { return el._innerHTML; },
            set(v) {
                el._innerHTML = String(v);
                el._contributedIds.forEach(id => { if (idMap.get(id) && idMap.get(id)._owner === el) { idMap.delete(id); } });
                el._contributedIds = [];
                for (const { id, className } of parseIdTags(el._innerHTML)) {
                    const stub = makeElement("div");
                    stub.id = id; stub.className = className; stub._owner = el;
                    idMap.set(id, stub);
                    el._contributedIds.push(id);
                }
            },
        });
        Object.defineProperty(el, "textContent", {
            get() {
                if (el._innerHTML) { return stripTags(el._innerHTML); }
                return el.children.map(c => c.textContent).join("");
            },
            set(v) { el.innerHTML = String(v); },
        });
        el.appendChild = (c) => { c.parentNode = el; el.children.push(c); registerSubtree(c); return c; };
        el.removeChild = (c) => { const i = el.children.indexOf(c); if (i >= 0) { el.children.splice(i, 1); } c.parentNode = null; unregisterSubtree(c); return c; };
        el.addEventListener = (t, cb) => { (el._listeners[t] ||= []).push(cb); };
        el.removeEventListener = (t, cb) => { el._listeners[t] = (el._listeners[t] || []).filter(f => f !== cb); };
        el._emit = (t, ev) => { (el._listeners[t] || []).slice().forEach(cb => cb(ev || {})); };
        el.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
        el.querySelector = () => null;
        el.querySelectorAll = () => [];
        return el;
    }

    const document = {
        visibilityState: "visible",
        _listeners: {},
        createElement: (tag) => makeElement(tag),
        getElementById: (id) => idMap.get(id) || null,
        addEventListener(t, cb) { (this._listeners ||= {}); (document._listeners[t] ||= []).push(cb); },
        removeEventListener(t, cb) { document._listeners[t] = (document._listeners[t] || []).filter(f => f !== cb); },
        _emit(t, ev) { (document._listeners[t] || []).slice().forEach(cb => cb(ev || {})); },
        __idMap: idMap,
    };
    document.documentElement = makeElement("html");
    document.head = makeElement("head");
    document.body = makeElement("body");
    return document;
}

// ---- runtime (events / hooks / logger) ---------------------------------------------
export function makeRuntime() {
    const logs = [];
    const sampleListeners = [];
    let parseHandlers = [];
    const runtime = {
        logger: {
            info: (...a) => logs.push(["info", ...a]),
            warn: (...a) => logs.push(["warn", ...a]),
            error: (...a) => logs.push(["error", ...a]),
            debug: (...a) => logs.push(["debug", ...a]),
        },
        events: {
            on(name, cb) {
                if (name !== "wave:sample") { return () => {}; }
                sampleListeners.push(cb);
                return () => { const i = sampleListeners.indexOf(cb); if (i >= 0) { sampleListeners.splice(i, 1); } };
            },
            emit(name, arg) {
                if (name !== "wave:sample") { return; }
                Array.from(sampleListeners).forEach(cb => cb(arg));
            },
        },
        hooks: {
            onJsonParse(handler) {
                parseHandlers.push(handler);
                return () => { const i = parseHandlers.indexOf(handler); if (i >= 0) { parseHandlers.splice(i, 1); } };
            },
        },
        __logs: logs,
        __parse(obj) { Array.from(parseHandlers).forEach(h => h(obj)); },
    };
    return runtime;
}

// ---- install / restore -------------------------------------------------------------
export function installEnv() {
    const localStorage = makeLocalStorage();
    const document = makeDocument();
    const winListeners = {};
    const window = {
        localStorage,
        performance: { now: () => Date.now() },
        addEventListener(t, cb) { (winListeners[t] ||= []).push(cb); },
        removeEventListener(t, cb) { winListeners[t] = (winListeners[t] || []).filter(f => f !== cb); },
        _emit(t, ev) { (winListeners[t] || []).slice().forEach(cb => cb(ev || {})); },
    };
    window.window = window;
    const runtime = makeRuntime();

    const prev = {
        window: globalThis.window, document: globalThis.document,
        localStorage: globalThis.localStorage, performance: globalThis.performance,
    };
    globalThis.window = window;
    globalThis.document = document;
    globalThis.localStorage = localStorage;
    globalThis.performance = window.performance;

    return {
        window, document, localStorage, runtime,
        store() { const raw = localStorage.getItem("__EF_SESSION_HISTORY__"); return raw ? JSON.parse(raw) : null; },
        parse(body) { runtime.__parse({ body }); },
        emitSample(s) { runtime.events.emit("wave:sample", s); },
        fireStorage(key) { window._emit("storage", { key }); },
        restore() {
            try { window.__EF_SESSION_HISTORY_INSTALLED__ = false; } catch (e) {}
            const set = (k, v) => { if (v === undefined) { delete globalThis[k]; } else { globalThis[k] = v; } };
            set("window", prev.window); set("document", prev.document);
            set("localStorage", prev.localStorage); set("performance", prev.performance);
        },
    };
}
