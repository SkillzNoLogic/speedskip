// SpeedSkip: toolbar popup.
// On/off switch, skip counter, paste-a-link field, recent skips (with
// destinations and "try the other service"), and settings.
(() => {
  "use strict";

  // Chrome/Opera: `chrome.*`. Firefox/Zen: `browser.*`. Both return promises.
  const ext = globalThis.browser ?? globalThis.chrome;
  const $ = id => document.getElementById(id);
  const {
    RESOLVERS, classifyForExplicitSkip, normalizeRuleDomain, aizernalSupports, isProtectedUrl,
  } = self.SpeedSkipRules;

  const ACTION_LABELS = { bypassCity: "bypass.city", aizernal: "Aizernal", never: "Never skip" };
  const VIA_LABELS = {
    auto: "", paste: "pasted", "right-click": "right-click", shortcut: "shortcut",
    retry: "retry", fallback: "fallback",
  };

  let customRules = [];

  function show(el, text, kind = "") {
    el.textContent = text;
    el.className = "result" + (kind ? " " + kind : "");
  }

  function send(message) {
    return ext.runtime.sendMessage(message)
      .catch(err => ({ status: "error", error: String(err && err.message || err) }));
  }

  // --- on/off ---------------------------------------------------------------

  function showEnabled(on) {
    $("enabled").checked = on;
    $("state").textContent = on ? "On: skipping short links" : "Off: links open normally";
  }

  $("enabled").addEventListener("change", () => {
    showEnabled($("enabled").checked);
    ext.storage.local.set({ enabled: $("enabled").checked });
  });

  // --- counter --------------------------------------------------------------

  function showCount(n) {
    const count = Number.isFinite(n) ? n : 0;
    $("count").textContent = count.toLocaleString();
    $("count-label").textContent = count === 1 ? "link skipped" : "links skipped";
  }

  // --- paste a link -----------------------------------------------------------

  // Accept "ouo.io/abc" as well as full URLs; keep exactly what was pasted.
  function normalizeLink(raw) {
    const text = raw.trim();
    if (!text) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : "https://" + text;
    try {
      const u = new URL(withScheme);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (!u.hostname.includes(".")) return null;
      return withScheme;
    } catch {
      return null;
    }
  }

  function describeOutcome(response) {
    if (response?.status === "sent") return [`Opened in ${response.resolver}.`, "ok"];
    if (response?.status === "unsupported") {
      return [`Shortener unsupported: ${response.host || "this site"} isn't supported ` +
              "by bypass.city or Aizernal.", "bad"];
    }
    return [`Couldn't open the resolver: ${response?.error || "unknown error"}`, "bad"];
  }

  $("paste-form").addEventListener("submit", async event => {
    event.preventDefault();
    const url = normalizeLink($("link").value);
    if (!url) {
      show($("result"), "Enter a valid link, for example https://ouo.io/abc", "bad");
      $("link").focus();
      return;
    }
    $("go").disabled = true;
    show($("result"), "Opening…");
    const response = await send({ type: "RESOLVE_LINK", url });
    $("go").disabled = false;
    show($("result"), ...describeOutcome(response));
    if (response?.status === "sent") setTimeout(() => window.close(), 600);
  });

  // --- recent skips -----------------------------------------------------------

  function timeAgo(at) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  function shortUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname) + u.search;
    } catch {
      return url;
    }
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ""; }
  }

  function renderHistory(history) {
    const list = $("recent");
    list.replaceChildren();
    const items = Array.isArray(history) ? history.slice(0, 10) : [];
    $("recent-empty").hidden = items.length > 0;
    $("clear-history").hidden = items.length === 0;

    for (const entry of items) {
      const li = document.createElement("li");

      const top = document.createElement("div");
      top.className = "top";
      const url = document.createElement("span");
      url.className = "url";
      url.textContent = shortUrl(entry.url);
      url.title = entry.url;
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = RESOLVERS[entry.resolver]?.label || entry.resolver;
      top.append(url, chip);

      const dest = document.createElement("span");
      dest.className = "dest";
      if (entry.destination) {
        const a = document.createElement("a");
        a.href = entry.destination;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = "→ " + shortUrl(entry.destination);
        a.title = entry.destination;
        dest.append(a);
      } else {
        dest.className += " muted";
        dest.textContent = "No destination yet";
      }

      const actions = document.createElement("div");
      actions.className = "actions";
      const other = entry.resolver === "bypassCity" ? "aizernal" : "bypassCity";
      if (other === "bypassCity" || aizernalSupports(entry.url)) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "link";
        retry.textContent = `Try ${RESOLVERS[other].label}`;
        retry.addEventListener("click", async () => {
          retry.disabled = true;
          const response = await send({ type: "RETRY", id: entry.id, resolver: other });
          retry.disabled = false;
          show($("recent-result"), ...describeOutcome(response));
          if (response?.status === "sent") setTimeout(() => window.close(), 600);
        });
        actions.append(retry);
      }
      const ruleDomain = normalizeRuleDomain(hostOf(entry.url));
      const alreadyNever = customRules.some(r => r.domain === ruleDomain && r.action === "never");
      if (ruleDomain && !alreadyNever) {
        const never = document.createElement("button");
        never.type = "button";
        never.className = "link";
        never.textContent = "Never skip";
        never.title = `Stop skipping ${ruleDomain} automatically`;
        never.addEventListener("click", async () => {
          await saveRule(ruleDomain, "never");
          show($("recent-result"), `${ruleDomain} won't be skipped automatically.`, "ok");
        });
        actions.append(never);
      }
      const time = document.createElement("span");
      time.className = "time";
      const via = VIA_LABELS[entry.via];
      time.textContent = timeAgo(entry.at) + (via ? ` · ${via}` : "");
      actions.append(time);

      li.append(top, dest, actions);
      list.append(li);
    }
  }

  $("clear-history").addEventListener("click", () => send({ type: "CLEAR_HISTORY" }));

  // --- settings: destination tab ---------------------------------------------

  function showOpenDestination(value) {
    const v = value === "new" ? "new" : "same";
    for (const radio of document.querySelectorAll('input[name="open-destination"]')) {
      radio.checked = radio.value === v;
    }
  }

  for (const radio of document.querySelectorAll('input[name="open-destination"]')) {
    radio.addEventListener("change", () => {
      if (radio.checked) ext.storage.local.set({ openDestination: radio.value });
    });
  }

  // --- settings: keyboard shortcuts -------------------------------------------

  function showShortcuts(on) {
    $("shortcuts").checked = on;
    $("keys").style.opacity = on ? "1" : ".5";
  }

  $("shortcuts").addEventListener("change", () => {
    showShortcuts($("shortcuts").checked);
    ext.storage.local.set({ shortcutsEnabled: $("shortcuts").checked });
  });

  function renderKeys(commands) {
    const list = $("keys");
    list.replaceChildren();
    for (const cmd of commands || []) {
      if (!cmd.description || cmd.name === "_execute_action") continue;
      const li = document.createElement("li");
      const key = document.createElement("kbd");
      key.textContent = cmd.shortcut || "not set";
      li.append(key, " " + cmd.description);
      list.append(li);
    }
  }

  $("change-keys").addEventListener("click", async () => {
    // Firefox/Zen 137+: opens about:addons -> Manage Extension Shortcuts.
    if (typeof ext.commands?.openShortcutSettings === "function") {
      try { await ext.commands.openShortcutSettings(); return; } catch {}
    }
    if (typeof globalThis.browser !== "undefined") {
      // Older Firefox can't open about:addons from an extension.
      show($("keys-result"), "Open about:addons → ⚙ → Manage Extension Shortcuts.");
      return;
    }
    ext.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  // --- Firefox/Zen: website access ---------------------------------------------
  // Firefox can install the extension without access to websites (shown as
  // "Access your data for all websites" under Permissions). Without it nothing
  // can be skipped, so offer to grant it.

  const ALL_SITES = { origins: ["<all_urls>"] };

  async function checkSiteAccess() {
    if (!ext.permissions?.contains) return;
    let granted = true;
    try { granted = await ext.permissions.contains(ALL_SITES); } catch {}
    $("access").hidden = granted;
  }

  $("grant-access").addEventListener("click", async () => {
    try {
      // Must run straight from the click (user gesture).
      const ok = await ext.permissions.request(ALL_SITES);
      $("access").hidden = ok;
    } catch (err) {
      show($("access-result"), String(err && err.message || err), "bad");
    }
  });

  checkSiteAccess();

  // --- settings: my sites -------------------------------------------------------

  async function saveRule(domain, action) {
    customRules = customRules.filter(r => r.domain !== domain).concat({ domain, action });
    await ext.storage.local.set({ customRules });
  }

  function renderRules() {
    const list = $("rules");
    list.replaceChildren();
    for (const rule of customRules) {
      const li = document.createElement("li");
      const domain = document.createElement("span");
      domain.className = "domain";
      domain.textContent = rule.domain;
      domain.title = rule.domain;
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = ACTION_LABELS[rule.action] || rule.action;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${rule.domain}`);
      remove.addEventListener("click", () => {
        customRules = customRules.filter(r => r !== rule);
        ext.storage.local.set({ customRules });
      });
      li.append(domain, chip, remove);
      list.append(li);
    }
  }

  $("rule-form").addEventListener("submit", async event => {
    event.preventDefault();
    const domain = normalizeRuleDomain($("rule-domain").value);
    if (!domain) {
      show($("rule-result"), "Enter a site like example.com or example.com/path", "bad");
      return;
    }
    const action = $("rule-action").value;
    if (action !== "never" && isProtectedUrl(domain)) {
      show($("rule-result"), `${domain} is a common site, so SpeedSkip never skips it ` +
           "automatically. Use the paste field or right-click instead.", "bad");
      return;
    }
    await saveRule(domain, action);
    $("rule-domain").value = "";
    show($("rule-result"), `${domain}: ${ACTION_LABELS[action]}`, "ok");
  });

  // --- load & live updates --------------------------------------------------------

  let lastHistory = [];

  ext.storage.local.get(
    ["enabled", "skipCount", "history", "openDestination", "shortcutsEnabled", "customRules"])
    .catch(() => ({}))
    .then(data => {
      customRules = Array.isArray(data.customRules) ? data.customRules : [];
      lastHistory = data.history;
      showEnabled(data.enabled !== false);
      showCount(data.skipCount);
      showOpenDestination(data.openDestination);
      showShortcuts(data.shortcutsEnabled !== false);
      renderRules();
      renderHistory(lastHistory);
      requestAnimationFrame(() => document.body.classList.add("animate"));
    });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("history" in changes) lastHistory = changes.history.newValue;
    if ("customRules" in changes) {
      customRules = Array.isArray(changes.customRules.newValue) ? changes.customRules.newValue : [];
      renderRules();
    }
    if ("history" in changes || "customRules" in changes) renderHistory(lastHistory);
    if ("enabled" in changes) showEnabled(changes.enabled.newValue !== false);
    if ("skipCount" in changes) showCount(changes.skipCount.newValue);
    if ("openDestination" in changes) showOpenDestination(changes.openDestination.newValue);
    if ("shortcutsEnabled" in changes) showShortcuts(changes.shortcutsEnabled.newValue !== false);
  });

  if (ext.commands?.getAll) ext.commands.getAll().then(renderKeys).catch(() => {});

  // If the current tab is on a shortener, offer it in the paste field.
  ext.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      const match = tab?.url && classifyForExplicitSkip(tab.url, customRules);
      if (match && !$("link").value) $("link").value = tab.url;
    })
    .catch(() => {});

  $("link").focus();
})();
