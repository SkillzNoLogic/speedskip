// Builds the installable packages from the shared source:
//   dist/speedskip/          + dist/speedskip.zip           Chrome, Opera, Edge, Brave
//   dist/speedskip-firefox/  + dist/speedskip-firefox.zip   Firefox, Zen
// The Firefox manifest is generated from manifest.json so the two never drift.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const FILES = [
  "background.js", "domains.js", "resolver.js", "popup.html", "popup.js", "README.md",
];
const DIRS = ["icons"];

// Firefox add-on id. Keep it stable: Firefox keys stored settings and
// signing on it.
const GECKO_ID = "speedskip@speedskip.extension";

function firefoxManifest(chrome) {
  const m = JSON.parse(JSON.stringify(chrome));
  delete m.minimum_chrome_version;
  // Firefox runs MV3 background code as an event page, not a service worker.
  m.background = { scripts: ["domains.js", "background.js"] };
  m.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: "128.0",
      // Required for new add-ons on addons.mozilla.org; SpeedSkip sends no data.
      data_collection_permissions: { required: ["none"] },
    },
  };
  return m;
}

function build(name, manifest) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(out + ".zip", { force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(out, f));
  for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(out, d), { recursive: true });
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return out;
}

const chromeManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
fs.mkdirSync(DIST, { recursive: true });

// Chrome/Opera ZIP contains the folder, so friends unzip and pick "speedskip".
build("speedskip", chromeManifest);
execFileSync("zip", ["-qr", "speedskip.zip", "speedskip"], { cwd: DIST });

// Firefox ZIP has manifest.json at its root, as Firefox and addons.mozilla.org expect.
// The .xpi is the same file with the extension Firefox/Zen's "Install Add-on
// From File…" looks for.
const ff = build("speedskip-firefox", firefoxManifest(chromeManifest));
fs.rmSync(path.join(DIST, "speedskip-firefox.xpi"), { force: true });
execFileSync("zip", ["-qr", path.join(DIST, "speedskip-firefox.zip"), "."], { cwd: ff });
fs.copyFileSync(path.join(DIST, "speedskip-firefox.zip"), path.join(DIST, "speedskip-firefox.xpi"));

if (require.main === module) {
  console.log(`Built SpeedSkip ${chromeManifest.version}:`);
  for (const f of ["speedskip/", "speedskip.zip", "speedskip-firefox/",
                   "speedskip-firefox.zip", "speedskip-firefox.xpi"]) {
    console.log("  dist/" + f);
  }
}
