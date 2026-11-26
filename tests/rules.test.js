// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../domains.js");

const c = url => rules.classifyUrl(url);

test("Aizernal domains (and subdomains) go to Aizernal", () => {
  for (const url of [
    "https://srnky.com/tHpaxj1k",
    "https://www.srnky.com/abc?x=1#frag",
    "http://ouo.io/AbC",
    "https://ouo.press/x",
    "https://shrinkme.io/x", "https://shrinkme.site/x",
    "https://shrinkearn.com/x", "https://advertisingcamps.com/x", "https://loanbixby.com/x",
    "https://SRNKY.COM./x",
  ]) {
    assert.equal(c(url)?.resolver, "aizernal", url);
  }
});

test("srnky.com always goes to Aizernal, even if bypass.city lists it", () => {
  // Load a copy of domains.js where bypass.city also lists srnky.com.
  const fs = require("node:fs");
  const vm = require("node:vm");
  const src = fs.readFileSync(require.resolve("../domains.js"), "utf8")
    .replace('"vplink.in",', '"vplink.in", "srnky.com",');
  const ctx = { URL };
  vm.runInNewContext(src, ctx);
  const overlapped = ctx.SpeedSkipRules;
  assert.ok(overlapped.BYPASS_CITY_LINK_DOMAINS.includes("srnky.com"));
  for (const url of ["https://srnky.com/tHpaxj1k", "https://www.srnky.com/a?b#c"]) {
    assert.equal(overlapped.classifyUrl(url)?.resolver, "aizernal", url);
    assert.equal(c(url)?.resolver, "aizernal", url);
  }
});

test("bypass.city wins for domains both services support", () => {
  for (const url of ["https://shrinkme.click/x", "https://cuty.io/x", "https://cuttty.com/x"]) {
    assert.equal(c(url)?.resolver, "bypassCity", url);
  }
});

test("bypass.city shorteners are skipped automatically", () => {
  for (const url of [
    "https://linkvertise.com/123/abc", "https://link-target.net/1/x",
    "https://loot-link.com/s?abc", "https://links.lootlabs.gg/x",
    "https://bit.ly/3abc", "https://tinyurl.com/x", "https://boost.fusedgt.com/x",
  ]) {
    assert.equal(c(url)?.resolver, "bypassCity", url);
  }
});

test("paste sites and Google redirects are explicit-only (never automatic)", () => {
  for (const url of [
    "https://pastebin.com/abc123", "https://rentry.co/x", "https://telegra.ph/Post-01-01",
    "https://gist.github.com/user/abc", "https://www.google.com/url?q=https://example.com",
    "https://controlc.com/abc",
  ]) {
    assert.equal(c(url), null, `auto: ${url}`);
    assert.equal(rules.classifyForExplicitSkip(url, [])?.resolver, "bypassCity", `explicit: ${url}`);
  }
});

test("common sites are never auto-skipped, even with a 'My sites' rule", () => {
  const custom = [
    { domain: "google.com", action: "bypassCity" },
    { domain: "youtube.com", action: "aizernal" },
  ];
  for (const url of [
    "https://www.google.com/search?q=speedskip", "https://www.google.com/url?q=https://x.com",
    "https://www.google.co.uk/search?q=a", "https://google.de/maps?x=1",
    "https://mail.google.com/mail/u/0/", "https://docs.google.com/document/d/1",
    "https://www.youtube.com/watch?v=abc", "https://youtu.be/abc",
    "https://github.com/user/repo", "https://en.wikipedia.org/wiki/URL",
    "https://www.reddit.com/r/x", "https://x.com/user/status/1", "https://t.me/channel",
    "https://discord.gg/abc", "https://mega.nz/file/abc", "https://www.mediafire.com/file/x",
  ]) {
    assert.equal(c(url), null, url);
    assert.equal(rules.classifyUrl(url, custom), null, `with custom rule: ${url}`);
  }
  assert.ok(rules.isProtectedUrl("www.google.com"));
  assert.ok(rules.isProtectedUrl("https://google.com.au/x"));
  assert.ok(!rules.isProtectedUrl("ouo.io"));
  assert.ok(!rules.isProtectedUrl("googleusercontent-lookalike.io"));
});

