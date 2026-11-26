/* Claude in Firefox - background (persistent, MV2).
 * Long-polls the local bridge hub for commands and executes them.
 *
 * Safety model (like Claude in Chrome): Claude may only act on tabs in its own
 * orange "Claude" tab group. A tab of the user's only joins that group through
 * tabs_adopt, which Claude is told to use only when the user asks for it. */
"use strict";

// Connection settings: from the options page (storage.local), or for the local
// development build from config.js (global BRIDGE). The signed build ships no token.
const DEFAULT_PORT = 18765;
const DEV = typeof BRIDGE !== "undefined" ? BRIDGE : {};
let CFG = { port: DEV.port || DEFAULT_PORT, token: DEV.token || "" };

async function loadConfig() {
  let saved = {};
  try { saved = (await browser.storage.local.get("bridge")).bridge || {}; } catch (e) { /* */ }
  CFG = { port: Number(saved.port) || DEV.port || DEFAULT_PORT, token: saved.token || DEV.token || "" };
}
browser.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.bridge) loadConfig(); });
browser.browserAction.onClicked.addListener(() => browser.runtime.openOptionsPage());

const base = () => `http://127.0.0.1:${CFG.port}`;
const hdr = () => ({ "X-Bridge-Token": CFG.token });
const HAS_GROUPS = !!(browser.tabs.group && browser.tabGroups);

const ownTabs = new Set();        // fallback membership when tab groups are unavailable
const shotScale = new Map();      // tabId -> image px per CSS px of the last full screenshot
const shots = new Map();          // imageId -> { dataUrl, tabId, at }
let shotCounter = 0;
let currentTab = null;            // last tab Claude worked in
let connected = null;

