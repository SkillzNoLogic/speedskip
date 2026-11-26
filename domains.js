// SpeedSkip: domain rules (edit this file to add or remove domains).
//
// Each entry is a registered domain ("example.com"); its subdomains match too.
// An entry can also carry a path prefix ("google.com/url") so that only that
// path is intercepted. Short-link *homepages* (path "/" with no query) are
// never intercepted, so you can still browse a shortener's own site.
//
// Priority: AIZERNAL_FIRST_DOMAINS > bypass.city > Aizernal > "unsupported
// shortener" popup. Otherwise a domain listed under both resolvers goes to
// bypass.city.
//
// Automatic skipping only ever acts on known shorteners / link lockers.
// Ordinary sites that bypass.city can also unpack (paste sites, Google's
// /url redirector) are EXPLICIT ONLY: they are skipped when you paste them,
// right-click them or use the skip shortcut, never automatically. Common
// sites in PROTECTED_DOMAINS are never skipped automatically, whatever any
// list or "My sites" rule says.
//
// Loaded by the service worker via importScripts() and by the Node tests.

(function (root) {
  "use strict";

  // Paste sites (pastebin.com, telegra.ph, rentry...) are ordinary sites, not
  // shorteners. They are explicit-only unless this is set to true.
  const AUTO_SKIP_PASTE_SITES = false;

  // bypass.city: link lockers / shorteners.
  // Source: the supported-site list published on https://bypass.city/
  const BYPASS_CITY_LINK_DOMAINS = [
    // Linkvertise
    "linkvertise.com", "linkvertise.download", "link-center.net", "link-target.net",
    "link-hub.net", "link-to.net", "direct-link.net", "file-link.net",
    // Cutty
    "cuty.io", "cuttty.com",
    "shrinkme.click",
    // RedirectResolver
    "bestnsfw.site", "directlinker.com", "jpst.it", "pasterlink.com", "up-to-down.net",
    "sub2get.com",
    "sub2unlock.me", "sub2unlock.com", "sub2unlock.net",
    // Lootlinks
    "loot-links.com", "loot-link.com", "lootlinks.co", "lootlink.org", "lootdest.org",
    "linksloot.net", "links-loot.com", "lootdest.com", "links.lootlabs.gg",
    "adfoc.us",
    // Boost.ink
    "boost.ink", "bst.gg", "bst.wtf", "booo.st",
    "boost.fusedgt.com",
    "leasurepartment.xyz",
    "letsboost.net",
    "mboost.me",
    // Rekonise
    "rekonise.com", "rkns.link",
    // shorte.st
    "shorte.st", "sh.st", "gestyy.com", "destyy.com",
    "v.gd", "is.gd", "tinyurl.com", "bit.ly", "rebrand.ly",
    "egirls.wtf",
    "empebau.eu",
    "socialwolvez.com",
    "sub1s.com",
    "tinylink.onl",
    "subfinal.com", "subtolink.com",
    "justpaster.lol",          // Location Redirect
    "ad-maven.com",
    // Named in your list but not in bypass.city's published domain map;
    // the names are themselves domains, so they are included as-is.
    "vplink.in",
    "exe.io",
    "lockr.to",
    "linkunlocker.com",
    "link2unlock.com",
    // Not added: BstShrt, BoostyLink, Mavenlinks, Quickgate, LinkGec, and
    // dragonslayer / BaseResolver / ParamsResolver (bypass.city lists no
    // domains for them). Add their domains here once known.
  ];

  // bypass.city: supported, but ordinary sites rather than shorteners, so
  // explicit-only (paste field, right-click, shortcut).
  const BYPASS_CITY_EXPLICIT_ONLY_DOMAINS = [
    "google.com/url",          // google-url: Google's /url redirector
  ];

  // bypass.city: paste services (explicit-only unless AUTO_SKIP_PASTE_SITES).
  const BYPASS_CITY_PASTE_DOMAINS = [
    "pastebin.com",
    "pastelua.com",
    "pastelink.net",
    "pastesite.net",
    "rentry.org", "rentry.co", "rentry.xyz",
    "justpaste.it",
    // EcoDevs
    "gopaste.link", "getpaste.link", "notecanyon.com", "pastehill.com", "spacebin.in",
    "pastecanyon.com", "freepaste.link", "justetext.com", "pastetoday.com",
    "pastemega.com", "expaste.com", "pastemake.online", "pastezone.site",
    "pastemode.com", "paskyk.com", "mypastelink.com",
    "controlc.com",
    "paste.work.ink",
    "paste.to",                // PrivateBin
    "paster.so",
    "hastebin.skyra.pw", "hastebin.de",
    "bstlar.com",
    "paste-drop.com",
    "leakutopia.click",
    "leakslinks.com",
    "goldpaster.pro",
    "pasteso.com",
    "link-direct.xyz", "link-direct.pro",
    "n0paste.eu",
    "pasteflash.com",
    "pasteva.com",
    "leaked.tools",
    "telegra.ph",              // Telegraph
    "vaultlinks.xyz",
    // Named in your list but not in bypass.city's published domain map:
    "anotepad.com",
    "pastefy.app",
    "gist.github.com",         // GitHub Gist (gist pages only, not all of github.com)
    // Not added (domain unknown): RazPaste, PasteView, Thpaste.
  ];

  // Aizernal. Source: https://aizernal.xyz/api/config "supportedHosts".
  // Domains also supported by bypass.city (cuty.io, cuttty.com,
  // shrinkme.click) stay listed but are routed to bypass.city.
  // Always sent to Aizernal, even if bypass.city also lists them.
  const AIZERNAL_FIRST_DOMAINS = [
    "srnky.com",
  ];

  const AIZERNAL_DOMAINS = [
    "srnky.com",
    "shrinkearn.com",
    "shrinkme.click",
    "shrinkme.io",
    "shrinkme.site",
    "cuty.io",
    "cuttty.com",
    "ouo.io",
    "ouo.press",
    "advertisingcamps.com",
    "loanbixby.com",
  ];

  // Known ad-link shorteners that neither service supports. Visiting one shows
  // a "Shortener unsupported" popup on the page (the page itself still loads).
  const UNSUPPORTED_SHORTENER_DOMAINS = [
    "adf.ly", "j.gs", "q.gs",
    "gplinks.co", "gplinks.in",
    "droplink.co",
    "clk.sh",
    "oke.io",
    "fc.lc",
    "za.gl",
  ];

  const RESOLVERS = {
    bypassCity: {
      label: "bypass.city",
      hosts: ["bypass.city", "adbypass.org"],
      autofill: false, // bypass.city reads the link from its ?bypass= parameter
      buildUrl: url => "https://bypass.city/bypass?bypass=" + encodeURIComponent(url),
    },
    aizernal: {
      label: "Aizernal",
      hosts: ["aizernal.xyz"],
      autofill: true, // resolver.js fills #url and clicks #resolve
      buildUrl: () => "https://aizernal.xyz/",
    },
  };

  // ---------------------------------------------------------------------------

  function normalizeHost(host) {
    return String(host || "").toLowerCase().replace(/\.$/, "");
  }

  function hostMatches(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  function compile(entries) {
    return entries.map(entry => {
      const slash = entry.indexOf("/");
      return slash < 0
        ? { domain: normalizeHost(entry), path: null }
        : { domain: normalizeHost(entry.slice(0, slash)), path: entry.slice(slash) };
    });
  }

  function pathMatches(pathname, path) {
    if (path == null) return true;
    const prefix = path.endsWith("/") ? path : path + "/";
    return pathname === path || pathname.startsWith(prefix);
  }

  // Common sites that are never skipped automatically (a safety net in case a
  // list above ever contains one). Explicit skips still work. Any google.<tld>
  // is protected too (see isProtectedHost).
  const PROTECTED_DOMAINS = [
    "google.com", "youtube.com", "youtu.be", "gmail.com", "bing.com", "yahoo.com",
    "duckduckgo.com", "github.com", "gitlab.com", "wikipedia.org", "facebook.com",
    "instagram.com", "whatsapp.com", "twitter.com", "x.com", "reddit.com",
    "linkedin.com", "tiktok.com", "twitch.tv", "discord.com", "discord.gg",
    "telegram.org", "t.me", "amazon.com", "apple.com", "microsoft.com",
    "live.com", "outlook.com", "office.com", "netflix.com", "spotify.com",
    "dropbox.com", "mega.nz", "mediafire.com", "cloudflare.com", "mozilla.org",
    "opera.com", "stackoverflow.com", "paypal.com",
  ];

  function isProtectedHost(host) {
    return PROTECTED_DOMAINS.some(d => hostMatches(host, d)) ||
           /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
  }

  const BYPASS_CITY_AUTO = BYPASS_CITY_LINK_DOMAINS.concat(
    AUTO_SKIP_PASTE_SITES ? BYPASS_CITY_PASTE_DOMAINS : []);
  const BYPASS_CITY_EXPLICIT = BYPASS_CITY_EXPLICIT_ONLY_DOMAINS.concat(
    AUTO_SKIP_PASTE_SITES ? [] : BYPASS_CITY_PASTE_DOMAINS);

  // `explicit: true` sets only apply to explicit skips.
  const RULE_SETS = [
    { kind: "supported", resolver: "aizernal", rules: compile(AIZERNAL_FIRST_DOMAINS) },
    { kind: "supported", resolver: "bypassCity", rules: compile(BYPASS_CITY_AUTO) },
    { kind: "supported", resolver: "aizernal", rules: compile(AIZERNAL_DOMAINS) },
    { kind: "supported", resolver: "bypassCity", rules: compile(BYPASS_CITY_EXPLICIT),
      explicit: true },
    { kind: "unsupported", resolver: null, rules: compile(UNSUPPORTED_SHORTENER_DOMAINS) },
  ];

  const RESOLVER_HOSTS = Object.values(RESOLVERS).flatMap(r => r.hosts);

  function parseHttpUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      return u.protocol === "http:" || u.protocol === "https:" ? u : null;
    } catch {
      return null;
    }
  }

  function isResolverUrl(rawUrl) {
    const u = parseHttpUrl(rawUrl);
    if (!u) return false;
    const host = normalizeHost(u.hostname);
    return RESOLVER_HOSTS.some(d => hostMatches(host, d));
  }

  // The user's own rules from the popup ("My sites"), checked before the
  // built-in lists. Each is { domain: "example.com[/path]", action } where
  // action is "bypassCity", "aizernal" or "never".
  const CUSTOM_ACTIONS = ["bypassCity", "aizernal", "never"];

  function compileCustom(customRules) {
    if (!Array.isArray(customRules)) return [];
    return customRules
      .filter(r => r && typeof r.domain === "string" && CUSTOM_ACTIONS.includes(r.action))
      .map(r => ({ ...compile([r.domain])[0], action: r.action }));
  }

  function classifyBuiltIn(u, host, explicit) {
    for (const set of RULE_SETS) {
      if (set.explicit && !explicit) continue;
      for (const rule of set.rules) {
        if (hostMatches(host, rule.domain) && pathMatches(u.pathname, rule.path)) {
          return { kind: set.kind, resolver: set.resolver, domain: rule.domain, host };
        }
      }
    }
    return null;
  }

  // Returns null for URLs the extension must leave alone, otherwise
  // { kind: "supported" | "unsupported" | "never", resolver, domain, host }.
  // Default (automatic skipping): known shorteners only; protected common
  // sites always return null. { explicit: true }: also explicit-only sites
  // and protected hosts, for links the user asked to skip.
  // "never" (a user rule) also carries `builtIn`: what the built-in lists say
  // for an explicit skip.
  function classifyUrl(rawUrl, customRules = [], { explicit = false } = {}) {
    const u = parseHttpUrl(rawUrl);
    if (!u) return null;
    const host = normalizeHost(u.hostname);
    if (RESOLVER_HOSTS.some(d => hostMatches(host, d))) return null;
    if (u.pathname === "/" && !u.search && !u.hash) return null; // site homepage
    if (!explicit && isProtectedHost(host)) return null;

    for (const rule of compileCustom(customRules)) {
      if (hostMatches(host, rule.domain) && pathMatches(u.pathname, rule.path)) {
        if (rule.action === "never") {
          return { kind: "never", resolver: null, domain: rule.domain, host,
                   builtIn: classifyBuiltIn(u, host, true) };
        }
        return { kind: "supported", resolver: rule.action, domain: rule.domain, host,
                 custom: true };
      }
    }
    return classifyBuiltIn(u, host, explicit);
  }

  // What to use when the user explicitly asks to skip a link (paste field,
  // right-click, shortcut): explicit-only sites count, "never" rules don't.
  function classifyForExplicitSkip(rawUrl, customRules = []) {
    const match = classifyUrl(rawUrl, customRules, { explicit: true });
    return match && match.kind === "never" ? match.builtIn : match;
  }

  // Is this a common site that is never skipped automatically?
  function isProtectedUrl(rawUrl) {
    const u = parseHttpUrl(rawUrl.includes("://") ? rawUrl : "https://" + rawUrl);
    return Boolean(u) && isProtectedHost(normalizeHost(u.hostname).replace(/^www\./, ""));
  }

  // Turns what a user typed ("https://www.Example.com/abc?x" or "example.com")
  // into a rule domain ("example.com" or "example.com/abc"), or null.
  function normalizeRuleDomain(input) {
    let text = String(input || "").trim();
    if (!text) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
    const u = parseHttpUrl(text);
    if (!u || u.username || u.password || u.port) return null;
    const host = normalizeHost(u.hostname).replace(/^www\./, "");
    if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$/.test(host)) return null;
    if (RESOLVER_HOSTS.some(d => hostMatches(host, d))) return null;
    const path = u.pathname.replace(/\/+$/, "");
    return path ? host + path : host;
  }

  // Can Aizernal handle this link? (Used to offer "Try Aizernal instead".)
  function aizernalSupports(rawUrl) {
    const u = parseHttpUrl(rawUrl);
    if (!u) return false;
    const host = normalizeHost(u.hostname);
    return compile(AIZERNAL_FIRST_DOMAINS.concat(AIZERNAL_DOMAINS))
      .some(rule => hostMatches(host, rule.domain) && pathMatches(u.pathname, rule.path));
  }

  const api = {
    RESOLVERS,
    BYPASS_CITY_LINK_DOMAINS,
    BYPASS_CITY_PASTE_DOMAINS,
    BYPASS_CITY_EXPLICIT_ONLY_DOMAINS,
    PROTECTED_DOMAINS,
    AIZERNAL_FIRST_DOMAINS,
    AIZERNAL_DOMAINS,
    UNSUPPORTED_SHORTENER_DOMAINS,
    CUSTOM_ACTIONS,
    classifyUrl,
    classifyForExplicitSkip,
    isProtectedUrl,
    normalizeRuleDomain,
    aizernalSupports,
    isResolverUrl,
  };

  root.SpeedSkipRules = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
