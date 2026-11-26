// Runs popup.html + popup.js in jsdom with a mocked chrome API.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || "jsdom");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const windows = [];
test.afterEach(() => { while (windows.length) windows.pop().close(); });

const NOW = Date.now();
const HISTORY = [
  { id: "h1", url: "https://ouo.io/AbC", resolver: "aizernal", via: "auto",
    at: NOW - 5 * 60 * 1000, destination: "https://files.example/doc.pdf" },
  { id: "h2", url: "https://linkvertise.com/1/x", resolver: "bypassCity", via: "paste",
    at: NOW - 2 * 3600 * 1000, destination: null },
];

function openPopup({ local = {}, activeTabUrl = "https://example.com/", reply, permissions } = {}) {
  const html = read("popup.html").replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new JSDOM(html, {
    url: "chrome-extension://abc/popup.html", runScripts: "outside-only", pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  windows.push(window);
  const store = JSON.parse(JSON.stringify(local));
  const sent = [];
  const created = [];
  const listeners = [];
  let closed = false;
  window.close = () => { closed = true; };
  window.chrome = {
    storage: {
      local: {
        get: async keys => {
          const out = {};
          for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
          return out;
        },
        set: async obj => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: store[k], newValue: v };
            store[k] = v;
          }
          listeners.forEach(fn => fn(changes, "local"));
        },
      },
      onChanged: { addListener: fn => listeners.push(fn) },
    },
    tabs: {
      query: async () => [{ url: activeTabUrl }],
      create: async props => { created.push(props); return { id: 1, ...props }; },
    },
    commands: {
      getAll: async () => [
        { name: "_execute_action", description: "", shortcut: "" },
        { name: "toggle-speedskip", description: "Turn SpeedSkip on or off", shortcut: "⌥⇧S" },
        { name: "skip-current-tab", description: "Skip the short link in the current tab", shortcut: "" },
      ],
    },
    runtime: {
      sendMessage: async m => {
        sent.push(m);
        return reply ? reply(m) : { status: "sent", resolver: "Aizernal" };
      },
    },
  };
  if (permissions) window.chrome.permissions = permissions;
  window.eval(read("domains.js"));
  window.eval(read("popup.js"));
  const $ = id => window.document.getElementById(id);
  const submit = async (formId, fieldId, value) => {
    $(fieldId).value = value;
    $(formId).dispatchEvent(new window.Event("submit", { cancelable: true }));
    await sleep(20);
  };
  const change = async el => { el.dispatchEvent(new window.Event("change")); await sleep(10); };
  return { window, document: window.document, $, store, sent, created, submit, change,
           isClosed: () => closed };
}

// --- on/off & counter ------------------------------------------------------------

test("switch reflects the stored setting (default on) and saves changes", async () => {
  const p = openPopup();
  await sleep(10);
  assert.equal(p.$("enabled").checked, true);
  assert.match(p.$("state").textContent, /^On/);
  p.$("enabled").checked = false;
  await p.change(p.$("enabled"));
  assert.equal(p.store.enabled, false);
  assert.match(p.$("state").textContent, /^Off/);

  const q = openPopup({ local: { enabled: false } });
  await sleep(10);
  assert.equal(q.$("enabled").checked, false);
});

test("counter shows the number of links skipped", async () => {
  const p = openPopup({ local: { skipCount: 1234 } });
  await sleep(10);
  assert.equal(p.$("count").textContent, (1234).toLocaleString());
  assert.equal(p.$("count-label").textContent, "links skipped");
  const one = openPopup({ local: { skipCount: 1 } });
  await sleep(10);
  assert.equal(one.$("count-label").textContent, "link skipped");
});

// --- paste a link -------------------------------------------------------------------

test("pasting a link sends the exact URL to the background", async () => {
  const p = openPopup();
  await p.submit("paste-form", "link", "  https://srnky.com/AbC?x=1#y  ");
  assert.equal(p.sent.length, 1);
  assert.deepEqual({ ...p.sent[0] }, { type: "RESOLVE_LINK", url: "https://srnky.com/AbC?x=1#y" });
  assert.match(p.$("result").textContent, /Opened in Aizernal/);
  await sleep(700);
  assert.ok(p.isClosed());
});