// state: "on" | "off" | "key" (no or wrong token)
function setBadge(state) {
  if (state === connected) return;
  connected = state;
  const name = browser.runtime.getManifest().name;
  const look = { on: ["ON", "#2E7D32", "connected to Claude Code"],
                 off: ["OFF", "#9E9E9E", "waiting for Claude Code (no active session)"],
                 key: ["KEY", "#C62828", "token missing or wrong - click to set it"] }[state];
  browser.browserAction.setBadgeText({ text: look[0] });
  browser.browserAction.setBadgeBackgroundColor({ color: look[1] });
  browser.browserAction.setTitle({ title: `${name}: ${look[2]}` });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// returns true only when the hub actually received it, so a hub that starts
// later (another Claude session) still learns the extension version
async function hello() {
  try {
    const r = await fetch(`${base()}/hello`, {
      method: "POST",
      headers: { ...hdr(), "Content-Type": "application/json" },
      body: JSON.stringify({ ua: navigator.userAgent, version: browser.runtime.getManifest().version }),
    });
    return r.ok;
  } catch (e) { return false; /* hub not up yet */ }
}

async function pollLoop() {
  await loadConfig();
  setBadge("off");
  let greeted = false;
  let lostSince = 0;
  for (;;) {
    if (!CFG.token) { setBadge("key"); await sleep(2000); continue; }
    if (!greeted) greeted = await hello();
    let resp;
    try {
      resp = await fetch(`${base()}/poll`, { headers: hdr(), cache: "no-store" });
    } catch (e) {
      setBadge("off");
      greeted = false;
      // Claude session gone for a while: its task is over
      if (!lostSince) lostSince = Date.now();
      else if (Date.now() - lostSince > LOST_DONE_MS) finishAll();
      await sleep(2000);
      continue;
    }
    if (resp.status === 403) { setBadge("key"); greeted = false; await sleep(5000); continue; }
    lostSince = 0;
    setBadge("on");
    if (resp.status !== 200) continue;
    let cmd;
    try { cmd = await resp.json(); } catch (e) { continue; }
    handle(cmd); // don't await: keep polling so parallel calls work
  }
}

async function handle(cmd) {
  let result;
  try {
    const fn = HANDLERS[cmd.method];
    if (!fn) throw new Error(`Unknown action: ${cmd.method}`);
    result = await fn(cmd.params || {});
  } catch (e) {
    result = { error: String((e && e.message) || e) };
  }
  try {
    await fetch(`${base()}/result`, {
      method: "POST",
      headers: { ...hdr(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: cmd.id, result }),
    });
  } catch (e) { /* hub gone; nothing to do */ }
}

// ------------------------------------------------------------ "Claude" tab group
// Title shows status emoji + task, e.g. "⏳ Claude: search Tame Impala" / "✅ Claude: ...".
const GROUP_NAME = "Claude";
const EMOJI = { working: "⏳", done: "✅" };
// The task is only marked done when Claude says so (set_task status=done).
// Safety nets: no command at all for 10 minutes, or the Claude session gone.
const IDLE_DONE_MS = 10 * 60 * 1000;
const LOST_DONE_MS = 20000;
const groupByWindow = new Map();   // windowId -> groupId
const groupState = new Map();      // windowId -> { task, status, timer }

function groupTitle(windowId) {
  const st = groupState.get(windowId) || {};
  const task = (st.task || "").trim();
  return `${EMOJI[st.status] || ""} ${GROUP_NAME}${task ? ": " + task : ""}`.trim();
}

async function applyTitle(windowId) {
  const gid = groupByWindow.get(windowId);
  if (gid === undefined || !HAS_GROUPS) return;
  try { await browser.tabGroups.update(gid, { title: groupTitle(windowId), color: "orange" }); } catch (e) { /* group gone */ }
}

function setStatus(windowId, status, task) {
  const st = groupState.get(windowId) || { task: "", status: "", timer: null };
  const newTask = task !== undefined ? String(task).slice(0, 60) : st.task;
  const changed = st.status !== status || st.task !== newTask;
  st.task = newTask;
  clearTimeout(st.timer);
  st.status = status;
  if (status === "working") st.timer = setTimeout(() => setStatus(windowId, "done"), IDLE_DONE_MS);
  groupState.set(windowId, st);
  if (changed) applyTitle(windowId);   // only touch the group title when something changed
  syncOverlay(windowId);
}

const isWorking = (windowId) => (groupState.get(windowId) || {}).status === "working";

// Orange glow + cursor: on in the tab Claude is working in while the task runs, off when done.
const overlayShown = new Map();   // tabId -> bool last sent
async function syncOverlay(windowId) {
  let tabs = [];
  try { tabs = await claudeTabsList(); } catch (e) { return; }
  for (const t of tabs) {
    if (t.windowId !== windowId) continue;
    const on = isWorking(windowId) && t.id === currentTab;
    if (overlayShown.get(t.id) === on) continue;
    overlayShown.set(t.id, on);
    browser.tabs.sendMessage(t.id, { op: "overlay_state", args: { active: on } }).catch(() => overlayShown.delete(t.id));
  }
}

function finishAll() {
  for (const [w, st] of groupState) if (st.status === "working") setStatus(w, "done");
}

// a freshly loaded page asks whether it should show the glow
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.op === "overlay_query" && sender.tab) {
    const t = sender.tab;
    const on = isWorking(t.windowId) && t.id === currentTab;
    overlayShown.set(t.id, on);
    return Promise.resolve({ active: on });
  }
  return undefined;
});

async function findClaudeGroup(windowId) {
  if (!HAS_GROUPS) return undefined;
  let gid = groupByWindow.get(windowId);
  if (gid !== undefined) {
    try { await browser.tabGroups.get(gid); return gid; } catch (e) { groupByWindow.delete(windowId); }
  }
  // after an extension reload: reuse an existing Claude group in this window
  try {
    const groups = await browser.tabGroups.query({ windowId });
    const g = groups.find((x) => /(^|\s)Claude(:|$)/.test(x.title || ""));
    if (g) {
      groupByWindow.set(windowId, g.id);
      if (!groupState.has(windowId)) {
        const m = /Claude: (.*)$/.exec(g.title || "");
        groupState.set(windowId, { task: m ? m[1] : "", status: "", timer: null });
      }
      return g.id;
    }
  } catch (e) { /* ignore */ }
  return undefined;
}

