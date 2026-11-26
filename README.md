# SpeedSkip

A Manifest V3 browser extension. It comes in two builds:

- **Chrome, Opera, Edge, Brave and other Chromium browsers:** the `speedskip`
  folder, or `speedskip.zip`.
- **Firefox and Zen:** the `speedskip-firefox` folder, or `speedskip-firefox.xpi`.

Download them from the
[Releases page](https://github.com/SkillzNoLogic/speedskip/releases/latest).
Step-by-step instructions for each browser are under [Install](#install).

## Install

SpeedSkip isn't in the Chrome Web Store or on Firefox Add-ons. You install it
from a file. Pick your browser:

| Browser | Download | Instructions |
|---|---|---|
| Google Chrome | `speedskip.zip` | [Chrome](#google-chrome) |
| Opera, Opera GX | `speedskip.zip` | [Opera](#opera-and-opera-gx) |
| Microsoft Edge | `speedskip.zip` | [Edge](#microsoft-edge) |
| Brave, Vivaldi, Arc, other Chromium browsers | `speedskip.zip` | [Brave and others](#brave-vivaldi-arc-and-other-chromium-browsers) |
| Zen | `speedskip-firefox.xpi` | [Zen](#zen) |
| Firefox Developer Edition, Nightly, ESR | `speedskip-firefox.xpi` | [Firefox Developer Edition, Nightly and ESR](#firefox-developer-edition-nightly-and-esr) |
| Regular Firefox | `speedskip-firefox.zip` | [Regular Firefox](#regular-firefox) |

Safari is not supported.

All downloads are on the
[Releases page](https://github.com/SkillzNoLogic/speedskip/releases/latest),
under **Assets**.

### Google Chrome

1. **Download.** On the
   [Releases page](https://github.com/SkillzNoLogic/speedskip/releases/latest),
   click `speedskip.zip` under **Assets**.
2. **Unzip it.**
   - **Mac:** double-click `speedskip.zip` in Downloads. This creates a
     `speedskip` folder.
   - **Windows:** right-click `speedskip.zip`, choose **Extract All…**, then
     **Extract**.
3. **Put the folder somewhere permanent,** such as Documents. Chrome loads
   the extension from this folder every time it starts. If you delete or move
   the folder, SpeedSkip stops working.
4. **Open the extensions page.** Type `chrome://extensions` in the address
   bar and press Enter.
5. **Turn on Developer mode** with the switch in the top-right corner.
6. **Load the extension.** Click **Load unpacked**, which appears at the top
   left after step 5. Select the `speedskip` folder, the one that contains
   `manifest.json`, and click **Select** (Mac) or **Select Folder**
   (Windows).
7. **Pin it.** Click the puzzle-piece icon to the right of the address bar,
   then the pin next to **SpeedSkip**. The icon then stays visible in your
   toolbar.

You may see a **Disable developer mode extensions** warning when Chrome
starts. Close it or click **Cancel**. Don't click **Disable**.

### Opera and Opera GX

1. **Download** `speedskip.zip` from the
   [Releases page](https://github.com/SkillzNoLogic/speedskip/releases/latest).
2. **Unzip it** (see [Chrome](#google-chrome), step 2).
3. **Move the `speedskip` folder somewhere permanent,** such as Documents.
4. **Open the extensions page.** Type `opera://extensions` in the address
   bar and press Enter. You can also press `Ctrl+Shift+E` on Windows or
   `⌘+Shift+E` on a Mac.
5. **Turn on Developer mode** with the switch in the top-right corner.
6. **Load the extension.** Click **Load unpacked** and select the
   `speedskip` folder.
7. **Pin it.** Click the cube icon (Extensions) on the right of the toolbar,
   then the pin next to **SpeedSkip**.

### Microsoft Edge

1. **Download and unzip** `speedskip.zip` (see [Chrome](#google-chrome),
   steps 1–3), and keep the `speedskip` folder somewhere permanent.
2. **Open the extensions page.** Type `edge://extensions` in the address
   bar and press Enter.
3. **Turn on Developer mode** with the switch in the left sidebar. On a
   narrow window, open the ☰ menu first to see the sidebar.
4. **Load the extension.** Click **Load unpacked** and select the
   `speedskip` folder.
5. **Pin it.** Click the puzzle-piece icon in the toolbar, then the eye icon
   next to **SpeedSkip** (**Show in toolbar**).

### Brave, Vivaldi, Arc and other Chromium browsers

Follow the [Chrome](#google-chrome) steps, but in step 4 use your
browser's extensions page:

| Browser | Extensions page |
|---|---|
| Brave | `brave://extensions` |
| Vivaldi | `vivaldi://extensions` |
| Arc and others | `chrome://extensions` |

### Zen

Zen needs one setting changed first, because SpeedSkip isn't signed by Mozilla.

1. **Download.** On the
   [Releases page](https://github.com/SkillzNoLogic/speedskip/releases/latest),
   click `speedskip-firefox.xpi` under **Assets**. If Zen offers to install
   it right away and then says the add-on is corrupt or unverified, continue
   with step 2 and install it from the file.
2. **Allow unsigned add-ons.**
   1. Type `about:config` in the address bar, press Enter, and click
      **Accept the Risk and Continue**.
   2. In the search box, type `xpinstall.signatures.required`.
   3. Click the ⇌ toggle button on the right so the value changes to
      `false`.
3. **Install.**
   1. Type `about:addons` in the address bar and press Enter.
   2. Click the ⚙ gear at the top of the list and choose **Install Add-on
      From File…**.
   3. Select `speedskip-firefox.xpi` in Downloads and click **Open**.
   4. Click **Add** when Zen asks.
4. **Give it website access.**
   1. Open the SpeedSkip popup.
   2. If it shows **SpeedSkip needs access to websites**, click **Allow
      access**, then **Allow**.
   3. Alternatively, go to `about:addons` → **SpeedSkip** → **Permissions**
      and turn on **Access your data for all websites**.

   SpeedSkip can't detect links without this access.
5. **Pin it.** Click the puzzle-piece (Extensions) icon in the toolbar,
   click the ⚙ next to **SpeedSkip**, and choose **Pin to Toolbar**.

This is a permanent install, and it stays after you restart Zen.

### Firefox Developer Edition, Nightly and ESR

These versions of Firefox allow unsigned add-ons. Follow the [Zen](#zen)
steps exactly.

### Regular Firefox

Regular Firefox (the standard release) only keeps add-ons that Mozilla has
signed, and the `about:config` setting has no effect. You have two options.

**Option A: try it out (removed when Firefox restarts)**

1. Download `speedskip-firefox.zip` from the
   [Releases page](https://github.com/SkillzNoLogic/speedskip/releases/latest)
   and unzip it to a `speedskip-firefox` folder.
2. Type `about:debugging#/runtime/this-firefox` in the address bar and press
   Enter.
3. Click **Load Temporary Add-on…** and select `manifest.json` inside the
   `speedskip-firefox` folder.
4. Give it website access ([Zen](#zen), step 4).

You need to repeat these steps every time Firefox restarts.

**Option B: get it signed by Mozilla (permanent, free)**

Only the person who publishes SpeedSkip needs to do this, once per version.
Everyone else then installs the signed file.

1. Sign in, or create a free account, at
   https://addons.mozilla.org/developers/.
2. Click **Submit a New Add-on**.
3. Choose **On your own**. This signs the add-on without listing it
   publicly.
4. Upload `speedskip-firefox.zip` and wait for the automatic check to pass.
5. Continue through the remaining pages, then download the signed `.xpi`.
6. To install the signed `.xpi`, drag it into a Firefox window, or use
   `about:addons` → ⚙ → **Install Add-on From File…**, then click **Add**.
7. Give it website access ([Zen](#zen), step 4).

### Check that it works

1. Click the SpeedSkip icon in your toolbar. The switch should be **on**.
2. Paste a short link (for example, an `ouo.io/…` link) into the field and
   press **Bypass**.

A new tab should open on bypass.city or Aizernal. Complete the verification
check if one appears.

### Updating to a new version

Your settings, history and skip counter are kept when you update.

- **Chrome, Opera, Edge, Brave:**
  1. Download the new `speedskip.zip` and unzip it.
  2. Replace the contents of your existing `speedskip` folder with the new
     files.
  3. Click the reload ↻ button on the SpeedSkip card on the extensions page.
- **Zen, Firefox Developer Edition, Nightly and ESR:** download the new
  `speedskip-firefox.xpi` and install it the same way (`about:addons` → ⚙ →
  **Install Add-on From File…**).

### Changing keyboard shortcuts

| Browser | Where |
|---|---|
| Chrome, Brave, Arc | `chrome://extensions/shortcuts` |
| Opera | `opera://extensions/shortcuts` |
| Edge | `edge://extensions/shortcuts` |
| Zen, Firefox | `about:addons` → ⚙ → **Manage Extension Shortcuts** |

The **Change shortcuts** button in the SpeedSkip popup's settings opens the
right page.

### Uninstalling

- **Chromium browsers:** click **Remove** on the SpeedSkip card on the
  extensions page.
- **Zen and Firefox:** go to `about:addons`, click **…** next to SpeedSkip,
  and choose **Remove**.

After removing it, you can delete the `speedskip` folder.

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
