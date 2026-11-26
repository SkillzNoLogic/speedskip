// SpeedSkip: background script (service worker in Chrome/Opera, event page
// in Firefox/Zen).
//
// Supported shortener visited -> tab is sent to bypass.city (preferred) or
// Aizernal. For Aizernal, the exact original URL is stored per tab in
// storage.session; resolver.js asks for it and fills Aizernal's form.
// Known-but-unsupported shortener -> "Shortener unsupported" popup on the page.
// Also: right-click "Skip with SpeedSkip", keyboard shortcuts, recent-skips
// history with destinations, a skip counter, and "try the other service".

// Chrome/Opera: `chrome.*` (promise-based in MV3). Firefox/Zen: `browser.*`.
const ext = globalThis.browser ?? globalThis.chrome;

// Chrome loads domains.js here; Firefox lists it in manifest background.scripts.
if (typeof importScripts === "function" && !self.SpeedSkipRules) importScripts("domains.js");

const {
  RESOLVERS, classifyUrl, classifyForExplicitSkip, aizernalSupports, isResolverUrl,
} = self.SpeedSkipRules;

const TAG = "[SpeedSkip]";
const log = (...args) => console.log(TAG, ...args);
const warn = (...args) => console.warn(TAG, ...args);

const DEDUPE_MS = 10 * 1000;          // same tab + same URL = same navigation
const PENDING_TTL_MS = 15 * 60 * 1000; // how long Aizernal autofill stays armed
const SENT_TTL_MS = 10 * 60 * 1000;    // "recently sent to a resolver" window
const LOOP_WINDOW_MS = 2 * 60 * 1000;
const LOOP_MAX = 3;                    // same URL redirected this often -> stop
const HISTORY_MAX = 10;
const STATE_KEY = "autoResolverState";
const MENU_ID = "speedskip-link";

// Per-session state in ext.storage.session (survives service-worker
// suspension; cleared when the browser closes).
//   pending[tabId]      = { id, url, resolver, createdAt }  (Aizernal autofill)
//   committed[tabId]    = last committed top-level URL of the tab
//   opener[tabId]       = tab that opened this tab
//   lastRedirect[tabId] = { url, at }                       (event de-dupe)
//   sent[url]           = [timestamps the URL was sent to a resolver]
//   skipInTab[tabId]    = { id, url, resolver }  last skip shown in that tab
let state = {
  pending: {}, committed: {}, opener: {}, lastRedirect: {}, sent: {}, skipInTab: {},
};

// Settings, written by the popup to ext.storage.local.
const settings = {
  enabled: true,           // automatic skipping on/off
  customRules: [],         // "My sites": [{ domain, action }]
  shortcutsEnabled: true,  // keyboard shortcuts on/off
  openDestination: "same", // Aizernal: open the destination in "same" or "new" tab
};
const SETTING_KEYS = Object.keys(settings);

// Owned by this worker, stored in ext.storage.local.
let history = [];  // newest first: { id, url, resolver, via, at, destination }
let skipCount = 0;

function applySetting(key, value) {
  switch (key) {
    case "enabled": settings.enabled = value !== false; break;
    case "shortcutsEnabled": settings.shortcutsEnabled = value !== false; break;
    case "openDestination": settings.openDestination = value === "new" ? "new" : "same"; break;
    case "customRules": settings.customRules = Array.isArray(value) ? value : []; break;
  }
}

