// Runs background.js in a VM with a mocked chrome.* API.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const AIZ = "https://aizernal.xyz/";

function makeEvent() {
  const listeners = [];
  return {
    addListener: fn => listeners.push(fn),
    fire: (...args) => listeners.map(fn => fn(...args)),
  };
}

// sessionStore is shared between "service worker lifetimes" to model
// chrome.storage.session surviving a worker restart.
const EXT = "chrome-extension://abcdefghijklmnop/";

// firefox: expose the API as `browser` (not `chrome`), preload domains.js and
// provide no importScripts, like a Firefox MV3 event page.
function startWorker(sessionStore = {}, tabs = {}, localStore = {}, { firefox = false } = {}) {
  const calls = { update: [], inject: [], badge: {}, create: [], menus: [] };
  const clock = { now: 1_000_000 };
  const copy = v => JSON.parse(JSON.stringify(v));
  const onChanged = makeEvent();
  const area = (store, name) => ({
    get: async keys => {
      const list = keys == null ? Object.keys(store) : [].concat(keys);
      const out = {};
      for (const k of list) if (k in store) out[k] = copy(store[k]);
      return out;
    },
    set: async obj => {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: store[k], newValue: copy(v) };
        store[k] = copy(v);
      }
      if (name === "local") onChanged.fire(changes, "local");
    },
  });
  let nextTabId = 500;
  const chrome = {
    storage: {
      session: area(sessionStore, "session"),
      local: area(localStore, "local"),
      onChanged,
    },
    tabs: {
      update: async (tabId, props) => {
        calls.update.push({ tabId, url: props.url });
        tabs[tabId] = { ...(tabs[tabId] || {}), id: tabId, url: props.url };
      },
      create: async props => {
        const tab = { ...props, id: nextTabId++ };
        calls.create.push(tab);
        tabs[tab.id] = tab;
        return tab;
      },
      query: async () => Object.values(tabs),
      get: async tabId => {
        if (!tabs[tabId]) throw new Error("No tab");
        return tabs[tabId];
      },
      onUpdated: makeEvent(),
      onRemoved: makeEvent(),
    },
    webNavigation: {
      onBeforeNavigate: makeEvent(), onCommitted: makeEvent(),
      onDOMContentLoaded: makeEvent(), onCreatedNavigationTarget: makeEvent(),
      onTabReplaced: makeEvent(),
    },
    webRequest: { onBeforeRedirect: makeEvent() },
    scripting: { executeScript: async opts => { calls.inject.push(opts); return []; } },
    action: {
      setBadgeText: async ({ tabId, text }) => { calls.badge[tabId ?? "global"] = text; },
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    runtime: {
      id: "abcdefghijklmnop",
      getURL: p => EXT + p,
      onMessage: makeEvent(),
      onInstalled: makeEvent(),
    },
    contextMenus: {
      removeAll: async () => { calls.menus.length = 0; },
      create: props => { calls.menus.push(props); },
      onClicked: makeEvent(),
    },
    commands: { onCommand: makeEvent() },
  };

  const logs = [];
  const ctx = {
    chrome,
    crypto: globalThis.crypto,
    URL,
    console: {
      log: (...a) => logs.push(a.join(" ")),
      warn: (...a) => logs.push("WARN " + a.join(" ")),
    },
    setTimeout, clearTimeout,
  };
  ctx.self = ctx;
  if (firefox) {
    delete ctx.chrome;
    ctx.browser = chrome;
  } else {
    ctx.importScripts = file =>
      vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
  }
  vm.createContext(ctx);
  if (firefox) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "domains.js"), "utf8"), ctx,
      { filename: "domains.js" });
  }
  vm.runInContext("Date.now = () => __clock.now;", Object.assign(ctx, { __clock: clock }));
  vm.runInContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), ctx,
    { filename: "background.js" });

  const settle = () => new Promise(r => setTimeout(r, 20));
  const message = (msg, tabId, url = AIZ) => new Promise(resolve => {
    const ret = chrome.runtime.onMessage.fire(msg, { tab: { id: tabId }, url }, resolve)[0];
    if (ret !== true) resolve(undefined);
  });
  const popupMessage = (msg, sender = { id: chrome.runtime.id, url: EXT + "popup.html" }) =>
    new Promise(resolve => {
      const ret = chrome.runtime.onMessage.fire(msg, sender, resolve)[0];
      if (ret !== true) resolve(undefined);
    });
  const setEnabled = async on => {
    const oldValue = localStore.enabled;
    localStore.enabled = on;
    chrome.storage.onChanged.fire({ enabled: { oldValue, newValue: on } }, "local");
    await settle();
  };
  // Like the popup writing a setting.
  const setLocal = async obj => { await chrome.storage.local.set(obj); await settle(); };
  return { chrome, calls, clock, logs, settle, message, popupMessage, setEnabled, setLocal,
           sessionStore, tabs, localStore };
}