async function isClaudeTab(tab) {
  if (!HAS_GROUPS) return ownTabs.has(tab.id);
  const gid = await findClaudeGroup(tab.windowId);
  return gid !== undefined && tab.groupId === gid;
}

async function addToClaudeGroup(tabOrId) {
  const tab = typeof tabOrId === "number" ? await browser.tabs.get(tabOrId) : tabOrId;
  ownTabs.add(tab.id);
  if (!HAS_GROUPS) return;
  if (tab.pinned) await browser.tabs.update(tab.id, { pinned: false });
  const gid = await findClaudeGroup(tab.windowId);
  if (gid !== undefined) {
    if (tab.groupId !== gid) await browser.tabs.group({ tabIds: [tab.id], groupId: gid });
  } else {
    const newId = await browser.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
    groupByWindow.set(tab.windowId, newId);
    setStatus(tab.windowId, "working");
    await applyTitle(tab.windowId);   // new group: always give it its title (setStatus only writes on changes)
    return;
  }
  setStatus(tab.windowId, "working");
}

async function claudeTabsList() {
  const all = await browser.tabs.query({});
  const out = [];
  for (const t of all) if (await isClaudeTab(t)) out.push(t);
  return out;
}

const NOT_OURS = (t) => new Error(
  `Tab ${t.id} does not belong to Claude (it is not in the orange Claude tab group). ` +
  `Work in a tab of your own (tabs_create). Only if the user explicitly asks you to use one of their own tabs: tabs_adopt.`);

// Resolve the tab to act on; only Claude's own tabs are allowed.
async function resolveTab(tabId, { create = false } = {}) {
  if (tabId !== undefined && tabId !== null) {
    const t = await browser.tabs.get(Number(tabId));
    if (!(await isClaudeTab(t))) throw NOT_OURS(t);
    currentTab = t.id;
    return t;
  }
  if (currentTab !== null) {
    try {
      const t = await browser.tabs.get(currentTab);
      if (await isClaudeTab(t)) return t;
    } catch (e) { /* closed */ }
    currentTab = null;
  }
  const mine = await claudeTabsList();
  if (mine.length) {
    const t = mine.find((x) => x.active) || mine[0];
    currentTab = t.id;
    return t;
  }
  if (create) {
    const t = await browser.tabs.create({ active: true });
    await addToClaudeGroup(t);
    currentTab = t.id;
    return browser.tabs.get(t.id);
  }
  throw new Error("Claude has no tab of its own yet. Use tabs_create.");
}

// tab Claude is actively driving: mark the group as working
async function workTab(tabId, opts) {
  const t = await resolveTab(tabId, opts);
  setStatus(t.windowId, "working");
  return t;
}

function tabInfo(t) {
  return { tabId: t.id, windowId: t.windowId, title: t.title, url: t.url, active: t.active, status: t.status };
}

async function waitForLoad(tabId, timeoutMs = 30000) {
  const start = Date.now();
  let sawLoading = false;
  while (Date.now() - start < timeoutMs) {
    const t = await browser.tabs.get(tabId);
    if (t.status === "loading") sawLoading = true;
    if (t.status === "complete" && (sawLoading || Date.now() - start > 1200)) return t;
    await sleep(150);
  }
  return browser.tabs.get(tabId);
}

function normalizeUrl(u) {
  u = String(u).trim();
  if (/^(about:|https?:|file:|moz-extension:|data:|view-source:)/i.test(u)) return u;
  if (/^localhost(:\d+)?(\/|$)/i.test(u) || /^127\.0\.0\.1/.test(u)) return "http://" + u;
  return "https://" + u;
}

