// Runs resolver.js against a saved copy of the real aizernal.xyz page
// (tests/fixtures/aizernal.html) using jsdom. Needs jsdom:
//   npm install --no-save jsdom   (or set JSDOM_PATH to an installed copy)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || "jsdom");
const ROOT = path.join(__dirname, "..");
const SCRIPT = fs.readFileSync(path.join(ROOT, "resolver.js"), "utf8");
const PAGE = fs.readFileSync(path.join(ROOT, "tests/fixtures/aizernal.html"), "utf8");
const ORIGINAL = "https://srnky.com/tHpaxj1k?utm=a&x=%2F#frag";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// resolver.js waits up to 10 minutes; closing the window stops its timers.
const openWindows = [];
test.afterEach(() => { while (openWindows.length) openWindows.pop().close(); });

function load({ html = PAGE, pending = { id: "p1", url: ORIGINAL }, url = "https://aizernal.xyz/", options = { openDestination: "same" } } = {}) {
  const virtualConsole = new VirtualConsole(); // keep jsdom noise out of the output
  const dom = new JSDOM(html, { url, runScripts: "outside-only", virtualConsole });
  const { window } = dom;
  openWindows.push(window);
  const sent = [];
  const logs = [];
  window.console.log = (...a) => logs.push(a.join(" "));
  window.console.warn = (...a) => logs.push("WARN " + a.join(" "));
  window.chrome = {
    runtime: {
      lastError: undefined,
      // Promise-based, like chrome.* in MV3 and Firefox's browser.*.
      sendMessage(message) {
        sent.push(message);
        let res = { ok: true };
        if (message.type === "GET_PENDING") res = { pending, options };
        return new Promise(r => setTimeout(() => r(res), 0));
      },
    },
  };
  // Stand-in for Aizernal's app.js: count submits and keep the page in place.
  const submits = [];
  const hook = () => {
    const form = window.document.getElementById("link-form");
    if (form && !form.__hooked) {
      form.__hooked = true;
      form.addEventListener("submit", e => {
        e.preventDefault();
        submits.push(window.document.getElementById("url").value);
      });
    }
  };
  hook();
  const inputEvents = [];
  window.document.addEventListener("input", e => inputEvents.push(e.target.id), true);
  window.document.addEventListener("change", e => inputEvents.push("change:" + e.target.id), true);
  window.eval(SCRIPT);
  return { window, document: window.document, sent, logs, submits, hook, inputEvents };
}

test("fills the real #url field but waits while Resolve is disabled (verification)", async () => {
  const t = load();
  await sleep(150);
  const input = t.document.getElementById("url");
  const button = t.document.getElementById("resolve");
  assert.equal(input.value, ORIGINAL);
  assert.ok(button.disabled);
  assert.equal(t.submits.length, 0);
  assert.ok(t.inputEvents.includes("url") && t.inputEvents.includes("change:url"));
  assert.ok(t.logs.some(l => l.includes("Input field found (#url)")));
  assert.ok(t.logs.some(l => l.includes("URL populated")));
  assert.ok(t.logs.some(l => l.includes("Waiting for Aizernal's verification")));
});

test("clicks Resolve link exactly once after the page enables it", async () => {
  const t = load();
  await sleep(100);
  t.document.getElementById("resolve").disabled = false; // verification passed
  await sleep(100);
  assert.deepEqual(t.submits, [ORIGINAL]);
  assert.equal(t.sent.filter(m => m.type === "SUBMITTED").length, 1);
  assert.equal(t.sent.find(m => m.type === "SUBMITTED").id, "p1");
  // Further DOM churn must not trigger another submit.
  t.document.getElementById("resolve").disabled = true;
  t.document.getElementById("resolve").disabled = false;
  await sleep(700);
  assert.equal(t.submits.length, 1);
  assert.ok(t.logs.some(l => l.includes("Clicked Resolve link")));
});

test("SUBMITTED is reported before the click", async () => {
  const t = load();
  await sleep(50);
  t.document.getElementById("resolve").disabled = false;
  await sleep(100);
  const idx = t.sent.findIndex(m => m.type === "SUBMITTED");
  assert.ok(idx >= 0);
  assert.equal(t.submits.length, 1);
});

test("waits for a form that renders later (slow / dynamic page)", async () => {
  const shell = "<!doctype html><html><body><main id=app></main></body></html>";
  const t = load({ html: shell });
  await sleep(200);
  const formHtml = PAGE.match(/<form id="link-form">[\s\S]*?<\/form>/)[0];
  t.document.getElementById("app").innerHTML = formHtml;
  t.hook();
  await sleep(100);
  assert.equal(t.document.getElementById("url").value, ORIGINAL);
  t.document.getElementById("resolve").disabled = false;
  await sleep(100);
  assert.deepEqual(t.submits, [ORIGINAL]);
});

test("re-fills if the page clears the field before submit", async () => {
  const t = load();
  await sleep(100);
  t.document.getElementById("url").value = "";
  t.document.getElementById("resolve").disabled = false;
  await sleep(700);
  assert.deepEqual(t.submits, [ORIGINAL]);
});