const nav = (w, tabId, url, extra = {}) =>
  w.chrome.webNavigation.onBeforeNavigate.fire({ tabId, frameId: 0, url, ...extra });
const commit = (w, tabId, url) =>
  w.chrome.webNavigation.onCommitted.fire({ tabId, frameId: 0, url });

test("Aizernal link: tab redirected and exact URL stored for that tab", async () => {
  const w = startWorker();
  const original = "https://srnky.com/tHpaxj1k?ref=a&b=%20c#section-2";
  nav(w, 7, original);
  await w.settle();
  assert.deepEqual(w.calls.update, [{ tabId: 7, url: AIZ }]);

  const res = await w.message({ type: "GET_PENDING", resolver: "aizernal" }, 7);
  assert.equal(res.pending.url, original);
  // Another tab gets nothing.
  assert.equal((await w.message({ type: "GET_PENDING", resolver: "aizernal" }, 8)).pending, null);
});

test("one navigation reported by several events redirects once", async () => {
  const w = startWorker();
  const url = "https://ouo.io/abc";
  nav(w, 1, url);
  w.chrome.webRequest.onBeforeRedirect.fire({ tabId: 1, redirectUrl: url });
  commit(w, 1, url);
  w.chrome.tabs.onUpdated.fire(1, { url });
  await w.settle();
  assert.equal(w.calls.update.length, 1);
});

test("bypass.city preferred; URL passed in ?bypass=; no autofill state", async () => {
  const w = startWorker();
  const original = "https://shrinkme.click/AbC?x=1#y";
  nav(w, 2, original);
  await w.settle();
  assert.equal(w.calls.update.length, 1);
  const target = new URL(w.calls.update[0].url);
  assert.equal(target.origin + target.pathname, "https://bypass.city/bypass");
  assert.equal(target.searchParams.get("bypass"), original);
  assert.equal((await w.message({ type: "GET_PENDING", resolver: "aizernal" }, 2)).pending, null);
});

test("ignores unrelated sites, sub-frames, prerenders and resolver pages", async () => {
  const w = startWorker();
  nav(w, 3, "https://example.com/srnky.com/x");
  nav(w, 3, "https://srnky.com/x", { frameId: 4 });
  nav(w, 3, "https://srnky.com/y", { documentLifecycle: "prerender" });
  nav(w, 3, "https://aizernal.xyz/");
  nav(w, -1, "https://srnky.com/z");
  await w.settle();
  assert.equal(w.calls.update.length, 0);
});

test("redirect chain ending at a shortener is caught", async () => {
  const w = startWorker();
  nav(w, 4, "https://t.example/out?u=1");
  w.chrome.webRequest.onBeforeRedirect.fire({
    tabId: 4, url: "https://t.example/out?u=1", redirectUrl: "https://cuty.io/abc",
  });
  await w.settle();
  assert.equal(w.calls.update.length, 1);
  assert.match(w.calls.update[0].url, /^https:\/\/bypass\.city\/bypass\?bypass=/);
});