const ready = Promise.all([
  ext.storage.session.get(STATE_KEY)
    .then(data => {
      const saved = data && data[STATE_KEY];
      if (saved) state = { ...state, ...saved };
      prune();
    })
    .catch(err => warn("Could not restore state:", err)),
  ext.storage.local.get([...SETTING_KEYS, "history", "skipCount"])
    .then(data => {
      for (const key of SETTING_KEYS) if (key in data) applySetting(key, data[key]);
      history = Array.isArray(data.history) ? data.history : [];
      skipCount = Number.isFinite(data.skipCount) ? data.skipCount : 0;
    })
    .catch(err => warn("Could not read settings:", err)),
]).then(() => applyGlobalBadge());

ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const key of SETTING_KEYS) {
    if (key in changes) applySetting(key, changes[key].newValue);
  }
  if ("enabled" in changes) {
    log(`Automatic skipping turned ${settings.enabled ? "ON" : "OFF"}.`);
    applyGlobalBadge();
  }
  if ("enabled" in changes || "customRules" in changes) {
    // Refresh each tab's own badge/title so none keeps the old state.
    ext.tabs.query({})
      .then(tabs => tabs.forEach(tab => tab.url && updateBadge(tab.id, tab.url)))
      .catch(() => {});
  }
});

function classify(url) {
  return classifyUrl(url, settings.customRules);
}

function applyGlobalBadge() {
  ext.action.setBadgeText({ text: settings.enabled ? "" : "OFF" }).catch(() => {});
  ext.action.setBadgeBackgroundColor({ color: "#757575" }).catch(() => {});
  ext.action.setTitle({
    title: `SpeedSkip (${settings.enabled ? "on" : "off"})`,
  }).catch(() => {});
}

let saveChain = Promise.resolve();
function save() {
  // Serialize writes so an older snapshot never overwrites a newer one.
  saveChain = saveChain
    .then(() => ext.storage.session.set({ [STATE_KEY]: state }))
    .catch(err => warn("Could not save state:", err));
  return saveChain;
}

let saveLocalChain = Promise.resolve();
function saveHistory() {
  saveLocalChain = saveLocalChain
    .then(() => ext.storage.local.set({ history, skipCount }))
    .catch(err => warn("Could not save history:", err));
  return saveLocalChain;
}

function prune(now = Date.now()) {
  for (const [tabId, p] of Object.entries(state.pending)) {
    if (now - p.createdAt > PENDING_TTL_MS) delete state.pending[tabId];
  }
  for (const [url, times] of Object.entries(state.sent)) {
    const fresh = times.filter(t => now - t < SENT_TTL_MS);
    if (fresh.length) state.sent[url] = fresh;
    else delete state.sent[url];
  }
  for (const [tabId, r] of Object.entries(state.lastRedirect)) {
    if (now - r.at > DEDUPE_MS) delete state.lastRedirect[tabId];
  }
}

const TAB_KEYS = ["pending", "committed", "opener", "lastRedirect", "skipInTab"];

function forgetTab(tabId) {
  for (const key of TAB_KEYS) delete state[key][tabId];
}

async function getTab(tabId) {
  try { return await ext.tabs.get(tabId); } catch { return null; }
}

