const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"),
);

test("manifest uses MV3 with scoped extension API permissions", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, [
    "storage",
    "scripting",
    "webNavigation",
  ]);
  assert.deepEqual(manifest.host_permissions, [
    "https://youtube.com/*",
    "https://www.youtube.com/*",
  ]);
});

test("content scripts load early on supported YouTube hosts for SPA navigation", () => {
  assert.ok(manifest.content_scripts.length >= 2);
  for (const script of manifest.content_scripts) {
    assert.deepEqual(script.matches, [
      "https://youtube.com/*",
      "https://www.youtube.com/*",
    ]);
  }
  const worlds = new Set(manifest.content_scripts.map((script) => script.world));
  assert.equal(worlds.has("MAIN"), true);
  assert.equal(worlds.has("ISOLATED"), true);
});

test("all manifest entry points and icons exist", () => {
  const files = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((script) => [
      ...(script.js || []),
      ...(script.css || []),
    ]),
  ];

  for (const file of files) {
    assert.equal(fs.existsSync(path.join(projectRoot, file)), true, file);
  }
});
