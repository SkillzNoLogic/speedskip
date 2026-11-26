# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"SpeedSkip" is a plain-JavaScript Chromium Manifest V3 extension for Chrome and Opera. When a tab opens a supported short link, the extension sends it to a resolver:

1. **bypass.city** is preferred. It receives `https://bypass.city/bypass?bypass=<encoded url>` and reads the URL from that parameter, so it needs no autofill.
2. **Aizernal** (`https://aizernal.xyz/`) is used otherwise. A content script fills Aizernal's form and submits it.
3. **Known shorteners that neither service supports** load normally. The extension injects a "Shortener unsupported" popup on the page and sets a red `!` badge on the toolbar icon.

Other features:
- A toolbar popup with an on/off switch, a skip counter, a paste-a-link field, the 10 most recent skips (with destinations and "try the other service"), and settings.
- A right-click "Skip with SpeedSkip" menu item on links.
- Keyboard shortcuts, which can be turned off in settings.
- A "Try bypass.city instead" button injected into Aizernal's page when Aizernal fails.

There is no build step. The extension's files load directly.

## Commands

- `npm install`, then `npm test` runs every test (`node --test tests/*.test.js`). The DOM tests need jsdom; set `JSDOM_PATH` to use a copy installed elsewhere.
- To run one file, use `node --test tests/background.test.js`. To run one test, add `--test-name-pattern "<name>"`.
- `npm run package` runs `scripts/package.js`, which builds two packages from the same source:
  - `dist/speedskip/` and `dist/speedskip.zip` for Chrome, Opera and other Chromium browsers. These use `manifest.json` as it is.
  - `dist/speedskip-firefox/`, `dist/speedskip-firefox.zip` and `.xpi` for Firefox and Zen. The Firefox manifest is generated from `manifest.json`:
    - `background.scripts` replaces `service_worker`.
    - It adds `browser_specific_settings.gecko` (the add-on id, `strict_min_version`, and `data_collection_permissions`).
    - It drops `minimum_chrome_version`.

  Never hand-edit a Firefox manifest. If you add a file to the extension, add it to `FILES` in the script.
- To try it in a browser, open `chrome://extensions` or `opera://extensions`, turn on Developer mode, choose Load unpacked, and select the repo root or `dist/speedskip`. Reload the extension after editing.
- To validate the Firefox build: `npx web-ext lint --source-dir dist/speedskip-firefox`. To try it in Firefox or Zen: `npx web-ext run --source-dir dist/speedskip-firefox --firefox <path to the firefox or zen binary>`. Add `--verbose` together with `--pref devtools.console.stdout.content=true` to see the `[SpeedSkip]` logs in the terminal.
- All log lines start with `[SpeedSkip]`. Service-worker logs appear under "Inspect views: service worker". Steps from the Aizernal page are also forwarded to the service-worker console through `REPORT` messages.

## Architecture

- **Cross-browser.** Every script uses `const ext = globalThis.browser ?? globalThis.chrome`, and only the promise-based API forms (no callbacks, no `runtime.lastError`), so the same code runs in Chrome/Opera and Firefox/Zen.
  - `background.js` calls `importScripts("domains.js")` only when `importScripts` exists (in Chrome). Firefox loads `domains.js` itself through `background.scripts`.
  - The popup's **Allow access** banner (`permissions.contains`/`request` for `<all_urls>`) is there for Firefox, which can install the extension without website access.
  - `commands.openShortcutSettings` is used when it exists (Firefox 137+).

- **`domains.js`** holds every domain list and the routing logic. It is shared by the service worker (`importScripts`), the popup (a `<script>` tag), and the Node tests (`module.exports`). It exposes `self.SpeedSkipRules`.
  - `classifyUrl(url, customRules, {explicit})` returns `{kind, resolver, domain, host}` or `null`. `kind` is `"supported"`, `"unsupported"`, or `"never"`.
  - **Automatic skipping is limited to known shorteners and link lockers.**
    - Paste sites and `google.com/url` live in rule sets marked `explicit: true`. They match only when `explicit` is set (through `classifyForExplicitSkip`: paste field, right-click, shortcut).
    - Hosts in `PROTECTED_DOMAINS`, plus any `google.<tld>`, always return `null` for automatic classification, even when a custom rule names them.
    - A test checks that no automatic list contains a protected host. Never add an ordinary website to an automatic list.
  - Rules are checked in this order:
    1. The user's `customRules` ("My sites", `{domain, action}`, where `action` is `bypassCity`, `aizernal`, or `never`).
    2. `AIZERNAL_FIRST_DOMAINS` (srnky.com always goes to Aizernal).
    3. bypass.city shorteners.
    4. Aizernal.
    5. bypass.city explicit-only sites.
    6. Unsupported.
  - A `never` match also carries `builtIn`, the explicit built-in classification. `classifyForExplicitSkip` uses it, because `never` rules apply only to automatic skipping, not to paste, right-click, or shortcut skips.
  - `normalizeRuleDomain` turns user input into a rule domain. `isProtectedUrl` lets the popup refuse auto-skip rules for protected sites. `aizernalSupports` decides whether "Try Aizernal" is offered.
  - Entries match subdomains, and an entry may include a path prefix (for example, `google.com/url`). Homepages (path `/` with no query and no hash) and resolver hosts are never matched.