async function ensureContent(tabId) {
  try {
    const r = await browser.tabs.sendMessage(tabId, { op: "ping" });
    if (r && r.ok) return;
  } catch (e) { /* not injected yet */ }
  try {
    await browser.tabs.executeScript(tabId, { file: "content.js", runAt: "document_idle" });
  } catch (e) {
    const t = await browser.tabs.get(tabId);
    throw new Error(`Cannot work in this page (${t.url}). Firefox does not allow extensions on about: pages, addons.mozilla.org and similar protected pages.`);
  }
}

async function content(tabId, op, args = {}) {
  await ensureContent(tabId);
  const r = await browser.tabs.sendMessage(tabId, { op, args });
  if (r && r.error) throw new Error(r.error);
  return r;
}

// screenshot coordinates -> CSS px
function scaled(tabId, p) {
  const s = shotScale.get(tabId) || 1;
  const q = { ...p };
  for (const k of ["x", "y", "x2", "y2"]) if (typeof q[k] === "number") q[k] = q[k] / s;
  if (Array.isArray(q.coordinate)) { q.x = q.coordinate[0] / s; q.y = q.coordinate[1] / s; }
  if (Array.isArray(q.start_coordinate)) { q.x = q.start_coordinate[0] / s; q.y = q.start_coordinate[1] / s; }
  if (Array.isArray(q.end_coordinate)) { q.x2 = q.end_coordinate[0] / s; q.y2 = q.end_coordinate[1] / s; }
  return q;
}

function loadImage(src) {
  return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
}

function resizeDataUrl(img, w, h, type = "image/jpeg", quality = 0.8) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}

const b64of = (dataUrl) => dataUrl.slice(dataUrl.indexOf(",") + 1);

function storeShot(dataUrl, tabId) {
  const id = `img_${Date.now().toString(36)}_${++shotCounter}`;
  shots.set(id, { dataUrl, tabId, at: Date.now() });
  for (const [k, v] of shots) if (Date.now() - v.at > 10 * 60000 || shots.size > 30) shots.delete(k);
  return id;
}

async function captureVisible(t, { include_overlay = false, rect = null, targetWidth = 1366 } = {}) {
  if (!t.active) {
    await browser.tabs.update(t.id, { active: true });
    await sleep(250);
  }
  let vp = { w: 1280, h: 800, sx: 0, sy: 0, dpr: 1 };
  try { vp = await content(t.id, "viewport"); } catch (e) { /* protected page: still try */ }
  let zoom = 1;
  try { zoom = await browser.tabs.getZoom(t.id); } catch (e) { /* default 1 */ }
  const cssW = rect ? rect.width : vp.w;
  // captureTab's scale ignores page zoom (e.g. 110%), so correct for it
  const want = Math.min(rect ? (vp.dpr || 1) : 1, targetWidth / Math.max(1, cssW)) / zoom;
  let hid = false;
  if (!include_overlay) { try { await content(t.id, "overlay", { visible: false }); hid = true; } catch (e) { /* */ } }
  let dataUrl;
  try {
    const opts = { format: "jpeg", quality: 80, scale: want };
    if (rect) opts.rect = { x: rect.x + (vp.sx || 0), y: rect.y + (vp.sy || 0), width: rect.width, height: rect.height };
    dataUrl = await browser.tabs.captureTab(t.id, opts);
  } finally {
    if (hid) { try { await content(t.id, "overlay", { visible: true }); } catch (e) { /* */ } }
  }
  const img = await loadImage(dataUrl);
  return { dataUrl, img, vp };
}

// ------------------------------------------------------------ network log
const net = new Map();        // tabId -> { host, list: [] }
const netById = new Map();    // requestId -> entry
const SENSITIVE = /^(token|access_token|id_token|key|api_key|apikey|auth|authorization|password|pass|pwd|secret|sig|signature|code|session|sid|jwt)$/i;