function isHttpUrl(url) {
  try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// True when the tab is on a resolver page, or was opened from one
// (e.g. Aizernal's "Open original link" button).
async function cameFromResolver(tabId) {
  if (isResolverUrl(state.committed[tabId])) return true;
  let openerId = state.opener[tabId];
  if (openerId == null) openerId = (await getTab(tabId))?.openerTabId;
  if (openerId == null) return false;
  const openerUrl = state.committed[openerId] ?? (await getTab(openerId))?.url;
  return isResolverUrl(openerUrl);
}

function isTopLevel(details) {
  if (details.frameId !== 0) return false;
  if (details.documentLifecycle === "prerender") return false; // speculative
  return Number.isInteger(details.tabId) && details.tabId >= 0;
}

// --- history & counter -------------------------------------------------------

function recordSkip(tabId, url, resolverKey, via) {
  const entry = {
    id: crypto.randomUUID(), url, resolver: resolverKey, via, at: Date.now(), destination: null,
  };
  history = [entry, ...history].slice(0, HISTORY_MAX);
  skipCount += 1;
  state.skipInTab[tabId] = { id: entry.id, url, resolver: resolverKey };
  saveHistory();
  save();
  return entry;
}

function setDestination(historyId, destination) {
  const entry = history.find(e => e.id === historyId);
  if (!entry || entry.destination === destination) return;
  entry.destination = destination;
  history = [...history]; // new reference for storage
  log("Destination found:", destination, "for", entry.url);
  saveHistory();
}

// A tab that was on a resolver page followed a link/redirect off it: that
// is the destination of the skip shown in it.
function maybeCaptureDestination(tabId, previousUrl, details) {
  const skip = state.skipInTab[tabId];
  if (!skip || !isResolverUrl(previousUrl)) return;
  if (isResolverUrl(details.url) || !isHttpUrl(details.url)) return;
  const qualifiers = details.transitionQualifiers || [];
  if (details.transitionType !== "link" || qualifiers.includes("forward_back")) return;
  setDestination(skip.id, details.url);
  delete state.skipInTab[tabId];
}

// --- core ------------------------------------------------------------------

async function consider(tabId, rawUrl, via) {
  if (!Number.isInteger(tabId) || tabId < 0 || !isHttpUrl(rawUrl)) return;
  await ready;
  if (!settings.enabled) return;
  const match = classify(rawUrl);
  if (!match || match.kind !== "supported") return;

  // Synchronous claim: the browser reports one navigation through several
  // events (onBeforeNavigate, webRequest redirect, onCommitted, tabs.onUpdated).
  const now = Date.now();
  const last = state.lastRedirect[tabId];
  if (last && last.url === rawUrl && now - last.at < DEDUPE_MS) return;
  state.lastRedirect[tabId] = { url: rawUrl, at: now };

  prune(now);
  const sentTimes = state.sent[rawUrl] || [];

  // Loop prevention 1: the user is leaving a resolver page for the original
  // link (or a resolver sent them back to it). Let it load normally.
  if (sentTimes.length && await cameFromResolver(tabId)) {
    log(`Not intercepting ${rawUrl}: it was opened from a resolver page.`);
    return;
  }
  // Loop prevention 2: the same URL keeps bouncing back.
  if (sentTimes.filter(t => now - t < LOOP_WINDOW_MS).length >= LOOP_MAX) {
    warn(`Redirect loop guard: ${rawUrl} was already sent ${LOOP_MAX} times ` +
         "in the last 2 minutes. Letting it load normally.");
    return;
  }

  log(`Detected ${match.domain} link via ${via} in tab ${tabId}:`, rawUrl);
  try {
    await sendTabToResolver(tabId, rawUrl, match.resolver, "auto");
  } catch {
    delete state.lastRedirect[tabId];
    save();
  }
}

// Stores the original URL for the tab (Aizernal autofill), navigates the tab
// to the resolver and records the skip. Throws if the navigation fails.
async function sendTabToResolver(tabId, rawUrl, resolverKey, via) {
  const resolver = RESOLVERS[resolverKey];
  const target = resolver.buildUrl(rawUrl);
  const now = Date.now();

  state.sent[rawUrl] = (state.sent[rawUrl] || []).concat(now);
  if (resolver.autofill) {
    state.pending[tabId] = {
      id: crypto.randomUUID(), url: rawUrl, resolver: resolverKey, createdAt: now,
    };
  } else {
    delete state.pending[tabId];
  }

  try {
    await save(); // must be persisted before the tab leaves
    if (resolver.autofill) log(`Stored original URL for tab ${tabId}:`, rawUrl);
    await ext.tabs.update(tabId, { url: target });
    log(`Sent tab ${tabId} to ${resolver.label}:`, target);
  } catch (err) {
    warn(`Redirect to ${resolver.label} failed for tab ${tabId}:`, err);
    delete state.pending[tabId];
    save();
    throw err;
  }
  return recordSkip(tabId, rawUrl, resolverKey, via);
}

// Opens a new tab for an explicit skip. The tab is created blank first so the
// pending URL is stored against its id before Aizernal's page can load in it.
async function openResolverTab(rawUrl, resolverKey, via, nextTo) {
  const props = { url: "about:blank", active: true };
  if (nextTo) {
    props.openerTabId = nextTo.id;
    if (Number.isInteger(nextTo.index)) props.index = nextTo.index + 1;
  }
  const tab = await ext.tabs.create(props);
  await sendTabToResolver(tab.id, rawUrl, resolverKey, via);
  return tab;
}

// Paste field, right-click menu and the skip shortcut. These work even when
// automatic skipping is off, and ignore "never skip" rules.
// sameTab: navigate that tab instead of opening a new one.
async function skipExplicitly(rawUrl, via, { sameTab = null, nextTo = null } = {}) {
  await ready;
  const match = classifyForExplicitSkip(rawUrl, settings.customRules);
  if (!match || match.kind !== "supported") {
    log(`${via}: link is not supported by bypass.city or Aizernal:`, rawUrl);
    return { status: "unsupported", host: hostOf(rawUrl) };
  }
  log(`${via}: skipping ${match.domain} link:`, rawUrl);
  if (sameTab) await sendTabToResolver(sameTab.id, rawUrl, match.resolver, via);
  else await openResolverTab(rawUrl, match.resolver, via, nextTo);
  return { status: "sent", resolver: RESOLVERS[match.resolver].label };
}

// "Try the other service" for a recent skip.
async function retrySkip(historyId, resolverKey) {
  await ready;
  const entry = history.find(e => e.id === historyId);
  if (!entry) return { status: "error", error: "That skip is no longer in the history." };
  if (!RESOLVERS[resolverKey]) return { status: "error", error: "Unknown service." };
  if (resolverKey === "aizernal" && !aizernalSupports(entry.url)) {
    return { status: "error", error: "Aizernal doesn't support this link." };
  }
  await openResolverTab(entry.url, resolverKey, "retry");
  return { status: "sent", resolver: RESOLVERS[resolverKey].label };
}

function showUnsupportedInTab(tabId, host) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  ext.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: showUnsupportedPopup,
    args: [host],
  }).catch(err => warn("Could not show the unsupported-shortener popup:", err));
}

