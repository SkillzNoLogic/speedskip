# SpeedSkip

A Manifest V3 browser extension. It comes in two builds:

- **Chrome, Opera, Edge, Brave and other Chromium browsers:** the `speedskip`
  folder, or `speedskip.zip`.
- **Firefox and Zen:** the `speedskip-firefox` folder, or `speedskip-firefox.xpi`.

## What it does

When a tab opens a supported short link, the extension sends it to a resolver.
It catches links however you reach them: typed or pasted in the address bar,
clicked links, new tabs, bookmarks, history, and redirect chains.

0. **srnky.com always goes to Aizernal.** Domains listed in
   `AIZERNAL_FIRST_DOMAINS` go to Aizernal even if bypass.city also supports them.
1. **bypass.city first.** If bypass.city supports the domain, the tab opens
   `https://bypass.city/bypass?bypass=<original link>`.
2. **Aizernal second.** Otherwise, if Aizernal supports it, the tab opens
   https://aizernal.xyz/. The extension then puts the exact original link in the
   **Short link** field and clicks **Resolve link** once.
3. **Neither.** For known ad-link shorteners that neither service supports, the
   page loads normally. A **Shortener unsupported** popup appears on the page,
   and the toolbar icon shows a red `!`.

Both resolver sites ask for human verification (Cloudflare Turnstile or a
CAPTCHA). The extension does not bypass these checks. On Aizernal it waits until
the page enables **Resolve link** before clicking it. If Aizernal shows a
verification challenge, complete it, and the extension clicks the button
afterwards.

## Toolbar popup

Click the extension's toolbar icon to open the popup.

- **On/off switch.** When it's off, short links open normally, no pages are
  intercepted, and the icon shows a grey `OFF` badge. The setting is kept after
  you restart the browser.
- **Skip counter.** Shows how many links SpeedSkip has skipped in total.
- **Bypass a link.** Paste a short link and press **Bypass** (or Enter). It
  opens in a new tab with the same resolver the automatic mode would use.
  Links without `https://` (for example, `ouo.io/abc`) are accepted. If the link
  isn't supported, the popup says **Shortener unsupported**. This field works
  even when the switch is off. If the current tab is already on a shortener, its
  link is filled in for you.
- **Recent skips.** Shows the last 10 skipped links, with the service used, when
  the skip happened, and where it ended up (click the destination to reopen it).
  - **Try bypass.city / Try Aizernal** opens the link with the other service if
    the first one failed. Aizernal is offered only for links it supports.
  - **Never skip** stops that site from being skipped automatically.
- **Settings** (collapsed at the bottom of the popup):
  - **Aizernal opens the destination in Same tab / New tab.** In New tab mode,
    SpeedSkip turns off Aizernal's own auto-open and opens the destination in a
    new tab next to it. bypass.city decides this on its own page.
  - **Keyboard shortcuts** on/off. The defaults are `Alt+Shift+S` to turn
    SpeedSkip on or off, and `Alt+Shift+K` to skip the link in the current tab.
    On a Mac, Alt is the Option key. To change the keys, click **Change shortcuts**.
  - **My sites.** Add a site and choose **bypass.city**, **Aizernal**, or
    **Never skip**. Your rules override the built-in lists. You can enter a path
    to limit a rule, for example `example.com/go`. Remove a rule with `×`.

## Right-click menu

Right-click any link and choose **Skip with SpeedSkip**. The link opens in a new
tab with the right service, even when automatic skipping is off. If the link
isn't supported, a **Shortener unsupported** popup appears on the page.

## When Aizernal fails

If Aizernal shows **Could not resolve**, SpeedSkip adds a **Try bypass.city
instead** button to Aizernal's page. Clicking it sends the same link to
bypass.city in that tab.

## Domains

All domain lists are in `domains.js`:

- `BYPASS_CITY_LINK_DOMAINS` and `BYPASS_CITY_PASTE_DOMAINS`: taken from the
  supported-site list on bypass.city.