- **`background.js`** is the MV3 service worker.
  - **One entry point.** Every navigation source goes through `consider(tabId, url, via)`:
    - `webNavigation.onBeforeNavigate`
    - `webRequest.onBeforeRedirect` (HTTP redirect hops)
    - `webNavigation.onCommitted`
    - `tabs.onUpdated`
  - **Explicit skips.** The paste field, the right-click menu, and the skip shortcut use `skipExplicitly`. It ignores the on/off switch and `never` rules.
  - **One place that navigates.** Every path that sends a tab to a resolver calls `sendTabToResolver`. It stores the pending URL, navigates the tab, and calls `recordSkip`, which updates the history and the counter.
  - **New tabs.** These are created as `about:blank` first, so the pending URL is stored under the new tab's id before Aizernal can load in it.
  - **Skipped navigations.** It ignores frames other than the top frame, prerenders (`documentLifecycle === "prerender"`), and `tabId < 0`.
  - **Session state.** Kept in `chrome.storage.session` under `STATE_KEY` and restored through the `ready` promise, so it survives service-worker suspension. Fields:
    - `pending[tabId]`: the Aizernal autofill job.
    - `committed[tabId]`: the tab's last committed URL.
    - `opener[tabId]`: the tab that opened this one.
    - `lastRedirect[tabId]`: used to de-duplicate events.
    - `sent[url]`: timestamps of when each URL was sent to a resolver.
    - `skipInTab[tabId]`: the last skip shown in that tab, used for destination capture and fallback.
  - **Local storage** (`chrome.storage.local`):
    - Settings written by the popup: `enabled`, `customRules`, `shortcutsEnabled`, `openDestination` (`"same"` or `"new"`). The worker caches them and updates them from `storage.onChanged`.
    - Data written only by the worker: `history` (newest first, at most 10) and `skipCount`. The popup clears history by sending `CLEAR_HISTORY`, not by writing to storage itself.
  - **Duplicate events.** One navigation fires several of these events. `consider` claims `lastRedirect` synchronously, right after `await ready` and before any other `await`.
  - **Loop prevention.**
    - A URL that was recently sent is let through when the tab is on a resolver page, or was opened from one.
    - Any URL sent `LOOP_MAX` times within `LOOP_WINDOW_MS` is let through.
  - **Destination capture.**
    - When a tab in `skipInTab` commits a non-resolver URL coming from a resolver page, with `transitionType === "link"` and no `forward_back` qualifier, that URL is recorded as the destination.
    - In new-tab mode, Aizernal's destination arrives through `OPEN_DESTINATION`.
  - **Messages from the popup.** Accepted only when `sender.id` is this extension and there is no `sender.tab`:
    - `RESOLVE_LINK {url}`
    - `RETRY {id, resolver}`
    - `CLEAR_HISTORY`
  - **Messages from `resolver.js`.** Accepted only when `sender.url` is a resolver origin:
    - `GET_PENDING {resolver}` returns `{pending, options: {openDestination}}`.
    - `SUBMITTED {id, url}`
    - `OPEN_DESTINATION {url}` (http(s) and non-resolver URLs only)
    - `FALLBACK {url}`
    - `REPORT {level, text}`
  - **Right-click menu.** Created in `runtime.onInstalled`.
  - **Commands** (`toggle-speedskip`, `skip-current-tab`) are defined in `manifest.json` and checked against `shortcutsEnabled`.
- **On/off switch.** When it is off, `consider` and the unsupported popup do nothing, and the global badge shows `OFF`. Per-tab badges reset with `text: null` so the global badge shows through.
- **`popup.html` / `popup.js`** make up the toolbar popup.
  - It reads settings, history, and the counter directly from `storage.local`, and stays live through `storage.onChanged`.
  - It writes settings directly. Skips, retries, and clearing history go through messages.
  - The switch animation is turned off until the first state render (the `.animate` class).
- **`resolver.js`** is the content script for `https://aizernal.xyz/*`.
  - It targets Aizernal's real form: `form#link-form`, `input#url[type=url]`, and `button#resolve`.
  - `#resolve` stays disabled until Cloudflare Turnstile passes. The script uses a `MutationObserver` plus polling for up to 10 minutes:
    1. Fill the field using the native value setter, then fire `input` and `change`.
    2. Wait until the page enables the button.
    3. In new-tab mode, untick Aizernal's `#auto-open` checkbox.
    4. Send `SUBMITTED`.
    5. Click once.
  - After the click, `watchResult` checks the outcome:
    - **Resolved:** `#copy` is visible and `#destination` has an http(s) href. In new-tab mode it sends `OPEN_DESTINATION`.
    - **Failed:** `#badge.error`. It injects the `#speedskip-fallback` button, which sends `FALLBACK`.
  - It skips `?assist=` URLs, because those are Aizernal resuming its own job.
  - Aizernal's own `app.js` (`render()`, `/api/config` with `supportedHosts`) shows how the page behaves. `tests/fixtures/aizernal.html` is a saved copy of the live page.

## Constraints

- Content scripts cannot use the `chrome.tabs` API. Calling `chrome.tabs.getCurrent` there throws an error. That bug broke autofill in v1.0.0. Anything scoped to a tab must go through a message to the service worker, which reads `sender.tab.id`.
- Register listeners synchronously at the top level of `background.js`. Never keep state that has to persist only in memory.
- Never interact with Turnstile or CAPTCHA widgets. The extension only waits for the page to enable the button.
- Do not call `chrome.*` directly or use callback-style APIs; go through `ext` (see Cross-browser above).
- In the jsdom and VM tests, compare arrays created inside the window or VM with JSON or spread, not `deepEqual` directly, because they come from a different realm.
- When you add domains, keep the README's description of the domain lists in sync with `domains.js`.