test("no built-in automatic list contains a protected common site", () => {
  const auto = [
    ...rules.BYPASS_CITY_LINK_DOMAINS, ...rules.AIZERNAL_FIRST_DOMAINS,
    ...rules.AIZERNAL_DOMAINS, ...rules.UNSUPPORTED_SHORTENER_DOMAINS,
  ];
  for (const entry of auto) {
    assert.ok(!rules.isProtectedUrl(entry.split("/")[0]), entry);
    // Every automatic entry is a real host that a short link can live on.
    assert.match(entry, /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/, entry);
  }
});

test("unrelated and partial-match hosts are ignored", () => {
  for (const url of [
    "https://example.com/x",
    "https://notsrnky.com/x",          // suffix without a dot
    "https://srnky.com.evil.net/x",
    "https://github.com/user/repo",    // only gist.github.com is listed
    "https://www.google.com/search?q=x",
    "https://www.google.com/urlshortener",
    "chrome://extensions", "file:///tmp/a", "not a url",
  ]) {
    assert.equal(c(url), null, url);
  }
});

test("shortener homepages are not intercepted", () => {
  assert.equal(c("https://ouo.io/"), null);
  assert.equal(c("https://linkvertise.com"), null);
  assert.notEqual(c("https://ouo.io/?s=abc"), null);
});

test("resolver sites are never intercepted", () => {
  assert.equal(c("https://aizernal.xyz/?url=x"), null);
  assert.equal(c("https://bypass.city/bypass?bypass=https://bit.ly/x"), null);
  assert.ok(rules.isResolverUrl("https://aizernal.xyz/"));
  assert.ok(rules.isResolverUrl("https://bypass.city/bypass?bypass=x"));
  assert.ok(!rules.isResolverUrl("https://example.com/"));
});

test("unsupported shorteners are flagged", () => {
  const m = c("https://adf.ly/abc");
  assert.equal(m.kind, "unsupported");
  assert.equal(m.resolver, null);
});

test("bypass.city URL encodes the exact original URL", () => {
  const original = "https://linkvertise.com/1/a?b=c&d=e#f";
  const built = rules.RESOLVERS.bypassCity.buildUrl(original);
  assert.equal(new URL(built).searchParams.get("bypass"), original);
});

test("custom rules come first; 'never' keeps the built-in match for explicit skips", () => {
  const rules = require("../domains.js");
  const custom = [
    { domain: "pastebin.com", action: "never" },
    { domain: "example.com/go", action: "aizernal" },
  ];
  const never = rules.classifyUrl("https://pastebin.com/abc", custom);
  assert.equal(never.kind, "never");
  assert.equal(rules.classifyForExplicitSkip("https://pastebin.com/abc", custom).resolver, "bypassCity");
  assert.equal(rules.classifyUrl("https://example.com/go/123", custom).resolver, "aizernal");
  assert.equal(rules.classifyUrl("https://example.com/other", custom), null);
  // Malformed rules are ignored.
  assert.equal(rules.classifyUrl("https://ouo.io/x", [{ domain: 5 }, { domain: "ouo.io", action: "evil" }]).resolver, "aizernal");
});

test("normalizeRuleDomain cleans what the user typed", () => {
  const { normalizeRuleDomain: n } = require("../domains.js");
  assert.equal(n("https://www.Example.com/abc/?x=1#y"), "example.com/abc");
  assert.equal(n("example.com"), "example.com");
  assert.equal(n("  sub.example.co.uk/  "), "sub.example.co.uk");
  for (const bad of ["", "localhost", "not a domain", "aizernal.xyz", "bypass.city", "http://a.com:8080", "javascript:alert(1)"]) {
    assert.equal(n(bad), null, bad);
  }
});

test("aizernalSupports matches Aizernal's domains only", () => {
  const { aizernalSupports } = require("../domains.js");
  assert.ok(aizernalSupports("https://ouo.io/x"));
  assert.ok(aizernalSupports("https://www.srnky.com/x"));
  assert.ok(aizernalSupports("https://cuty.io/x"));
  assert.ok(!aizernalSupports("https://linkvertise.com/x"));
});
