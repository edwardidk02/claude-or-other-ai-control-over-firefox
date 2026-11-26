/* Claude in Firefox - content script. Reads and drives the page. */
(() => {
  "use strict";
  if (window.__claudeFx) return;
  window.__claudeFx = true;

  // ---------------------------------------------------------- console capture
  const logs = [];
  const MAX_LOGS = 500;
  function fmt(a) {
    try {
      if (a === null || a === undefined) return String(a);
      if (typeof a === "string") return a;
      if (typeof a === "number" || typeof a === "boolean") return String(a);
      if (a instanceof Error || (a && a.message && a.stack)) return `${a.name || "Error"}: ${a.message}`;
      return JSON.stringify(a).slice(0, 2000);
    } catch (e) {
      try { return String(a); } catch (e2) { return "[unreadable]"; }
    }
  }
  function record(level, args) {
    logs.push({ level, t: new Date().toISOString().slice(11, 23), msg: Array.from(args).map(fmt).join(" ").slice(0, 4000) });
    if (logs.length > MAX_LOGS) logs.shift();
  }
  try {
    const pc = window.wrappedJSObject && window.wrappedJSObject.console;
    if (pc && typeof exportFunction === "function") {
      for (const level of ["log", "info", "warn", "error", "debug"]) {
        const orig = pc[level];
        exportFunction(function (...args) {
          try { record(level, args); } catch (e) { /* never break the page */ }
          // spread (not apply with our array): each arg goes back to the page unwrapped
          return orig.call(pc, ...args);
        }, pc, { defineAs: level });
      }
    }
  } catch (e) { /* page may block; ignore */ }
  window.addEventListener("error", (e) => record("error", [`${e.message} (${e.filename}:${e.lineno})`]), true);
  window.addEventListener("unhandledrejection", (e) => record("error", ["Unhandled rejection: " + fmt(e.reason)]));

  // ---------------------------------------------------------- overlay: orange glow + cursor
  const ORANGE = "#D97757";
  const FX = (() => {
    let host = null, glow, cur, ring, pos = null, hidden = false, active = false;
    const SVGNS = "http://www.w3.org/2000/svg";
    function build() {
      if (host && host.isConnected) return;
      host = document.createElement("claude-fx-overlay");
      host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;";
      const root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        *{pointer-events:none;box-sizing:border-box}
        .glow{position:fixed;inset:0;opacity:0;transition:opacity .35s ease;
          box-shadow:inset 0 0 0 3px ${ORANGE}, inset 0 0 36px 8px rgba(217,119,87,.45)}
        .glow.on{opacity:1;animation:pulse 2.4s ease-in-out infinite}
        @keyframes pulse{0%,100%{box-shadow:inset 0 0 0 3px ${ORANGE}, inset 0 0 36px 8px rgba(217,119,87,.45)}
          50%{box-shadow:inset 0 0 0 3px ${ORANGE}, inset 0 0 52px 14px rgba(217,119,87,.28)}}
        .cur{position:fixed;left:0;top:0;width:30px;height:30px;opacity:0;
          transition:transform .42s cubic-bezier(.3,.7,.2,1), opacity .25s ease;
          filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))}
        .cur.on{opacity:1}
        .cur svg{position:absolute;left:-3px;top:-2px;width:30px;height:30px}
        .ring{position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;
          border:3px solid ${ORANGE};opacity:0;transform:scale(.3)}
        .ring.go{animation:ring .5s ease-out}
        @keyframes ring{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(1.6)}}
        .hide{visibility:hidden !important}`;
      glow = document.createElement("div"); glow.className = "glow";
      cur = document.createElement("div"); cur.className = "cur";
      const svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      const path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", "M4 2.5 L4 19.5 L8.6 15.4 L11.6 22 L14.6 20.7 L11.7 14.2 L18 14.2 Z");
      path.setAttribute("fill", ORANGE); path.setAttribute("stroke", "#fff");
      path.setAttribute("stroke-width", "1.6"); path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      ring = document.createElement("div"); ring.className = "ring";
      cur.append(ring, svg);
      root.append(style, glow, cur);
      (document.documentElement || document).appendChild(host);
      if (hidden) setVisible(false);
    }
    // Glow (and cursor) stay on for the whole task; the background turns them
    // off when Claude reports the task done. No fade-out timer, so no flicker.
    function activity() {
      build();
      active = true;
      glow.classList.add("on");
    }
    function setActive(on) {
      if (on) { activity(); return; }
      active = false;
      if (glow) glow.classList.remove("on");
      if (cur) cur.classList.remove("on");
    }
    function place(x, y) { cur.style.transform = `translate(${x}px, ${y}px)`; }
    function follow(x, y) {
      activity();
      cur.classList.add("on");
      cur.style.transition = "transform 25ms linear, opacity .25s ease";
      place(x, y); pos = { x, y };
      clearTimeout(follow.t); follow.t = setTimeout(() => { cur.style.transition = ""; }, 200);
    }
    function moveTo(x, y) {
      activity();
      return new Promise((done) => {
        if (!pos || !cur.classList.contains("on")) {
          // appear near the target, then glide in
          const sx = pos ? pos.x : Math.min(innerWidth - 40, x + 120), sy = pos ? pos.y : Math.min(innerHeight - 40, y + 90);
          cur.style.transition = "none"; place(sx, sy);
          void cur.offsetWidth;
          cur.style.transition = "";
          cur.classList.add("on");
        }
        requestAnimationFrame(() => place(x, y));
        pos = { x, y };
        setTimeout(done, 450);
      });
    }
    function pulse() {
      if (!ring) return;
      ring.classList.remove("go"); void ring.offsetWidth; ring.classList.add("go");
    }
    function setVisible(v) {
      hidden = !v;
      if (host) host.style.visibility = v ? "visible" : "hidden";
    }
    function state() { return { glow: !!(glow && glow.classList.contains("on")), cursor: pos, attached: !!(host && host.isConnected) }; }
    return { activity, setActive, moveTo, follow, pulse, setVisible, state };
  })();
  window.__claudeFxState = FX.state;
  (function askOverlayState() {
    const ask = () => browser.runtime.sendMessage({ op: "overlay_query" })
      .then((r) => { if (r && r.active) FX.setActive(true); }).catch(() => {});
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ask, { once: true });
    else ask();
  })();

  // ---------------------------------------------------------- refs
  let refCounter = 0;
  const refToEl = new Map();
  const elToRef = new WeakMap();
  function refFor(el) {
    let r = elToRef.get(el);
    if (r && refToEl.get(r) && refToEl.get(r).deref() === el) return r;
    r = "ref_" + (++refCounter);
    elToRef.set(el, r);
    refToEl.set(r, new WeakRef(el));
    return r;
  }
  function elFor(ref) {
    const w = refToEl.get(String(ref));
    const el = w && w.deref();
    if (!el || !el.isConnected) throw new Error(`${ref} does not exist (anymore). Call read_page or find again.`);
    return el;
  }

  // ---------------------------------------------------------- roles & names
  const INPUT_ROLES = {
    button: "button", submit: "button", reset: "button", image: "button",
    checkbox: "checkbox", radio: "radio", range: "slider", search: "searchbox",
    email: "textbox", tel: "textbox", text: "textbox", url: "textbox", password: "textbox",
    number: "spinbutton", file: "button", color: "button",
    date: "textbox", "datetime-local": "textbox", month: "textbox", time: "textbox", week: "textbox",
  };
  const TAG_ROLES = {
    BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", NAV: "navigation", MAIN: "main",
    HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary", FORM: "form", UL: "list", OL: "list",
    LI: "listitem", TABLE: "table", TR: "row", TH: "columnheader", TD: "cell", DIALOG: "dialog",
    H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
    IMG: "img", SUMMARY: "button", OPTION: "option", LABEL: "label", IFRAME: "iframe",
    VIDEO: "video", AUDIO: "audio", P: "paragraph", SECTION: "region", ARTICLE: "article",
  };
  const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
    "slider", "spinbutton", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
    "listbox", "treeitem", "iframe"]);

  function roleOf(el) {
    const r = el.getAttribute("role");
    if (r) return r.split(/\s+/)[0];
    const tag = el.tagName;
    if (tag === "A") return el.hasAttribute("href") ? "link" : null;
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "hidden") return null;
      if ((type === "text" || type === "search") && el.getAttribute("list")) return "combobox";
      return INPUT_ROLES[type] || "textbox";
    }
    if (el.isContentEditable && (!el.parentElement || !el.parentElement.isContentEditable)) return "textbox";
    if (TAG_ROLES[tag]) return TAG_ROLES[tag];
    if (el.hasAttribute("onclick") || el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") {
      const cs = getComputedStyle(el);
      if (cs.cursor === "pointer") return "button";
    }
    return null;
  }

  const clean = (s, n = 120) => {
    s = (s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };

  // label text without the text of form controls inside it (select options etc.)
  function labelText(l) {
    let s = "";
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) s += c.textContent;
        else if (c.nodeType === 1 && !/^(SELECT|TEXTAREA|INPUT|BUTTON|SCRIPT|STYLE)$/.test(c.tagName)) walk(c);
      }
    };
    walk(l);
    return s;
  }

  function nameOf(el, role) {
    if (role === "label") return clean(labelText(el));
    const al = el.getAttribute("aria-label");
    if (al) return clean(al);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => { const x = document.getElementById(id); return x ? x.textContent : ""; }).join(" ");
      if (t.trim()) return clean(t);
    }
    if (el.labels && el.labels.length) return clean(Array.from(el.labels).map(labelText).join(" "));
    if (el.tagName === "IMG") return clean(el.getAttribute("alt") || el.getAttribute("title") || "");
    if (el.tagName === "INPUT") {
      const type = (el.type || "").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) return clean(el.value || type);
      return clean(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "");
    }
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT")
      return clean(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "");
    if (["button", "link", "heading", "tab", "menuitem", "option", "listitem", "cell", "columnheader",
         "label", "treeitem", "switch", "checkbox", "radio", "paragraph"].includes(role) || role === null) {
      const t = el.innerText !== undefined ? el.innerText : el.textContent;
      if (t && t.trim()) return clean(t, role === "paragraph" ? 300 : 120);
    }
    return clean(el.getAttribute("title") || "");
  }

  function visible(el) {
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.tagName === "OPTION";
  }

  function stateOf(el, role) {
    const bits = [];
    if (el.disabled || el.getAttribute("aria-disabled") === "true") bits.push("disabled");
    if (role === "checkbox" || role === "radio" || role === "switch") {
      const c = el.checked !== undefined ? el.checked : el.getAttribute("aria-checked") === "true";
      bits.push(c ? "checked" : "unchecked");
    }
    const exp = el.getAttribute("aria-expanded");
    if (exp) bits.push(exp === "true" ? "expanded" : "collapsed");
    if (el.getAttribute("aria-selected") === "true" || (el.tagName === "OPTION" && el.selected)) bits.push("selected");
    if (role === "heading") bits.push("level=" + (el.getAttribute("aria-level") || el.tagName.slice(1)));
    if (["textbox", "searchbox", "spinbutton", "combobox", "slider"].includes(role)) {
      let v = el.isContentEditable ? el.innerText : el.value;
      if (el.tagName === "SELECT") v = el.selectedOptions.length ? el.selectedOptions[0].text : "";
      if (el.type === "password" && v) v = "••••";
      if (v) bits.push(`value="${clean(v, 80)}"`);
    }
    if (role === "link") {
      const h = el.getAttribute("href") || "";
      if (h && !h.startsWith("javascript:")) bits.push("href=" + clean(h, 100));
    }
    if (document.activeElement === el) bits.push("focused");
    return bits;
  }

  // ---------------------------------------------------------- tree
  function* childrenOf(el) {
    if (el.shadowRoot) yield* el.shadowRoot.children;
    if (el.tagName === "SLOT") { yield* el.assignedElements(); return; }
    yield* el.children;
  }

  function directText(el) {
    let s = "";
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent;
    return clean(s, 200);
  }

  function buildTree(root, interactiveOnly, maxChars, maxDepth = 1000) {
    const lines = [];
    let size = 0, truncated = false;
    const SKIP = new Set(["CLAUDE-FX-OVERLAY", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "META", "LINK", "BR", "HR", "PATH"]);
    function push(depth, line) {
      if (truncated) return;
      const l = "  ".repeat(depth) + line;
      if (size + l.length > maxChars) { truncated = true; return; }
      lines.push(l); size += l.length + 1;
    }
    function walk(el, depth) {
      if (truncated || depth > maxDepth) return;
      if (SKIP.has(el.tagName.toUpperCase())) return;
      if (!visible(el) && el.tagName !== "BODY") {
        // hidden subtree, but children can be visible (display:contents); cheap check
        if (getComputedStyle(el).display !== "contents") return;
      }
      const role = roleOf(el);
      const inter = role && (INTERACTIVE.has(role) || el.tagName === "A" || el.tagName === "BUTTON");
      let nextDepth = depth;
      if (role && (!interactiveOnly || inter)) {
        const name = nameOf(el, role);
        const st = stateOf(el, role);
        const ref = inter || role === "heading" || role === "img" ? ` [${refFor(el)}]` : "";
        push(depth, `- ${role}${name ? ` "${name}"` : ""}${st.length ? " " + st.join(" ") : ""}${ref}`);
        nextDepth = depth + 1;
        if (["button", "link", "heading", "option", "textbox", "searchbox", "checkbox", "radio", "paragraph", "label", "img"].includes(role)) {
          // name already includes the text; still descend for nested interactive elements
          for (const c of childrenOf(el)) if (c.querySelector && (c.matches("a,button,input,select,textarea,[role],[contenteditable]") || c.querySelector("a,button,input,select,textarea,[role]"))) walk(c, nextDepth);
          return;
        }
      } else if (!role && !interactiveOnly) {
        const t = directText(el);
        if (t) push(depth, `- text "${t}"`);
      }
      if (el.tagName === "IFRAME") {
        try { if (el.contentDocument && el.contentDocument.body) walk(el.contentDocument.body, nextDepth); } catch (e) { /* cross-origin */ }
      }
      for (const c of childrenOf(el)) walk(c, nextDepth);
    }
    walk(root, 0);
    if (truncated) lines.push(`… (truncated at ${maxChars} characters; use filter=interactive, ref_id or a higher max_chars)`);
    return lines.join("\n");
  }

  function header() {
    return `Page: ${document.title}\nURL: ${location.href}\nViewport: ${innerWidth}x${innerHeight}, scroll ${Math.round(scrollX)},${Math.round(scrollY)} of ${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}\n`;
  }

  // ---------------------------------------------------------- pointer
  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    let ox = 0, oy = 0;
    for (let i = 0; el && i < 10; i++) {
      if (el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x - ox, y - oy);
        if (inner && inner !== el) { el = inner; continue; }
      }
      if (el.tagName === "IFRAME") {
        try {
          const r = el.getBoundingClientRect();
          const d = el.contentDocument;
          if (d) { ox += r.left; oy += r.top; const inner = d.elementFromPoint(x - ox, y - oy); if (inner) { el = inner; continue; } }
        } catch (e) { /* cross-origin */ }
      }
      break;
    }
    return el;
  }

  function mods(s) {
    s = (s || "").toLowerCase();
    return { ctrlKey: /ctrl|control/.test(s), shiftKey: /shift/.test(s), altKey: /alt/.test(s), metaKey: /meta|cmd|win/.test(s) };
  }

  function target(args) {
    if (args.ref) {
      const el = elFor(args.ref);
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    if (typeof args.x === "number" && typeof args.y === "number") {
      const el = deepElementFromPoint(args.x, args.y);
      if (!el) throw new Error(`No element at (${Math.round(args.x)}, ${Math.round(args.y)}).`);
      return { el, x: args.x, y: args.y };
    }
    throw new Error("Provide a ref or x and y.");
  }

  function mouse(el, type, x, y, extra = {}) {
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y,
                   screenX: x + screenX, screenY: y + screenY, ...extra };
    const isPointer = type.startsWith("pointer");
    const Ctor = isPointer ? PointerEvent : MouseEvent;
    if (isPointer) Object.assign(init, { pointerId: 1, pointerType: "mouse", isPrimary: true });
    return el.dispatchEvent(new Ctor(type, init));
  }

  function describe(el) {
    const role = roleOf(el) || el.tagName.toLowerCase();
    const n = nameOf(el, roleOf(el));
    return `${role}${n ? ` "${n}"` : ""}`;
  }

  function focusable(el) {
    let e = el;
    while (e && e !== document.body) {
      if (e.matches && e.matches("a[href],button,input,select,textarea,[tabindex],[contenteditable='true'],[contenteditable='']")) return e;
      e = e.parentElement;
    }
    return null;
  }

  // A real click elsewhere closes open autocomplete/suggestion popups; synthetic
  // events don't, so "click away" explicitly from a focused text field.
  function leaveTextField(clicked) {
    const a = activeDeep();
    if (!a || a === clicked || (a.contains && a.contains(clicked))) return;
    if (!isTextInput(a) && !a.isContentEditable) return;
    for (const t of ["keydown", "keyup"])
      a.dispatchEvent(new KeyboardEvent(t, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true }));
    a.blur();
  }

  async function doClick(args) {
    const { el, x, y } = target(args);
    await FX.moveTo(x, y);
    FX.pulse();
    leaveTextField(el);
    const m = mods(args.modifiers);
    const btn = args.button || "left";
    if (btn === "right") {
      mouse(el, "pointerdown", x, y, { ...m, button: 2, buttons: 2 });
      mouse(el, "mousedown", x, y, { ...m, button: 2, buttons: 2 });
      mouse(el, "pointerup", x, y, { ...m, button: 2 });
      mouse(el, "mouseup", x, y, { ...m, button: 2 });
      mouse(el, "contextmenu", x, y, { ...m, button: 2 });
      return { text: `Right-clicked ${describe(el)}` };
    }
    const times = btn === "double" ? 2 : btn === "triple" ? 3 : 1;
    for (let i = 1; i <= times; i++) {
      mouse(el, "pointerover", x, y, m); mouse(el, "mouseover", x, y, m);
      mouse(el, "pointerdown", x, y, { ...m, button: 0, buttons: 1, detail: i });
      mouse(el, "mousedown", x, y, { ...m, button: 0, buttons: 1, detail: i });
      const f = focusable(el);
      if (f && document.activeElement !== f) f.focus({ preventScroll: true });
      mouse(el, "pointerup", x, y, { ...m, button: 0, detail: i });
      mouse(el, "mouseup", x, y, { ...m, button: 0, detail: i });
      // HTMLElement.click() gives the right default actions (links, checkboxes, labels, submit)
      if (i === 1 && !m.ctrlKey && !m.shiftKey && !m.altKey && !m.metaKey && typeof el.click === "function") el.click();
      else mouse(el, "click", x, y, { ...m, button: 0, detail: i });
    }
    if (times >= 2) mouse(el, "dblclick", x, y, { ...m, button: 0, detail: 2 });
    if (times === 3) {
      // triple click selects the whole field / paragraph
      if (isTextInput(el)) el.select();
      else {
        const block = el.closest("p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,div") || el;
        const r = document.createRange(); r.selectNodeContents(block);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
    }
    return { text: `${["", "Clicked", "Double-clicked", "Triple-clicked"][times]} ${describe(el)}` };
  }

  // ---------------------------------------------------------- drag
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  // DataTransfer/DragEvent must be created in the page's compartment, otherwise
  // the page sees an empty dataTransfer (files and setData get lost).
  function pageDT() {
    const W = window.wrappedJSObject;
    try { if (W && W.DataTransfer) return new W.DataTransfer(); } catch (e) { /* */ }
    return new DataTransfer();
  }
  function dragEvent(type, x, y, dt) {
    const W = window.wrappedJSObject;
    try {
      if (W && W.DragEvent) {
        const init = new W.Object();
        init.bubbles = true; init.cancelable = true; init.composed = true;
        init.clientX = x; init.clientY = y; init.dataTransfer = dt;
        return new W.DragEvent(type, init);
      }
    } catch (e) { /* fall back */ }
    return new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt });
  }
  async function doDrag(a) {
    if ([a.x, a.y, a.x2, a.y2].some((v) => typeof v !== "number")) throw new Error("Provide start_coordinate and coordinate (end point).");
    const src = deepElementFromPoint(a.x, a.y);
    if (!src) throw new Error("No element at the start point.");
    await FX.moveTo(a.x, a.y);
    FX.pulse();
    leaveTextField(src);
    mouse(src, "pointerdown", a.x, a.y, { button: 0, buttons: 1 });
    mouse(src, "mousedown", a.x, a.y, { button: 0, buttons: 1 });
    // HTML5 drag & drop for draggable elements
    const dragEl = (src.closest && src.closest("[draggable=true]")) || (/^(IMG|A)$/.test(src.tagName) ? src : null);
    const dt = dragEl ? pageDT() : null;
    const dev = (type, el, x, y) => el.dispatchEvent(dragEvent(type, x, y, dt));
    if (dt) dev("dragstart", dragEl, a.x, a.y);
    let over = src, lastOver = null;
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const x = a.x + (a.x2 - a.x) * i / steps, y = a.y + (a.y2 - a.y) * i / steps;
      FX.follow(x, y);
      over = deepElementFromPoint(x, y) || over;
      mouse(over, "pointermove", x, y, { buttons: 1 });
      mouse(over, "mousemove", x, y, { buttons: 1 });
      if (dt) {
        if (over !== lastOver) { if (lastOver) dev("dragleave", lastOver, x, y); dev("dragenter", over, x, y); lastOver = over; }
        dev("dragover", over, x, y);
        dev("drag", dragEl, x, y);
      }
      await tick(20);
    }
    const end = deepElementFromPoint(a.x2, a.y2) || over;
    if (dt) { dev("drop", end, a.x2, a.y2); dev("dragend", dragEl, a.x2, a.y2); }
    mouse(end, "pointerup", a.x2, a.y2, { button: 0 });
    mouse(end, "mouseup", a.x2, a.y2, { button: 0 });
    return { text: `Dragged from ${describe(src)} to ${describe(end)}${dt ? " (HTML5 drag & drop)" : ""}` };
  }

  // ---------------------------------------------------------- uploads
  function toFiles(list) {
    return list.map((f) => {
      const bin = atob(f.data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], f.name, { type: f.mimeType || "application/octet-stream" });
    });
  }

  async function doUpload(a) {
    const files = toFiles(a.files || []);
    let dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    let el, x, y;
    if (a.ref) {
      el = elFor(a.ref);
      if (el.tagName === "INPUT" && (el.type || "").toLowerCase() === "file") {
        FX.activity();
        el.files = dt.files;
        el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { text: `${files.length} file(s) set on ${describe(el)}: ${files.map((f) => f.name).join(", ")}` };
      }
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2;
    } else if (typeof a.x === "number") {
      x = a.x; y = a.y; el = deepElementFromPoint(x, y);
      if (!el) throw new Error("No element at that point.");
    } else throw new Error("Provide ref (file input or element) or coordinate (drop location).");
    await FX.moveTo(x, y); FX.pulse();
    dt = pageDT();
    for (const f of files) dt.items.add(f);
    for (const type of ["dragenter", "dragover", "drop"]) el.dispatchEvent(dragEvent(type, x, y, dt));
    return { text: `${files.length} file(s) dropped on ${describe(el)}: ${files.map((f) => f.name).join(", ")}` };
  }

  async function doHover(args) {
    const { el, x, y } = target(args);
    await FX.moveTo(x, y);
    for (const t of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"])
      mouse(el, t, x, y, t.endsWith("enter") ? { bubbles: false } : {});
    return { text: `Mouse over ${describe(el)}` };
  }

  // ---------------------------------------------------------- keyboard / text
  function activeDeep() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    while (a && a.tagName === "IFRAME") {
      try { const d = a.contentDocument; if (!d || !d.activeElement) break; a = d.activeElement; } catch (e) { break; }
    }
    return a;
  }

  const isTextInput = (el) => el && ((el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color"].includes((el.type || "").toLowerCase())) || el.tagName === "TEXTAREA");

  function fireInput(el, inputType, data) {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType, data }));
  }

  function insertText(el, text) {
    if (isTextInput(el)) {
      let start = el.value.length, end = start;
      try { if (el.selectionStart !== null) { start = el.selectionStart; end = el.selectionEnd; } } catch (e) { /* email/number */ }
      el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: text }));
      const v = el.value;
      el.value = v.slice(0, start) + text + v.slice(end);
      try { el.setSelectionRange(start + text.length, start + text.length); } catch (e) { /* not supported */ }
      fireInput(el, "insertText", text);
      return true;
    }
    if (el && el.isContentEditable) {
      el.focus();
      if (!document.execCommand("insertText", false, text)) {
        const sel = getSelection();
        if (sel.rangeCount) { const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(text)); r.collapse(false); }
        else el.append(text);
        fireInput(el, "insertText", text);
      }
      return true;
    }
    return false;
  }

  const KEYCODES = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, " ": 32, ArrowLeft: 37, ArrowUp: 38,
    ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
  const ALIASES = { enter: "Enter", return: "Enter", tab: "Tab", esc: "Escape", escape: "Escape", backspace: "Backspace",
    delete: "Delete", del: "Delete", space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
    arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight", home: "Home", end: "End",
    pageup: "PageUp", pagedown: "PageDown" };

  function tabbables() {
    return Array.from(document.querySelectorAll("a[href],button,input,select,textarea,[tabindex],[contenteditable='true']"))
      .filter((e) => !e.disabled && e.tabIndex >= 0 && visible(e) && (e.type || "") !== "hidden");
  }

  function pressOne(combo) {
    const parts = combo.split("+");
    let k = parts.pop();
    const m = mods(parts.join("+"));
    k = ALIASES[k.toLowerCase()] || (k.length === 1 ? k : k[0].toUpperCase() + k.slice(1));
    const el = activeDeep() || document.body;
    const code = k.length === 1 ? (/[a-z]/i.test(k) ? "Key" + k.toUpperCase() : /\d/.test(k) ? "Digit" + k : "") : k;
    const kc = KEYCODES[k] || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
    const init = { key: k, code, keyCode: kc, which: kc, bubbles: true, cancelable: true, composed: true, ...m };
    const notPrevented = el.dispatchEvent(new KeyboardEvent("keydown", init));
    if (notPrevented && k.length === 1 && !m.ctrlKey && !m.metaKey && !m.altKey)
      el.dispatchEvent(new KeyboardEvent("keypress", { ...init, charCode: k.charCodeAt(0) }));
    if (notPrevented) defaultAction(el, k, m);
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  function defaultAction(el, k, m) {
    const text = isTextInput(el) || (el && el.isContentEditable);
    if (m.ctrlKey || m.metaKey) {
      if (k.toLowerCase() === "a") {
        if (isTextInput(el)) el.select();
        else if (el && el.isContentEditable) document.execCommand("selectAll");
        else getSelection().selectAllChildren(document.body);
      }
      return;
    }
    if (k.length === 1) { if (text) insertText(el, k); else if (k === " " && el && el.matches && el.matches("button,[role=button],input[type=checkbox],input[type=radio]")) el.click(); else if (k === " ") scrollBy(0, innerHeight * 0.8); return; }
    switch (k) {
      case "Enter":
        if (el.tagName === "TEXTAREA" || (el && el.isContentEditable)) insertText(el, "\n");
        else if (el.tagName === "INPUT" && el.form) {
          const btn = el.form.querySelector("button[type=submit],input[type=submit],button:not([type])");
          if (btn) btn.click(); else el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
        } else if (el.matches && el.matches("a[href],button,[role=button],[role=link],summary")) el.click();
        break;
      case "Tab": {
        const list = tabbables();
        let i = list.indexOf(el);
        i = m.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
        if (list[i]) list[i].focus();
        break;
      }
      case "Backspace":
      case "Delete":
        if (isTextInput(el)) {
          let s = el.value.length, e = s;
          try { s = el.selectionStart; e = el.selectionEnd; } catch (x) { /* */ }
          if (s === e) { if (k === "Backspace" && s > 0) s--; else if (k === "Delete") e++; }
          el.value = el.value.slice(0, s) + el.value.slice(e);
          try { el.setSelectionRange(s, s); } catch (x) { /* */ }
          fireInput(el, k === "Backspace" ? "deleteContentBackward" : "deleteContentForward", null);
        } else if (el && el.isContentEditable) document.execCommand(k === "Backspace" ? "delete" : "forwardDelete");
        break;
      case "PageDown": if (!text) scrollBy(0, innerHeight * 0.85); break;
      case "PageUp": if (!text) scrollBy(0, -innerHeight * 0.85); break;
      case "Home": if (!text) scrollTo(scrollX, 0); break;
      case "End": if (!text) scrollTo(scrollX, document.documentElement.scrollHeight); break;
      case "ArrowDown": if (!text && el.tagName !== "SELECT") scrollBy(0, 60); break;
      case "ArrowUp": if (!text && el.tagName !== "SELECT") scrollBy(0, -60); break;
    }
  }

  function centerOf(el) { const r = el.getBoundingClientRect(); return [r.left + Math.min(r.width / 2, 40), r.top + r.height / 2]; }

  async function doType(args) {
    if (args.ref) {
      const el = elFor(args.ref); el.scrollIntoView({ block: "center", behavior: "instant" });
      await FX.moveTo(...centerOf(el)); FX.pulse(); el.focus();
    } else FX.activity();
    const el = activeDeep();
    if (!el || el === document.body) throw new Error("No focused element. Click into a field first or provide a ref.");
    const text = String(args.text);
    if (!isTextInput(el) && !el.isContentEditable) throw new Error(`Focused element (${describe(el)}) is not a text field.`);
    for (const ch of text) {
      const init = { key: ch === "\n" ? "Enter" : ch, bubbles: true, cancelable: true, composed: true };
      const ok = el.dispatchEvent(new KeyboardEvent("keydown", init));
      if (ok) {
        el.dispatchEvent(new KeyboardEvent("keypress", init));
        if (ch === "\n" && el.tagName === "INPUT") defaultAction(el, "Enter", {});
        else insertText(el, ch);
      }
      el.dispatchEvent(new KeyboardEvent("keyup", init));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { text: `Typed into ${describe(el)}` };
  }

  function doKey(args) {
    FX.activity();
    const seq = String(args.keys).trim().split(/\s+/);
    const n = Math.max(1, Math.min(100, Number(args.repeat) || 1));
    for (let i = 0; i < n; i++) for (const c of seq) pressOne(c);
    const el = activeDeep();
    return { text: `Keys ${args.keys}${n > 1 ? ` x${n}` : ""}; focus now on ${el ? describe(el) : "nothing"}` };
  }

  async function doFormInput(args) {
    const el = elFor(args.ref);
    const v = args.value;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    await FX.moveTo(...centerOf(el)); FX.pulse();
    if (el.tagName === "SELECT") {
      const want = Array.isArray(v) ? v.map(String) : [String(v)];
      let hit = 0;
      for (const o of el.options) {
        const match = want.some((w) => o.value === w || o.text.trim() === w || o.text.trim().toLowerCase() === w.toLowerCase());
        if (el.multiple) o.selected = match; else if (match && !hit) { el.value = o.value; }
        if (match) hit++;
      }
      if (!hit) throw new Error(`No option "${want.join(", ")}". Options: ${Array.from(el.options).map((o) => o.text.trim()).join(" | ")}`);
    } else if (el.type === "checkbox" || el.type === "radio" || ["checkbox", "switch", "radio"].includes(el.getAttribute("role"))) {
      const want = v === true || v === "true" || v === 1 || v === "on";
      const cur = el.checked !== undefined ? el.checked : el.getAttribute("aria-checked") === "true";
      if (cur !== want) el.click();
      return { text: `${describe(el)} is now ${want ? "on" : "off"}` };
    } else if (isTextInput(el)) {
      el.focus();
      el.value = String(v);
      fireInput(el, "insertReplacementText", String(v));
    } else if (el.isContentEditable) {
      el.focus();
      el.textContent = String(v);
      fireInput(el, "insertReplacementText", String(v));
    } else {
      throw new Error(`${describe(el)} is not a form field.`);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { text: `${describe(el)} set` };
  }

  function scrollable(el) {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll|overlay)/.test(cs.overflowY + cs.overflowX) && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)) return e;
    }
    return null;
  }

  function doScroll(args) {
    FX.activity();
    if (args.ref && !args.direction) {
      const el = elFor(args.ref);
      el.scrollIntoView({ block: "center", behavior: "instant" });
      return { text: `${describe(el)} scrolled into view` };
    }
    const amt = (Number(args.amount) || 3) * 100;
    const d = args.direction || "down";
    const dx = d === "left" ? -amt : d === "right" ? amt : 0;
    const dy = d === "up" ? -amt : d === "down" ? amt : 0;
    let el = null;
    if (args.ref) el = elFor(args.ref);
    else if (typeof args.x === "number") el = deepElementFromPoint(args.x, args.y);
    const box = el && scrollable(el);
    if (box) box.scrollBy({ left: dx, top: dy, behavior: "instant" });
    else window.scrollBy({ left: dx, top: dy, behavior: "instant" });
    return { text: `Scrolled ${d} ${amt}px${box ? " in " + describe(box) : ""}; page scroll now ${Math.round(scrollX)},${Math.round(scrollY)}` };
  }

  // ---------------------------------------------------------- ops
  const OPS = {
    ping: () => ({ ok: true }),
    overlay: (a) => { FX.setVisible(a.visible !== false); return { ok: true }; },
    overlay_state: (a) => { FX.setActive(!!a.active); return { ok: true }; },
    viewport: () => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, sx: scrollX, sy: scrollY }),
    drag: doDrag,
    upload: doUpload,
    read_page(a) {
      const root = a.ref_id ? elFor(a.ref_id) : document.body || document.documentElement;
      const max = Number(a.max_chars) || 50000;
      return { text: header() + buildTree(root, a.filter === "interactive", max, Number(a.depth) || 1000) };
    },
    find(a) {
      const q = String(a.query || "").toLowerCase();
      if (!q) throw new Error("Empty query.");
      const tree = buildTree(document.body, false, 2000000).split("\n");
      const hits = tree.map((l) => l.trim()).filter((l) => l.toLowerCase().includes(q)).slice(0, 20);
      return { text: hits.length ? hits.join("\n") : `Nothing found for "${a.query}".` };
    },
    get_page_text(a) {
      const max = Number(a.max_chars) || 50000;
      const main = document.querySelector("main,[role=main],article") || document.body;
      let t = (main && main.innerText) || "";
      if (main !== document.body && t.trim().length < 200) t = document.body.innerText;
      t = t.replace(/\n{3,}/g, "\n\n");
      return { text: header() + "\n" + (t.length > max ? t.slice(0, max) + "\n… (truncated)" : t) };
    },
    click: doClick,
    hover: doHover,
    type: doType,
    key: doKey,
    form_input: doFormInput,
    scroll: doScroll,
    console(a) {
      let l = logs;
      if (a.onlyErrors) l = l.filter((x) => x.level === "error");
      if (a.pattern) l = l.filter((x) => x.msg.includes(a.pattern));
      l = l.slice(-(Number(a.limit) || 50));
      return { text: l.length ? l.map((x) => `[${x.t}] ${x.level}: ${x.msg}`).join("\n") : "No console messages captured." };
    },
  };

  browser.runtime.onMessage.addListener((msg) => {
    const fn = OPS[msg && msg.op];
    if (!fn) return Promise.resolve({ error: "Unknown op " + (msg && msg.op) });
    return Promise.resolve()
      .then(() => fn(msg.args || {}))
      .catch((e) => ({ error: String((e && e.message) || e) }));
  });
})();