test("pending URL survives a service-worker restart, then is cleared after submit", async () => {
  const store = {};
  const w1 = startWorker(store);
  nav(w1, 5, "https://ouo.press/Zz9");
  await w1.settle();

  const w2 = startWorker(store); // fresh worker, same session storage
  const res = await w2.message({ type: "GET_PENDING", resolver: "aizernal" }, 5);
  assert.equal(res.pending.url, "https://ouo.press/Zz9");

  await w2.message({ type: "SUBMITTED", id: res.pending.id, url: res.pending.url }, 5);
  const again = await w2.message({ type: "GET_PENDING", resolver: "aizernal" }, 5);
  assert.equal(again.pending, null, "must not submit twice");
});

test("messages from non-resolver pages are ignored", async () => {
  const w = startWorker();
  nav(w, 6, "https://srnky.com/q");
  await w.settle();
  const res = await w.message({ type: "GET_PENDING", resolver: "aizernal" }, 6, "https://evil.example/");
  assert.equal(res, undefined);
});

test("opening the original link from Aizernal does not loop", async () => {
  const w = startWorker();
  const url = "https://srnky.com/loop1";
  nav(w, 10, url);
  await w.settle();
  commit(w, 10, AIZ);
  await w.settle();
  // Aizernal's "Open original link" opens a new tab (11) from tab 10.
  w.chrome.webNavigation.onCreatedNavigationTarget.fire({ sourceTabId: 10, tabId: 11, url });
  nav(w, 11, url);
  await w.settle();
  assert.equal(w.calls.update.length, 1);
  // Same-tab navigation away from Aizernal to the same URL also passes.
  w.clock.now += 20_000;
  nav(w, 10, url);
  await w.settle();
  assert.equal(w.calls.update.length, 1);
});

test("a fresh visit to the same link from a normal page is intercepted again", async () => {
  const w = startWorker();
  const url = "https://srnky.com/again";
  nav(w, 12, url);
  await w.settle();
  commit(w, 12, AIZ);
  commit(w, 12, "https://news.example/");
  w.clock.now += 30_000;
  nav(w, 12, url);
  await w.settle();
  assert.equal(w.calls.update.length, 2);
});

test("loop guard stops after repeated bounces of the same URL", async () => {
  const w = startWorker();
  const url = "https://bit.ly/bounce";
  for (let i = 0; i < 5; i++) {
    nav(w, 13, url);
    await w.settle();
    w.clock.now += 11_000; // beyond the de-dupe window
  }
  assert.equal(w.calls.update.length, 3);
  assert.ok(w.logs.some(l => l.includes("loop guard")));
});

test("tab replacement keeps the pending URL", async () => {
  const w = startWorker();
  nav(w, 20, "https://ouo.io/rep");
  await w.settle();
  w.chrome.webNavigation.onTabReplaced.fire({ replacedTabId: 20, tabId: 21 });
  await w.settle();
  const res = await w.message({ type: "GET_PENDING", resolver: "aizernal" }, 21);
  assert.equal(res.pending.url, "https://ouo.io/rep");
});

test("closing a tab forgets its pending URL", async () => {
  const w = startWorker();
  nav(w, 30, "https://ouo.io/close");
  await w.settle();
  w.chrome.tabs.onRemoved.fire(30);
  await w.settle();
  assert.equal((await w.message({ type: "GET_PENDING", resolver: "aizernal" }, 30)).pending, null);
});

test("unsupported shortener: no redirect, badge + popup injected once per page", async () => {
  const w = startWorker();
  const url = "https://adf.ly/abc";
  nav(w, 40, url);
  commit(w, 40, url);
  w.chrome.webNavigation.onDOMContentLoaded.fire({ tabId: 40, frameId: 0, url });
  w.chrome.webNavigation.onDOMContentLoaded.fire({ tabId: 40, frameId: 2, url });
  await w.settle();
  assert.equal(w.calls.update.length, 0);
  assert.equal(w.calls.badge[40], "!");
  assert.equal(w.calls.inject.length, 1);
  assert.deepEqual([...w.calls.inject[0].args], ["adf.ly"]); // array from VM realm

  commit(w, 40, "https://example.com/");
  await w.settle();
  assert.equal(w.calls.badge[40], null); // tab badge cleared -> global ON/OFF badge shows
});