// --- navigation listeners (registered synchronously at top level) ----------

// Address bar, bookmarks, history, clicked links, new tabs, JS/meta redirects.
ext.webNavigation.onBeforeNavigate.addListener(details => {
  if (isTopLevel(details)) consider(details.tabId, details.url, "navigation");
});

// HTTP redirect chains: catch the hop to a shortener before its page loads.
ext.webRequest.onBeforeRedirect.addListener(details => {
  if (details.documentLifecycle === "prerender") return;
  consider(details.tabId, details.redirectUrl, "redirect");
}, { urls: ["<all_urls>"], types: ["main_frame"] });

ext.webNavigation.onCommitted.addListener(details => {
  if (!isTopLevel(details)) return;
  ready.then(() => {
    const previous = state.committed[details.tabId];
    maybeCaptureDestination(details.tabId, previous, details);
    state.committed[details.tabId] = details.url;
    if (!classify(details.url)) delete state.opener[details.tabId];
    save();
  });
  updateBadge(details.tabId, details.url);
  // Final destination of a redirect chain the events above missed.
  consider(details.tabId, details.url, "commit");
});

// Fallback, e.g. an activated prerender or other paths without the events above.
ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) consider(tabId, changeInfo.url, "tab update");
});

ext.webNavigation.onCreatedNavigationTarget.addListener(details => {
  ready.then(() => {
    state.opener[details.tabId] = details.sourceTabId;
    save();
  });
});

ext.webNavigation.onTabReplaced.addListener(({ replacedTabId, tabId }) => {
  ready.then(() => {
    for (const key of TAB_KEYS) {
      if (replacedTabId in state[key]) {
        state[key][tabId] = state[key][replacedTabId];
        delete state[key][replacedTabId];
      }
    }
    save();
  });
});