test("does not pick a different input or button on the page", async () => {
  const decoy = PAGE.replace("<body>",
    '<body><form><input type="text" placeholder="Search links"><button type="submit">Resolve now</button></form>');
  const t = load({ html: decoy });
  await sleep(100);
  assert.equal(t.document.querySelector('input[placeholder="Search links"]').value, "");
  assert.equal(t.document.getElementById("url").value, ORIGINAL);
});

test("no pending link: page is left untouched", async () => {
  const t = load({ pending: null });
  await sleep(100);
  assert.equal(t.document.getElementById("url").value, "");
  assert.equal(t.submits.length, 0);
});

test("Aizernal resuming its own job (?assist=) is left alone", async () => {
  const t = load({ url: "https://aizernal.xyz/?assist=abc" });
  await sleep(100);
  assert.equal(t.sent.length, 0);
  assert.equal(t.document.getElementById("url").value, "");
});

// --- after submitting: destination & failure ---------------------------------

// Mimics Aizernal's app.js render() for a resolved link / an error.
function showResolved(document, destination) {
  document.getElementById("result").hidden = false;
  document.getElementById("badge").className = "badge";
  const a = document.getElementById("destination");
  a.setAttribute("href", destination);
  a.hidden = false;
  document.getElementById("copy").hidden = false;
}
function showError(document) {
  document.getElementById("result").hidden = false;
  document.getElementById("badge").className = "badge error";
  document.getElementById("badge").textContent = "Could not resolve";
}
async function submitted(t) {
  await sleep(50);
  t.document.getElementById("resolve").disabled = false;
  await sleep(100);
  assert.equal(t.submits.length, 1);
}

test("new-tab mode: unticks Aizernal's auto-open and hands the destination over", async () => {
  const t = load({ options: { openDestination: "new" } });
  await submitted(t);
  assert.equal(t.document.getElementById("auto-open").checked, false);
  showResolved(t.document, "https://dl.example/file.zip");
  await sleep(50);
  const open = t.sent.filter(m => m.type === "OPEN_DESTINATION");
  assert.equal(open.length, 1);
  assert.equal(open[0].url, "https://dl.example/file.zip");
});

test("same-tab mode: leaves auto-open on and lets Aizernal navigate", async () => {
  const t = load();
  await submitted(t);
  assert.equal(t.document.getElementById("auto-open").checked, true);
  showResolved(t.document, "https://dl.example/file.zip");
  await sleep(50);
  assert.equal(t.sent.filter(m => m.type === "OPEN_DESTINATION").length, 0);
});

test("a nested-shortener result (no Copy button) is not treated as the destination", async () => {
  const t = load({ options: { openDestination: "new" } });
  await submitted(t);
  const d = t.document;
  d.getElementById("result").hidden = false;
  d.getElementById("badge").className = "badge warn";
  d.getElementById("destination").setAttribute("href", "https://cuty.io/next");
  d.getElementById("destination").hidden = false;
  await sleep(50);
  assert.equal(t.sent.filter(m => m.type === "OPEN_DESTINATION").length, 0);
});

test("failure: offers 'Try bypass.city instead', which asks the extension to switch", async () => {
  const t = load();
  await submitted(t);
  assert.equal(t.document.getElementById("speedskip-fallback"), null);
  showError(t.document);
  await sleep(50);
  const holder = t.document.getElementById("speedskip-fallback");
  assert.ok(holder && !holder.hidden);
  const button = holder.querySelector("button");
  assert.match(button.textContent, /Try bypass\.city instead/);
  button.click();
  await sleep(10);
  const fb = t.sent.filter(m => m.type === "FALLBACK");
  assert.equal(fb.length, 1);
  assert.equal(fb[0].url, ORIGINAL);
  assert.ok(button.disabled);
});

test("the fallback button hides again if Aizernal then succeeds", async () => {
  const t = load();
  await submitted(t);
  showError(t.document);
  await sleep(50);
  showResolved(t.document, "https://ok.example/");
  await sleep(50);
  assert.ok(t.document.getElementById("speedskip-fallback").hidden);
});

test("waits for the user's Cloudflare verification: no click and no touching the widget", async () => {
  const t = load();
  const widget = t.document.getElementById("turnstile-widget");
  let widgetChanged = false;
  new t.window.MutationObserver(() => { widgetChanged = true; })
    .observe(widget, { subtree: true, childList: true, attributes: true });
  const clicks = [];
  t.document.addEventListener("click", e => clicks.push(e.target.id || e.target.tagName), true);

  await sleep(2500); // several polling rounds while verification is pending
  assert.equal(t.document.getElementById("url").value, ORIGINAL, "link is filled in");
  assert.equal(t.submits.length, 0, "Resolve link not clicked before verification");
  assert.equal(t.sent.filter(m => m.type === "SUBMITTED").length, 0);
  assert.deepEqual(clicks, []);
  assert.equal(widgetChanged, false, "Cloudflare widget left alone");

  t.document.getElementById("resolve").disabled = false; // the user verified
  await sleep(100);
  assert.deepEqual(clicks, ["resolve"]);
  assert.equal(t.submits.length, 1);
});