module.exports = { startWorker };

// --- on/off switch and the popup's paste-a-link field -----------------------

test("switched off: nothing is intercepted and no unsupported popup", async () => {
  const w = startWorker({}, {}, { enabled: false });
  nav(w, 50, "https://srnky.com/off");
  nav(w, 50, "https://bit.ly/off");
  w.chrome.webNavigation.onDOMContentLoaded.fire({ tabId: 50, frameId: 0, url: "https://adf.ly/x" });
  await w.settle();
  assert.equal(w.calls.update.length, 0);
  assert.equal(w.calls.inject.length, 0);
  assert.equal(w.calls.badge.global, "OFF");
});

test("toggling takes effect immediately, without a worker restart", async () => {
  const w = startWorker();
  await w.settle();
  assert.equal(w.calls.badge.global, "");
  await w.setEnabled(false);
  assert.equal(w.calls.badge.global, "OFF");
  nav(w, 51, "https://srnky.com/t1");
  await w.settle();
  assert.equal(w.calls.update.length, 0);
  await w.setEnabled(true);
  nav(w, 51, "https://srnky.com/t2");
  await w.settle();
  assert.equal(w.calls.update.length, 1);
});

test("pasted Aizernal link opens a new tab with autofill armed for it", async () => {
  const w = startWorker();
  const url = "https://srnky.com/Pasted1?a=b#c";
  const res = await w.popupMessage({ type: "RESOLVE_LINK", url });
  assert.equal(res.status, "sent");
  assert.equal(res.resolver, "Aizernal");
  assert.equal(w.calls.create.length, 1);
  const tabId = w.calls.create[0].id;
  assert.deepEqual(w.calls.update, [{ tabId, url: AIZ }]);
  const pending = await w.message({ type: "GET_PENDING", resolver: "aizernal" }, tabId);
  assert.equal(pending.pending.url, url);
});

test("pasted bypass.city link works even when switched off", async () => {
  const w = startWorker({}, {}, { enabled: false });
  const url = "https://linkvertise.com/1/abc";
  const res = await w.popupMessage({ type: "RESOLVE_LINK", url });
  assert.equal(res.status, "sent");
  assert.equal(res.resolver, "bypass.city");
  assert.equal(new URL(w.calls.update[0].url).searchParams.get("bypass"), url);
});

test("pasted unsupported or unknown link reports 'unsupported' and opens nothing", async () => {
  const w = startWorker();
  for (const [url, host] of [["https://adf.ly/abc", "adf.ly"], ["https://example.com/x", "example.com"]]) {
    const res = await w.popupMessage({ type: "RESOLVE_LINK", url });
    assert.equal(res.status, "unsupported");
    assert.equal(res.host, host);
  }
  assert.equal(w.calls.create.length, 0);
});

test("RESOLVE_LINK is only accepted from the extension's own pages", async () => {
  const w = startWorker();
  const msg = { type: "RESOLVE_LINK", url: "https://srnky.com/x" };
  assert.equal(await w.message(msg, 60, "https://evil.example/"), undefined);
  assert.equal(await w.popupMessage(msg, { id: "other-extension", url: "chrome-extension://zzz/p.html" }), undefined);
  assert.equal(w.calls.create.length, 0);
});

// --- My sites (custom rules) ------------------------------------------------

test("My sites: custom rule sends an unknown domain to the chosen service", async () => {
  const w = startWorker({}, {}, { customRules: [{ domain: "my-short.link", action: "aizernal" }] });
  nav(w, 70, "https://my-short.link/abc");
  await w.settle();
  assert.deepEqual(w.calls.update, [{ tabId: 70, url: AIZ }]);
});