test("a link without https:// is accepted; invalid input is rejected", async () => {
  const p = openPopup();
  await p.submit("paste-form", "link", "ouo.io/abc");
  assert.equal(p.sent[0].url, "https://ouo.io/abc");
  await p.submit("paste-form", "link", "not a link");
  assert.equal(p.sent.length, 1);
  assert.match(p.$("result").textContent, /valid link/);
});

test("unsupported link shows 'Shortener unsupported'", async () => {
  const p = openPopup({ reply: () => ({ status: "unsupported", host: "adf.ly" }) });
  await p.submit("paste-form", "link", "https://adf.ly/abc");
  assert.match(p.$("result").textContent, /^Shortener unsupported: adf\.ly/);
  assert.equal(p.isClosed(), false);
});

test("field is prefilled when the current tab is a shortener", async () => {
  const p = openPopup({ activeTabUrl: "https://ouo.io/prefill" });
  await sleep(10);
  assert.equal(p.$("link").value, "https://ouo.io/prefill");
  const q = openPopup({ activeTabUrl: "https://news.example/" });
  await sleep(10);
  assert.equal(q.$("link").value, "");
});

// --- recent skips -------------------------------------------------------------------

test("recent skips list shows link, service, destination and time", async () => {
  const p = openPopup({ local: { history: HISTORY } });
  await sleep(10);
  const items = p.document.querySelectorAll("#recent li");
  assert.equal(items.length, 2);
  assert.equal(items[0].querySelector(".url").textContent, "ouo.io/AbC");
  assert.equal(items[0].querySelector(".chip").textContent, "Aizernal");
  const dest = items[0].querySelector(".dest a");
  assert.equal(dest.getAttribute("href"), "https://files.example/doc.pdf");
  assert.equal(dest.target, "_blank");
  assert.match(items[0].querySelector(".time").textContent, /^5m ago$/);
  assert.equal(items[1].querySelector(".dest").textContent, "No destination yet");
  assert.match(items[1].querySelector(".time").textContent, /2h ago · pasted/);
  assert.equal(p.$("recent-empty").hidden, true);
  assert.equal(p.$("clear-history").hidden, false);
});

test("empty history shows a placeholder", async () => {
  const p = openPopup();
  await sleep(10);
  assert.equal(p.$("recent-empty").hidden, false);
  assert.equal(p.$("clear-history").hidden, true);
});

test("'Try the other service' buttons: bypass.city always, Aizernal only if supported", async () => {
  const p = openPopup({ local: { history: HISTORY },
                        reply: () => ({ status: "sent", resolver: "bypass.city" }) });
  await sleep(10);
  const items = p.document.querySelectorAll("#recent li");
  const buttonsOf = li => [...li.querySelectorAll(".actions button")].map(b => b.textContent);
  assert.ok(buttonsOf(items[0]).includes("Try bypass.city"));
  assert.ok(!buttonsOf(items[1]).some(t => t.startsWith("Try ")), "linkvertise isn't on Aizernal");
  [...items[0].querySelectorAll(".actions button")].find(b => b.textContent === "Try bypass.city").click();
  await sleep(20);
  assert.deepEqual({ ...p.sent[0] }, { type: "RETRY", id: "h1", resolver: "bypassCity" });
  assert.match(p.$("recent-result").textContent, /Opened in bypass\.city/);
});

test("'Never skip' adds a never rule and hides the button", async () => {
  const p = openPopup({ local: { history: HISTORY } });
  await sleep(10);
  const btn = [...p.document.querySelectorAll("#recent li")[0].querySelectorAll("button")]
    .find(b => b.textContent === "Never skip");
  btn.click();
  await sleep(20);
  assert.deepEqual(JSON.parse(JSON.stringify(p.store.customRules)), [{ domain: "ouo.io", action: "never" }]);
  const again = [...p.document.querySelectorAll("#recent li")[0].querySelectorAll("button")]
    .find(b => b.textContent === "Never skip");
  assert.equal(again, undefined);
  assert.equal(p.document.querySelectorAll("#rules li").length, 1);
});

test("Clear asks the background to clear history", async () => {
  const p = openPopup({ local: { history: HISTORY } });
  await sleep(10);
  p.$("clear-history").click();
  await sleep(10);
  assert.equal(p.sent[0].type, "CLEAR_HISTORY");
});

// --- settings -------------------------------------------------------------------------

