// Checks the generated Firefox/Zen manifest and package layout.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

test("npm run package builds Chrome and Firefox packages with matching versions", () => {
  // Build into a temporary copy so the real dist/ is untouched.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "speedskip-pkg-"));
  for (const f of ["manifest.json", "background.js", "domains.js", "resolver.js", "popup.html", "popup.js", "README.md"]) {
    fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  }
  fs.cpSync(path.join(ROOT, "icons"), path.join(tmp, "icons"), { recursive: true });
  fs.cpSync(path.join(ROOT, "scripts"), path.join(tmp, "scripts"), { recursive: true });
  execFileSync("node", [path.join(tmp, "scripts/package.js")], { stdio: "ignore" });

  const read = p => JSON.parse(fs.readFileSync(path.join(tmp, "dist", p), "utf8"));
  const chrome = read("speedskip/manifest.json");
  const ff = read("speedskip-firefox/manifest.json");

  assert.equal(chrome.background.service_worker, "background.js");
  assert.deepEqual(ff.background, { scripts: ["domains.js", "background.js"] });
  assert.equal(ff.minimum_chrome_version, undefined);
  assert.match(ff.browser_specific_settings.gecko.id, /@/);
  assert.equal(ff.version, chrome.version);
  assert.deepEqual(ff.permissions, chrome.permissions);
  assert.deepEqual(ff.commands, chrome.commands);
  assert.deepEqual(ff.content_scripts, chrome.content_scripts);

  for (const dir of ["speedskip", "speedskip-firefox"]) {
    for (const f of ["background.js", "domains.js", "resolver.js", "popup.html", "popup.js", "icons/icon128.png"]) {
      assert.ok(fs.existsSync(path.join(tmp, "dist", dir, f)), `${dir}/${f}`);
    }
  }
  // Firefox ZIP must have manifest.json at the root.
  const list = execFileSync("unzip", ["-Z1", path.join(tmp, "dist/speedskip-firefox.zip")]).toString();
  assert.match(list, /^manifest\.json$/m);
  fs.rmSync(tmp, { recursive: true, force: true });
});