test("My sites: 'never skip' stops automatic skipping but not explicit skips", async () => {
  const w = startWorker();
  await w.setLocal({ customRules: [{ domain: "bit.ly", action: "never" }] });
  nav(w, 71, "https://bit.ly/abc123");
  await w.settle();
  assert.equal(w.calls.update.length, 0, "automatic skip blocked");
  const res = await w.popupMessage({ type: "RESOLVE_LINK", url: "https://bit.ly/abc123" });
  assert.equal(res.status, "sent", "pasting it still works");
  assert.equal(res.resolver, "bypass.city");
});

test("My sites: a rule can override the built-in service", async () => {
  const w = startWorker({}, {}, { customRules: [{ domain: "ouo.io", action: "bypassCity" }] });
  nav(w, 72, "https://ouo.io/x");
  await w.settle();
  assert.match(w.calls.update[0].url, /^https:\/\/bypass\.city\//);
});

// --- history & counter --------------------------------------------------------

test("each skip is recorded in history (newest first, max 10) and counted", async () => {
  const w = startWorker();
  for (let i = 0; i < 12; i++) {
    nav(w, 80 + i, `https://ouo.io/h${i}`);
    await w.settle();
  }
  assert.equal(w.localStore.skipCount, 12);
  assert.equal(w.localStore.history.length, 10);
  assert.equal(w.localStore.history[0].url, "https://ouo.io/h11");
  assert.equal(w.localStore.history[0].resolver, "aizernal");
  assert.equal(w.localStore.history[0].via, "auto");
  assert.equal(w.localStore.history[0].destination, null);
});

test("counter and history survive a worker restart", async () => {
  const session = {};
  const local = {};
  const w1 = startWorker(session, {}, local);
  nav(w1, 90, "https://ouo.io/r1");
  await w1.settle();
  const w2 = startWorker(session, {}, local);
  nav(w2, 91, "https://ouo.io/r2");
  await w2.settle();
  assert.equal(local.skipCount, 2);
  assert.deepEqual(local.history.map(e => e.url), ["https://ouo.io/r2", "https://ouo.io/r1"]);
});

test("destination is captured when the resolver tab follows a link off the resolver", async () => {
  const w = startWorker();
  nav(w, 100, "https://bit.ly/dest1");
  await w.settle();
  const bc = w.calls.update[0].url;
  w.chrome.webNavigation.onCommitted.fire({ tabId: 100, frameId: 0, url: bc, transitionType: "link" });
  await w.settle();
  w.chrome.webNavigation.onCommitted.fire({
    tabId: 100, frameId: 0, url: "https://final.example/file", transitionType: "link",
    transitionQualifiers: ["client_redirect"],
  });
  await w.settle();
  assert.equal(w.localStore.history[0].destination, "https://final.example/file");
});

test("typing a new address on a resolver page is not taken as the destination", async () => {
  const w = startWorker();
  nav(w, 101, "https://ouo.io/typed");
  await w.settle();
  w.chrome.webNavigation.onCommitted.fire({ tabId: 101, frameId: 0, url: AIZ, transitionType: "link" });
  await w.settle();
  w.chrome.webNavigation.onCommitted.fire({
    tabId: 101, frameId: 0, url: "https://news.example/", transitionType: "typed",
  });
  await w.settle();
  assert.equal(w.localStore.history[0].destination, null);
});

test("CLEAR_HISTORY empties history but keeps the counter", async () => {
  const w = startWorker();
  nav(w, 102, "https://ouo.io/c");
  await w.settle();
  await w.popupMessage({ type: "CLEAR_HISTORY" });
  await w.settle();
  assert.deepEqual(w.localStore.history, []);
  assert.equal(w.localStore.skipCount, 1);
});

// --- new-tab destination & fallback (messages from Aizernal) -------------------

test("GET_PENDING includes the open-destination setting", async () => {
  const w = startWorker({}, {}, { openDestination: "new" });
  nav(w, 110, "https://ouo.io/opt");
  await w.settle();
  const res = await w.message({ type: "GET_PENDING", resolver: "aizernal" }, 110);
  assert.equal(res.options.openDestination, "new");
});

test("OPEN_DESTINATION opens a new tab next to Aizernal and records the destination", async () => {
  const w = startWorker();
  nav(w, 111, "https://ouo.io/newtab");
  await w.settle();
  const res = await w.message({ type: "OPEN_DESTINATION", url: "https://dl.example/f.zip" }, 111);
  assert.equal(res.ok, true);
  assert.equal(w.calls.create.length, 1);
  assert.equal(w.calls.create[0].url, "https://dl.example/f.zip");
  assert.equal(w.calls.create[0].openerTabId, 111);
  assert.equal(w.localStore.history[0].destination, "https://dl.example/f.zip");
  // Non-http and resolver URLs are refused.
  assert.equal((await w.message({ type: "OPEN_DESTINATION", url: "javascript:alert(1)" }, 111)).ok, false);
  assert.equal((await w.message({ type: "OPEN_DESTINATION", url: AIZ }, 111)).ok, false);
  assert.equal(w.calls.create.length, 1);
});

test("FALLBACK sends the Aizernal tab to bypass.city with the original link", async () => {
  const w = startWorker();
  nav(w, 112, "https://ouo.io/fails");
  await w.settle();
  await w.message({ type: "FALLBACK", url: "https://ouo.io/fails" }, 112);
  assert.equal(w.calls.update.length, 2);
  const target = new URL(w.calls.update[1].url);
  assert.equal(target.hostname, "bypass.city");
  assert.equal(target.searchParams.get("bypass"), "https://ouo.io/fails");
  assert.equal(w.localStore.history[0].via, "fallback");
});

test("RETRY opens the other service; Aizernal only for links it supports", async () => {
  const w = startWorker();
  nav(w, 113, "https://linkvertise.com/1/x");
  nav(w, 114, "https://ouo.io/y");
  await w.settle();
  const [ouo, lv] = w.localStore.history;
  const a = await w.popupMessage({ type: "RETRY", id: ouo.id, resolver: "bypassCity" });
  assert.equal(a.status, "sent");
  const b = await w.popupMessage({ type: "RETRY", id: lv.id, resolver: "aizernal" });
  assert.equal(b.status, "error");
  assert.equal(w.calls.create.length, 1);
});

// --- right-click menu -------------------------------------------------------------

test("installs a 'Skip with SpeedSkip' link menu", async () => {
  const w = startWorker();
  w.chrome.runtime.onInstalled.fire({ reason: "install" });
  await w.settle();
  assert.equal(w.calls.menus.length, 1);
  assert.equal(w.calls.menus[0].title, "Skip with SpeedSkip");
  assert.deepEqual([...w.calls.menus[0].contexts], ["link"]);
});

test("right-click skip opens a new tab next to the page; works when switched off", async () => {
  const w = startWorker({}, {}, { enabled: false });
  w.chrome.contextMenus.onClicked.fire(
    { menuItemId: "speedskip-link", linkUrl: "https://srnky.com/rc" }, { id: 120, index: 3 });
  await w.settle();
  assert.equal(w.calls.create.length, 1);
  assert.equal(w.calls.create[0].index, 4);
  const tabId = w.calls.create[0].id;
  assert.deepEqual(w.calls.update, [{ tabId, url: AIZ }]);
  assert.equal(w.localStore.history[0].via, "right-click");
});

test("right-click on an unsupported link shows the popup on the page", async () => {
  const w = startWorker();
  w.chrome.contextMenus.onClicked.fire(
    { menuItemId: "speedskip-link", linkUrl: "https://example.com/x" }, { id: 121, index: 0 });
  await w.settle();
  assert.equal(w.calls.create.length, 0);
  assert.equal(w.calls.inject.length, 1);
  assert.equal(w.calls.inject[0].target.tabId, 121);
});

// --- keyboard shortcuts -------------------------------------------------------------

test("toggle shortcut flips the on/off switch", async () => {
  const w = startWorker();
  w.chrome.commands.onCommand.fire("toggle-speedskip");
  await w.settle();
  assert.equal(w.localStore.enabled, false);
  assert.equal(w.calls.badge.global, "OFF");
  w.chrome.commands.onCommand.fire("toggle-speedskip");
  await w.settle();
  assert.equal(w.localStore.enabled, true);
});

test("skip shortcut skips the current tab in place", async () => {
  const w = startWorker({}, { 130: { id: 130, url: "https://pastebin.com/k" } });
  w.chrome.commands.onCommand.fire("skip-current-tab", { id: 130, url: "https://pastebin.com/k" });
  await w.settle();
  assert.equal(w.calls.create.length, 0);
  assert.equal(w.calls.update.length, 1);
  assert.equal(w.calls.update[0].tabId, 130);
  assert.match(w.calls.update[0].url, /^https:\/\/bypass\.city\//);
});

test("shortcuts do nothing when turned off in settings", async () => {
  const w = startWorker({}, {}, { shortcutsEnabled: false });
  w.chrome.commands.onCommand.fire("toggle-speedskip");
  w.chrome.commands.onCommand.fire("skip-current-tab", { id: 131, url: "https://ouo.io/z" });
  await w.settle();
  assert.equal(w.localStore.enabled, undefined);
  assert.equal(w.calls.update.length, 0);
});

// --- Firefox / Zen ----------------------------------------------------------------

test("Firefox/Zen: works with `browser.*`, preloaded domains.js and no importScripts", async () => {
  const w = startWorker({}, {}, {}, { firefox: true });
  nav(w, 140, "https://ouo.io/ff");
  nav(w, 141, "https://linkvertise.com/1/ff");
  await w.settle();
  assert.deepEqual(w.calls.update[0], { tabId: 140, url: AIZ });
  assert.match(w.calls.update[1].url, /^https:\/\/bypass\.city\//);
  const res = await w.message({ type: "GET_PENDING", resolver: "aizernal" }, 140);
  assert.equal(res.pending.url, "https://ouo.io/ff");
  w.chrome.runtime.onInstalled.fire({ reason: "install" });
  await w.settle();
  assert.equal(w.calls.menus.length, 1);
});

// --- only known shorteners are skipped automatically ---------------------------

test("everyday browsing (Google, YouTube, paste sites, GitHub…) is never auto-skipped", async () => {
  const w = startWorker({}, {}, { customRules: [{ domain: "google.com", action: "bypassCity" }] });
  const urls = [
    "https://www.google.com/search?q=speedskip",
    "https://www.google.com/url?q=https://example.com&sa=D",
    "https://www.google.co.uk/search?q=x",
    "https://www.youtube.com/watch?v=abc",
    "https://pastebin.com/abc123",
    "https://telegra.ph/Post-01-01",
    "https://gist.github.com/user/abc",
    "https://github.com/user/repo",
    "https://en.wikipedia.org/wiki/Main_Page",
  ];
  let tabId = 150;
  for (const url of urls) {
    const id = tabId++;
    nav(w, id, url);
    w.chrome.webRequest.onBeforeRedirect.fire({ tabId: id, redirectUrl: url });
    commit(w, id, url);
    w.chrome.tabs.onUpdated.fire(id, { url });
    w.chrome.webNavigation.onDOMContentLoaded.fire({ tabId: id, frameId: 0, url });
  }
  await w.settle();
  assert.equal(w.calls.update.length, 0, "no tab was redirected");
  assert.equal(w.calls.inject.length, 0, "no unsupported popup");
  assert.equal(w.localStore.skipCount, undefined, "nothing counted as a skip");
});

test("paste sites and Google redirects still work when asked explicitly", async () => {
  const w = startWorker();
  const a = await w.popupMessage({ type: "RESOLVE_LINK", url: "https://pastebin.com/abc123" });
  assert.equal(a.status, "sent");
  w.chrome.contextMenus.onClicked.fire(
    { menuItemId: "speedskip-link", linkUrl: "https://www.google.com/url?q=https://x.example/" },
    { id: 160, index: 0 });
  await w.settle();
  assert.equal(w.calls.create.length, 2);
  assert.ok(w.calls.update.every(u => u.url.startsWith("https://bypass.city/")));
});
