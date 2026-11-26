// SpeedSkip: content script for https://aizernal.xyz/
//
// Aizernal's form (checked against the live page):
//   <form id="link-form">
//     <input type="url" id="url" name="url" placeholder="https://srnky.com/..." required>
//     <button type="submit" id="resolve" disabled>Resolve link</button>
//     <div id="turnstile-widget"> (Cloudflare Turnstile)
// The page keeps #resolve disabled until Turnstile verification succeeds, and
// disables #url while a request is running. This script fills #url, waits for
// the page to enable #resolve, and clicks it once. It never interacts with
// the verification widget.
//
// Note: content scripts cannot use the tabs API. The pending URL is fetched
// from the service worker, which identifies the tab from the message sender.

(() => {
  "use strict";

  if (window.top !== window) return;           // top frame only
  if (window.__autoResolverStarted) return;    // run once per page load
  window.__autoResolverStarted = true;

  const RESOLVER = "aizernal";
  const TAG = "[SpeedSkip]";
  const MAX_WAIT_MS = 10 * 60 * 1000;          // slow loads + verification

  // Chrome/Opera: `chrome.*`. Firefox/Zen: `browser.*`. Both return promises.
  const ext = globalThis.browser ?? globalThis.chrome;

  async function send(message) {
    try {
      return (await ext.runtime.sendMessage(message)) || {};
    } catch (err) {
      return { error: String(err && err.message || err) }; // e.g. extension reloaded
    }
  }

  function report(text, level = "info") {
    (level === "error" ? console.warn : console.log)(TAG, text);
    send({ type: "REPORT", resolver: RESOLVER, level, text });
  }

  // --- element lookup ----------------------------------------------------

  function findForm() {
    return document.getElementById("link-form");
  }

  function findInput() {
    const form = findForm();
    const direct = form?.querySelector('input#url') ||
                   document.querySelector('input#url[name="url"]');
    if (direct) return direct;
    // Fallback if the id changes: the input labelled "Short link" in the form.
    for (const label of document.querySelectorAll("label[for]")) {
      if (/short\s*link/i.test(label.textContent)) {
        const el = document.getElementById(label.htmlFor);
        if (el && el.matches('input[type="url"], input[type="text"]')) return el;
      }
    }
    return null;
  }

  function findButton(input) {
    const form = input?.form || findForm();
    const direct = form?.querySelector('button#resolve[type="submit"]') ||
                   document.querySelector("button#resolve");
    if (direct) return direct;
    // Fallback: the form's submit button whose text says "Resolve".
    return [...(form?.querySelectorAll('button[type="submit"], button:not([type])') || [])]
      .find(b => /^\s*resolve\b/i.test(b.textContent)) || null;
  }

  // --- helpers -------------------------------------------------------------

  // Use the native setter so frameworks that track input.value see the change,
  // then fire the events a real paste/typing would produce.
  function setNativeValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set ||
                   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Resolves with check()'s first truthy result. Re-checks on every DOM change
  // (dynamic rendering, attribute flips such as `disabled`) and on a timer.
  function waitFor(check, timeoutMs) {
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearInterval(interval);
        clearTimeout(timer);
        resolve(value);
      };
      const run = () => {
        try {
          const value = check();
          if (value) finish(value);
        } catch (err) {
          console.warn(TAG, err);
        }
      };
      const observer = new MutationObserver(run);
      observer.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["disabled", "hidden", "id", "class"],
      });
      const interval = setInterval(run, 500);
      const timer = setTimeout(() => finish(null), timeoutMs);
      run();
    });
  }

  // --- main ------------------------------------------------------------------

  async function main() {
    // ?assist=<id> means Aizernal is resuming its own job; don't interfere.
    if (new URL(location.href).searchParams.has("assist")) return;

    const { pending, options = {}, error } =
      await send({ type: "GET_PENDING", resolver: RESOLVER });
    if (error) {
      report(`Could not reach the extension: ${error}`, "error");
      return;
    }
    if (!pending) {
      console.log(TAG, "No pending link for this tab; nothing to fill.");
      return;
    }
    const targetUrl = pending.url;
    const deadline = Date.now() + MAX_WAIT_MS;
    report(`Received original URL: ${targetUrl}`);

    // 1. Wait for the real form to render.
    const found = await waitFor(() => {
      const input = findInput();
      const button = input && findButton(input);
      return input && button ? { input, button } : null;
    }, MAX_WAIT_MS);
    if (!found) {
      report("Input field / Resolve link button not found. Paste the link manually: " +
             targetUrl, "error");
      return;
    }
    report(`Input field found (#${found.input.id || "?"}) and Resolve button found ` +
           `(#${found.button.id || "?"}).`);

    // 2. Fill the field (wait if the page has it disabled).
    const filled = await waitFor(() => {
      const input = findInput();
      if (!input || input.disabled) return null;
      if (input.value !== targetUrl) setNativeValue(input, targetUrl);
      return input.value === targetUrl ? input : null;
    }, Math.max(0, deadline - Date.now()));
    if (!filled) {
      report("Could not populate the input field. Paste the link manually: " + targetUrl,
             "error");
      return;
    }
    report("URL populated in the input field.");

    // 3. Wait for the page to enable Resolve link (it does so after the
    //    Cloudflare Turnstile verification succeeds).
    const initialButton = findButton(filled);
    if (initialButton?.disabled) {
      report("Waiting for Aizernal's verification to finish before clicking " +
             "Resolve link (complete it on the page if prompted).");
    }
    const ready = await waitFor(() => {
      const input = findInput();
      const button = input && findButton(input);
      if (!input || !button || input.disabled) return null;
      if (input.value !== targetUrl) setNativeValue(input, targetUrl); // page reset it
      if (input.value !== targetUrl || button.disabled) return null;
      return { input, button };
    }, Math.max(0, deadline - Date.now()));
    if (!ready) {
      report("Resolve link never became clickable (verification not completed in " +
             "time). The link is still in the field; click Resolve link yourself.",
             "error");
      return;
    }

    // 4. "Open destination in a new tab": stop Aizernal from navigating this
    //    tab itself (its "Open the destination automatically" checkbox);
    //    the extension opens the destination in a new tab instead.
    const newTab = options.openDestination === "new";
    const autoOpen = document.getElementById("auto-open");
    if (newTab && autoOpen?.checked) {
      autoOpen.checked = false;
      autoOpen.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // 5. Click exactly once; mark submitted first so a reload can't repeat it.
    await send({ type: "SUBMITTED", id: pending.id, url: targetUrl });
    ready.button.click();
    report("Clicked Resolve link.");

    watchResult(targetUrl, newTab);
  }

  // --- after submitting: destination & failure -------------------------------

  const FALLBACK_ID = "speedskip-fallback";

  function resultState() {
    const badge = document.getElementById("badge");
    const copy = document.getElementById("copy");
    const destination = document.getElementById("destination");
    const href = destination?.getAttribute("href") || "";
    // Aizernal only shows "Copy destination" once the link is fully resolved.
    if (copy && !copy.hidden && destination && !destination.hidden && /^https?:\/\//i.test(href)) {
      return { status: "resolved", destination: destination.href };
    }
    if (badge?.classList.contains("error")) return { status: "failed" };
    return { status: "working" };
  }

  function showFallbackButton(targetUrl) {
    let holder = document.getElementById(FALLBACK_ID);
    if (holder) {
      holder.hidden = false;
      return;
    }
    const anchor = document.getElementById("message") ||
                   document.getElementById("result") || document.body;
    holder = document.createElement("p");
    holder.id = FALLBACK_ID;
    holder.style.cssText = "margin:10px 0;";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Try bypass.city instead (SpeedSkip)";
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Opening bypass.city…";
      send({ type: "FALLBACK", url: targetUrl });
    });
    holder.append(button);
    anchor.after(holder);
    report("Aizernal could not resolve the link; offered bypass.city instead.", "error");
  }

  function watchResult(targetUrl, newTab) {
    let lastStatus = "";
    const stop = () => { observer.disconnect(); clearInterval(interval); clearTimeout(timer); };
    const check = () => {
      const { status, destination } = resultState();
      if (status === lastStatus) return;
      lastStatus = status;
      const fallback = document.getElementById(FALLBACK_ID);
      if (status === "failed") {
        showFallbackButton(targetUrl);
      } else if (fallback) {
        fallback.hidden = true;
      }
      if (status === "resolved") {
        stop();
        report(`Destination found: ${destination}`);
        if (newTab) {
          send({ type: "OPEN_DESTINATION", url: destination });
          report("Opening the destination in a new tab.");
        }
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["hidden", "class", "href"],
    });
    const interval = setInterval(check, 1000);
    const timer = setTimeout(stop, MAX_WAIT_MS);
    check();
  }

  main().catch(err => report(`Unexpected error: ${err && err.stack || err}`, "error"));
})();