function redact(url) {
  try {
    const u = new URL(url);
    if (u.username || u.password) { u.username = "REDACTED"; u.password = ""; }
    for (const k of [...u.searchParams.keys()]) if (SENSITIVE.test(k)) u.searchParams.set(k, "REDACTED");
    return u.toString();
  } catch (e) { return url; }
}

browser.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0) return;
  let rec = net.get(d.tabId);
  let host = "";
  try { host = new URL(d.url).host; } catch (e) { /* */ }
  if (d.type === "main_frame") {
    if (!rec || rec.host !== host) { rec = { host, list: [] }; net.set(d.tabId, rec); }
  }
  if (!rec) { rec = { host: "", list: [] }; net.set(d.tabId, rec); }
  const e = { id: d.requestId, t: new Date(d.timeStamp).toISOString().slice(11, 23), method: d.method, type: d.type, url: redact(d.url), status: null };
  rec.list.push(e);
  if (rec.list.length > 500) rec.list.shift();
  netById.set(d.requestId, e);
}, { urls: ["<all_urls>"] });

browser.webRequest.onCompleted.addListener((d) => {
  const e = netById.get(d.requestId);
  if (e) { e.status = d.statusCode; e.fromCache = d.fromCache || undefined; netById.delete(d.requestId); }
}, { urls: ["<all_urls>"] });

browser.webRequest.onErrorOccurred.addListener((d) => {
  const e = netById.get(d.requestId);
  if (e) { e.status = "ERR " + d.error; netById.delete(d.requestId); }
}, { urls: ["<all_urls>"] });