- `AIZERNAL_DOMAINS`: srnky.com, shrinkearn.com, shrinkme.click/.io/.site,
  cuty.io, cuttty.com, ouo.io, ouo.press, advertisingcamps.com, loanbixby.com.
- `UNSUPPORTED_SHORTENER_DOMAINS`: shorteners that trigger the popup.

Subdomains match automatically. To limit a rule to one path, add the path to
the entry (for example, `google.com/url`). A site's homepage (`https://ouo.io/`)
is never intercepted. After editing the lists, reload the extension.

**Only known shorteners are skipped automatically.**

- **Paste sites and Google redirects are explicit only.** bypass.city can also
  unpack paste sites (pastebin.com, telegra.ph, gist.github.com and others) and
  Google's `google.com/url` redirect links. These are ordinary sites, so
  SpeedSkip only sends them to bypass.city when you paste them into the popup,
  right-click them, or use the skip shortcut. To skip paste sites automatically
  as well, set `AUTO_SKIP_PASTE_SITES = true` in `domains.js`.
- **Common sites are never skipped automatically.** These include Google in
  every country, YouTube, GitHub, Wikipedia, Reddit, social media, Discord,
  Telegram, Mega and MediaFire (`PROTECTED_DOMAINS`). This holds even if a list
  or a **My sites** rule names one. My sites still accepts **Never skip** for
  them.

## Install in Opera

1. Unzip `speedskip.zip`.
2. Open `opera://extensions`.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the `speedskip` folder.

In Chrome, follow the same steps at `chrome://extensions`.

## Install in Zen or Firefox

Use the Firefox build: the `speedskip-firefox` folder, or `speedskip-firefox.xpi`.

**Zen (permanent install):**

1. Type `about:config` in the address bar, accept the warning, search for
   `xpinstall.signatures.required`, and set it to `false`.
2. Open `about:addons`, click the ⚙ gear, and choose **Install Add-on From File…**.
3. Pick `speedskip-firefox.xpi` and confirm the install.

**Firefox Developer Edition, Nightly or ESR:** the same steps as Zen work.

**Regular Firefox:** it only installs add-ons signed by Mozilla. You have two
options:

- **Try it out (temporary).** Open `about:debugging#/runtime/this-firefox`,
  click **Load Temporary Add-on…**, and pick `manifest.json` inside the
  `speedskip-firefox` folder. It is removed when Firefox restarts.
- **Keep it (free signing).** Sign in at https://addons.mozilla.org/developers/,
  choose **Submit a New Add-on → On your own**, and upload
  `speedskip-firefox.zip`. Mozilla checks it automatically and gives you a
  signed `.xpi`, which anyone can install by opening it in Firefox.

If the SpeedSkip popup shows **SpeedSkip needs access to websites**, click
**Allow access**. Firefox can install add-ons without website access, and
SpeedSkip can't skip anything without it.

In Firefox and Zen, keyboard shortcuts are changed at `about:addons` → ⚙ →
**Manage Extension Shortcuts**.

## Debugging

All messages start with `[SpeedSkip]`.

- **Service worker:** open the extension's card in the extensions page and select
  **Inspect views: service worker**. It logs detected links, stored URLs,
  redirects, and the Aizernal steps reported back by the page.
- **Aizernal page:** its DevTools console shows whether the input field was
  found, whether the URL was filled in, and whether **Resolve link** was clicked.

## Loop protection

- If you open the original link from a resolver page (for example, Aizernal's
  **Open original link**), the link loads normally instead of going back to the
  resolver.
- If the same link is sent to a resolver 3 times within 2 minutes, it is let
  through.
- The extension ignores iframes, prerendered pages, and the resolver sites
  themselves.

## Tests

Run `npm install` and then `npm test`. The tests use Node's built-in test runner
with jsdom, and run `resolver.js` against a saved copy of Aizernal's page.