test("destination tab setting: shows and saves same/new", async () => {
  const p = openPopup({ local: { openDestination: "new" } });
  await sleep(10);
  const radio = v => p.document.querySelector(`input[name="open-destination"][value="${v}"]`);
  assert.equal(radio("new").checked, true);
  radio("same").checked = true;
  await p.change(radio("same"));
  assert.equal(p.store.openDestination, "same");
});

test("keyboard shortcuts: lists keys, toggles, and links to the shortcuts page", async () => {
  const p = openPopup({ local: { shortcutsEnabled: false } });
  await sleep(10);
  assert.equal(p.$("shortcuts").checked, false);
  const keys = [...p.document.querySelectorAll("#keys li")].map(li => li.textContent);
  assert.deepEqual(keys, ["⌥⇧S Turn SpeedSkip on or off", "not set Skip the short link in the current tab"]);
  p.$("shortcuts").checked = true;
  await p.change(p.$("shortcuts"));
  assert.equal(p.store.shortcutsEnabled, true);
  p.$("change-keys").click();
  await sleep(5);
  assert.equal(p.created[0].url, "chrome://extensions/shortcuts");
});

test("My sites: add (normalised), replace, and remove rules", async () => {
  const p = openPopup();
  await sleep(10);
  p.$("rule-action").value = "aizernal";
  await p.submit("rule-form", "rule-domain", "https://www.My-Short.link/go?x=1");
  assert.deepEqual(JSON.parse(JSON.stringify(p.store.customRules)), [{ domain: "my-short.link/go", action: "aizernal" }]);
  assert.match(p.$("rule-result").textContent, /my-short\.link\/go: Aizernal/);

  p.$("rule-action").value = "never";
  await p.submit("rule-form", "rule-domain", "my-short.link/go");
  assert.equal(p.store.customRules.length, 1, "same domain replaces the old rule");
  assert.equal(p.store.customRules[0].action, "never");

  await p.submit("rule-form", "rule-domain", "nonsense");
  assert.match(p.$("rule-result").textContent, /Enter a site/);

  p.document.querySelector("#rules .remove").click();
  await sleep(10);
  assert.equal(p.store.customRules.length, 0);
  assert.equal(p.document.querySelectorAll("#rules li").length, 0);
});

test("updates live when a skip happens while the popup is open", async () => {
  const p = openPopup({ local: { skipCount: 1, history: [HISTORY[1]] } });
  await sleep(10);
  await p.window.chrome.storage.local.set({ skipCount: 2, history: HISTORY });
  await sleep(10);
  assert.equal(p.$("count").textContent, "2");
  assert.equal(p.document.querySelectorAll("#recent li").length, 2);
});

// --- Firefox / Zen ----------------------------------------------------------------

test("Firefox: shows 'Allow access' when website access isn't granted, and requests it", async () => {
  let granted = false;
  const requested = [];
  const p = openPopup({ permissions: {
    contains: async () => granted,
    request: async perms => { requested.push(perms); granted = true; return true; },
  } });
  await sleep(20);
  assert.equal(p.$("access").hidden, false);
  p.$("grant-access").click();
  await sleep(20);
  assert.deepEqual(JSON.parse(JSON.stringify(requested)), [{ origins: ["<all_urls>"] }]);
  assert.equal(p.$("access").hidden, true);
});

test("access banner stays hidden when access is granted (Chrome/Opera)", async () => {
  const p = openPopup();
  await sleep(20);
  assert.equal(p.$("access").hidden, true);
});

test("Firefox: 'Change shortcuts' uses commands.openShortcutSettings when available", async () => {
  const p = openPopup();
  let opened = 0;
  p.window.chrome.commands.openShortcutSettings = async () => { opened++; };
  await sleep(10);
  p.$("change-keys").click();
  await sleep(10);
  assert.equal(opened, 1);
  assert.equal(p.created.length, 0);
});

test("My sites refuses to auto-skip a common site but allows 'Never skip'", async () => {
  const p = openPopup();
  await sleep(10);
  p.$("rule-action").value = "bypassCity";
  await p.submit("rule-form", "rule-domain", "www.google.com");
  assert.equal(p.store.customRules, undefined);
  assert.match(p.$("rule-result").textContent, /google\.com is a common site/);
  p.$("rule-action").value = "never";
  await p.submit("rule-form", "rule-domain", "youtube.com");
  assert.deepEqual(JSON.parse(JSON.stringify(p.store.customRules)), [{ domain: "youtube.com", action: "never" }]);
});