ext.tabs.onRemoved.addListener(tabId => {
  ready.then(() => { forgetTab(tabId); save(); });
});

// --- right-click menu --------------------------------------------------------

ext.runtime.onInstalled.addListener(() => {
  Promise.resolve(ext.contextMenus.removeAll())
    .then(() => ext.contextMenus.create({
      id: MENU_ID,
      title: "Skip with SpeedSkip",
      contexts: ["link"],
    }))
    .catch(err => warn("Could not create the right-click menu:", err));
});

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;
  try {
    const result = await skipExplicitly(info.linkUrl, "right-click", { nextTo: tab });
    if (result.status === "unsupported" && tab) showUnsupportedInTab(tab.id, result.host);
  } catch (err) {
    warn("Right-click skip failed:", err);
  }
});

// --- keyboard shortcuts ------------------------------------------------------

ext.commands.onCommand.addListener(async (command, tab) => {
  await ready;
  if (!settings.shortcutsEnabled) {
    log(`Shortcut "${command}" ignored: keyboard shortcuts are turned off.`);
    return;
  }
  if (command === "toggle-speedskip") {
    await ext.storage.local.set({ enabled: !settings.enabled });
    return;
  }
  if (command === "skip-current-tab") {
    if (!tab) [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !isHttpUrl(tab.url) || isResolverUrl(tab.url)) return;
    try {
      const result = await skipExplicitly(tab.url, "shortcut", { sameTab: tab });
      if (result.status === "unsupported") showUnsupportedInTab(tab.id, result.host);
    } catch (err) {
      warn("Shortcut skip failed:", err);
    }
  }
});

// --- unsupported shorteners ------------------------------------------------

async function updateBadge(tabId, url) {
  await ready;
  const unsupported = settings.enabled && classify(url)?.kind === "unsupported";
  if (unsupported) {
    ext.action.setBadgeText({ tabId, text: "!" }).catch(() => {});
    ext.action.setBadgeBackgroundColor({ tabId, color: "#c62828" }).catch(() => {});
    ext.action.setTitle({ tabId, title: "Shortener unsupported" }).catch(() => {});
  } else {
    // text: null clears the tab's own badge so the global ON/OFF badge shows.
    // Fall back to copying the global value if a browser rejects null.
    const globalText = settings.enabled ? "" : "OFF";
    try {
      ext.action.setBadgeText({ tabId, text: null })
        .catch(() => ext.action.setBadgeText({ tabId, text: globalText }).catch(() => {}));
    } catch {
      ext.action.setBadgeText({ tabId, text: globalText }).catch(() => {});
    }
    ext.action.setBadgeBackgroundColor({ tabId, color: "#757575" }).catch(() => {});
    ext.action.setTitle({
      tabId, title: `SpeedSkip (${settings.enabled ? "on" : "off"})`,
    }).catch(() => {});
  }
}

ext.webNavigation.onDOMContentLoaded.addListener(async details => {
  if (!isTopLevel(details)) return;
  await ready;
  if (!settings.enabled) return;
  const match = classify(details.url);
  if (match?.kind !== "unsupported") return;
  log(`Unsupported shortener in tab ${details.tabId}:`, details.url);
  showUnsupportedInTab(details.tabId, match.host);
});