// ------------------------------------------------------------ handlers
const HANDLERS = {
  async tabs_context({ all }) {
    const mine = await claudeTabsList();
    const claudeGroups = [];
    for (const [w, gid] of groupByWindow) {
      try { const g = await browser.tabGroups.get(gid); claudeGroups.push({ windowId: w, title: g.title }); } catch (e) { /* gone */ }
    }
    const out = { currentTab, claudeGroups, claudeTabs: mine.map(tabInfo) };
    if (!mine.length) out.hint = "No Claude tabs yet: use tabs_create.";
    if (all) {
      const others = (await browser.tabs.query({})).filter((t) => !mine.some((m) => m.id === t.id));
      out.userTabs = others.map((t) => ({ tabId: t.id, title: t.title, active: t.active }));
      out.note = "userTabs belong to the user: do not operate them; only tabs_adopt if the user explicitly asks for it.";
    }
    return { text: JSON.stringify(out, null, 1) };
  },

  async tabs_create({ url, active }) {
    const t = await browser.tabs.create({ url: url ? normalizeUrl(url) : undefined, active: active !== false });
    currentTab = t.id;
    await addToClaudeGroup(t);
    const done = url ? await waitForLoad(t.id) : await browser.tabs.get(t.id);
    return tabInfo(done);
  },

  async tabs_adopt({ tabId }) {
    const t = await browser.tabs.get(Number(tabId));
    await addToClaudeGroup(t);
    currentTab = t.id;
    return { text: `Tab ${t.id} (${t.title}) is now in the Claude tab group.` };
  },

  async set_task({ task, status, tabId }) {
    let windowId;
    try { windowId = (await resolveTab(tabId)).windowId; }
    catch (e) { windowId = (await browser.windows.getLastFocused()).id; }
    await findClaudeGroup(windowId);
    setStatus(windowId, status === "done" ? "done" : "working", task);
    return { text: `Tab group: ${groupTitle(windowId)}${groupByWindow.has(windowId) ? "" : " (the group appears as soon as Claude uses a tab)"}` };
  },

  async tabs_close({ tabId }) {
    const t = await resolveTab(tabId);
    await browser.tabs.remove(t.id);
    ownTabs.delete(t.id);
    if (currentTab === t.id) currentTab = null;
    return { text: "Tab closed." };
  },

  async tabs_select({ tabId }) {
    const t0 = await resolveTab(tabId);
    const t = await browser.tabs.update(t0.id, { active: true });
    await browser.windows.update(t.windowId, { focused: true });
    return tabInfo(t);
  },

  async navigate({ url, tabId }) {
    const u = String(url).trim().toLowerCase();
    const nav = !["back", "forward", "reload"].includes(u);
    const t = await workTab(tabId, { create: nav && (tabId === undefined || tabId === null) });
    if (u === "back") await browser.tabs.goBack(t.id);
    else if (u === "forward") await browser.tabs.goForward(t.id);
    else if (u === "reload") await browser.tabs.reload(t.id);
    else await browser.tabs.update(t.id, { url: normalizeUrl(url) });
    return tabInfo(await waitForLoad(t.id));
  },

  async screenshot({ tabId, include_overlay, scale }) {
    const t = await resolveTab(tabId);
    const { dataUrl, img, vp } = await captureVisible(t, { include_overlay });
    const frame = img.naturalWidth / Math.max(1, vp.w);
    shotScale.set(t.id, frame);
    const imageId = storeShot(dataUrl, t.id);
    let out = dataUrl;
    const s = Math.max(0.1, Math.min(1, Number(scale) || 1));
    if (s < 1) out = resizeDataUrl(img, img.naturalWidth * s, img.naturalHeight * s);
    return {
      image: b64of(out), mimeType: "image/jpeg", imageId,
      text: `Tab ${t.id}: ${t.title} (${t.url})\nimageId: ${imageId}\n` +
            `Coordinate frame: ${img.naturalWidth}x${img.naturalHeight}` +
            (s < 1 ? ` (image scaled down to ${Math.round(s * 100)}%; coordinates stay in the full frame)` : "") +
            `. Use these coordinates directly for click/hover/scroll/drag/zoom.`,
    };
  },

  async zoom({ tabId, region, scale }) {
    const t = await resolveTab(tabId);
    if (!Array.isArray(region) || region.length !== 4) throw new Error("region must be [x0, y0, x1, y1] (coordinates from the last screenshot).");
    const f = shotScale.get(t.id) || 1;
    const [x0, y0, x1, y1] = region.map(Number);
    const rect = { x: Math.min(x0, x1) / f, y: Math.min(y0, y1) / f, width: Math.abs(x1 - x0) / f, height: Math.abs(y1 - y0) / f };
    if (rect.width < 2 || rect.height < 2) throw new Error("Region is too small.");
    const { dataUrl, img } = await captureVisible(t, { rect });
    let out = dataUrl;
    const s = Math.max(0.1, Math.min(1, Number(scale) || 1));
    if (s < 1) out = resizeDataUrl(img, img.naturalWidth * s, img.naturalHeight * s);
    const imageId = storeShot(dataUrl, t.id);
    return { image: b64of(out), mimeType: "image/jpeg", imageId,
             text: `Zoomed in on [${region.join(", ")}] (${Math.round(rect.width)}x${Math.round(rect.height)} CSS px). imageId: ${imageId}. Click coordinates remain those of the regular screenshot.` };
  },

  async read_page({ tabId, filter, max_chars, ref_id, depth }) {
    const t = await resolveTab(tabId);
    return content(t.id, "read_page", { filter, max_chars, ref_id, depth });
  },

  async find({ query, tabId }) {
    const t = await resolveTab(tabId);
    return content(t.id, "find", { query });
  },

  async get_page_text({ tabId, max_chars }) {
    const t = await resolveTab(tabId);
    return content(t.id, "get_page_text", { max_chars });
  },

  async click(p) {
    const t = await workTab(p.tabId);
    return content(t.id, "click", scaled(t.id, p));
  },

  async drag(p) {
    const t = await workTab(p.tabId);
    const f = shotScale.get(t.id) || 1;
    const [a, b] = [p.start_coordinate, p.coordinate];
    if (!Array.isArray(a) || !Array.isArray(b)) throw new Error("Provide start_coordinate and coordinate as [x, y].");
    return content(t.id, "drag", { x: a[0] / f, y: a[1] / f, x2: b[0] / f, y2: b[1] / f });
  },

  async hover(p) {
    const t = await workTab(p.tabId);
    return content(t.id, "hover", scaled(t.id, p));
  },

  async type(p) {
    const t = await workTab(p.tabId);
    return content(t.id, "type", p);
  },

  async key(p) {
    const t = await workTab(p.tabId);
    return content(t.id, "key", p);
  },

  async form_input(p) {
    const t = await workTab(p.tabId);
    return content(t.id, "form_input", p);
  },

  async scroll(p) {
    const t = await workTab(p.tabId);
    return content(t.id, "scroll", scaled(t.id, p));
  },

  async scroll_to({ ref, tabId }) {
    const t = await workTab(tabId);
    return content(t.id, "scroll", { ref });
  },

  async file_upload(p) {
    const t = await workTab(p.tabId);
    if (!Array.isArray(p.files) || !p.files.length) throw new Error("No files.");
    return content(t.id, "upload", scaled(t.id, { ref: p.ref, coordinate: p.coordinate, files: p.files }));
  },

  async upload_image(p) {
    const t = await workTab(p.tabId);
    const shot = shots.get(String(p.imageId));
    if (!shot) throw new Error(`imageId ${p.imageId} is unknown or expired. Take a new screenshot and use its imageId.`);
    const img = await loadImage(shot.dataUrl);
    const png = resizeDataUrl(img, img.naturalWidth, img.naturalHeight, "image/png");
    const name = p.filename || "image.png";
    return content(t.id, "upload", scaled(t.id, { ref: p.ref, coordinate: p.coordinate,
      files: [{ name, mimeType: "image/png", data: b64of(png) }] }));
  },

  async read_console_messages(p) {
    const t = await resolveTab(p.tabId);
    return content(t.id, "console", p);
  },

  async read_network_requests({ tabId, urlPattern, limit, clear }) {
    const t = await resolveTab(tabId);
    const rec = net.get(t.id);
    let list = rec ? rec.list : [];
    if (urlPattern) list = list.filter((e) => e.url.includes(urlPattern));
    list = list.slice(-(Number(limit) || 100));
    if (clear && rec) rec.list = [];
    const text = list.length
      ? list.map((e) => `[${e.t}] ${e.method} ${e.status === null ? "…" : e.status} ${e.type} ${e.url}`).join("\n")
      : "No network requests recorded for this tab (since the extension loaded or the last domain change).";
    return { text };
  },

  async resize_window({ width, height, tabId }) {
    const t = await resolveTab(tabId);
    const w = await browser.windows.update(t.windowId, { state: "normal", width: Math.round(width), height: Math.round(height) });
    return { text: `Window is now ${w.width}x${w.height}.` };
  },

  /* @dev-only-start: runs code from outside the package; left out of the signed build (AMO policy) */
  async javascript({ code, tabId }) {
    const t = await resolveTab(tabId);
    let res;
    try {
      res = await browser.tabs.executeScript(t.id, { code: String(code) });
    } catch (e) {
      throw new Error(`JavaScript error: ${e && e.message ? e.message : e}`);
    }
    const v = res && res.length ? res[0] : undefined;
    let text;
    try { text = v === undefined ? "undefined" : JSON.stringify(v, null, 1); } catch (e) { text = String(v); }
    return { text };
  },
  /* @dev-only-end */
};

browser.tabs.onRemoved.addListener((id) => {
  ownTabs.delete(id);
  shotScale.delete(id);
  net.delete(id);
  if (currentTab === id) currentTab = null;
});

pollLoop();