// Injected into the page; must be self-contained.
function showUnsupportedPopup(host) {
  const ID = "speedskip-unsupported";
  if (document.getElementById(ID)) return;
  const holder = document.createElement("div");
  holder.id = ID;
  holder.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
  const shadow = holder.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .box{font:14px/1.4 system-ui,sans-serif;background:#1f1f1f;color:#fff;
      border-left:4px solid #e53935;border-radius:8px;padding:12px 14px;
      max-width:320px;box-shadow:0 6px 24px rgba(0,0,0,.35)}
    strong{display:block;font-size:15px;margin-bottom:4px}
    p{margin:0 0 10px}
    button{font:inherit;background:#444;color:#fff;border:0;border-radius:6px;
      padding:5px 12px;cursor:pointer}
    button:hover{background:#555}`;
  const box = document.createElement("div");
  box.className = "box";
  box.setAttribute("role", "alert");
  const title = document.createElement("strong");
  title.textContent = "Shortener unsupported";
  const text = document.createElement("p");
  text.textContent = `${host || "This site"} isn't supported by bypass.city or Aizernal.`;
  const close = document.createElement("button");
  close.textContent = "Dismiss";
  close.addEventListener("click", () => holder.remove());
  box.append(title, text, close);
  shadow.append(style, box);
  (document.body || document.documentElement).append(holder);
  setTimeout(() => holder.remove(), 20000);
}

// --- messages ----------------------------------------------------------------

function respond(promise, sendResponse, what) {
  promise.then(sendResponse, err => {
    warn(`${what} failed:`, err);
    sendResponse({ status: "error", error: String(err && err.message || err) });
  });
  return true; // async response
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  // From the toolbar popup (an extension page, not a tab).
  const fromPopup = sender.id === ext.runtime.id && !sender.tab &&
                    String(sender.url).startsWith(ext.runtime.getURL(""));
  if (fromPopup) {
    switch (message.type) {
      case "RESOLVE_LINK":
        if (typeof message.url !== "string") return false;
        return respond(skipExplicitly(message.url, "paste"), sendResponse, "Paste skip");
      case "RETRY":
        return respond(retrySkip(message.id, message.resolver), sendResponse, "Retry");
      case "CLEAR_HISTORY":
        return respond(ready.then(() => {
          history = [];
          saveHistory();
          return { ok: true };
        }), sendResponse, "Clear history");
      default:
        return false;
    }
  }

  // From resolver.js on aizernal.xyz.
  const tabId = sender.tab?.id;
  if (tabId == null || !isResolverUrl(sender.url)) return false;
  return respond(handleResolverMessage(message, tabId), sendResponse, "Message handling");
});

async function handleResolverMessage(message, tabId) {
  await ready;
  switch (message.type) {
    case "GET_PENDING": {
      prune();
      const p = state.pending[tabId];
      const options = { openDestination: settings.openDestination };
      if (!p || p.resolver !== message.resolver) return { pending: null, options };
      log(`Gave tab ${tabId} its pending URL:`, p.url);
      return { pending: { id: p.id, url: p.url }, options };
    }
    case "SUBMITTED": {
      const p = state.pending[tabId];
      if (p && p.id === message.id) {
        delete state.pending[tabId];
        await save();
      }
      log(`Resolve Link clicked in tab ${tabId} for:`, message.url);
      return { ok: true };
    }
    case "OPEN_DESTINATION": {
      // "Open destination in a new tab" mode.
      if (!isHttpUrl(message.url) || isResolverUrl(message.url)) return { ok: false };
      const skip = state.skipInTab[tabId];
      if (skip) setDestination(skip.id, message.url);
      const source = await getTab(tabId);
      const props = { url: message.url, active: true, openerTabId: tabId };
      if (Number.isInteger(source?.index)) props.index = source.index + 1;
      await ext.tabs.create(props);
      log(`Opened the destination in a new tab:`, message.url);
      return { ok: true };
    }
    case "FALLBACK": {
      // Aizernal couldn't resolve the link: send this tab to bypass.city.
      const url = state.skipInTab[tabId]?.url || message.url;
      if (!isHttpUrl(url)) return { ok: false };
      log(`Aizernal failed in tab ${tabId}; trying bypass.city for:`, url);
      await sendTabToResolver(tabId, url, "bypassCity", "fallback");
      return { ok: true };
    }
    case "REPORT": {
      const line = `Tab ${tabId} (${message.resolver}): ${message.text}`;
      if (message.level === "error") warn(line); else log(line);
      return { ok: true };
    }
    default:
      return { error: "unknown message type" };
  }
}
