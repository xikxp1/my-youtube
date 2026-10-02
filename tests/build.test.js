const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { GECKO_ID, toFirefoxManifest } = require("../scripts/build.js");

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "manifest.json"), "utf8"),
);

test("firefox manifest uses background scripts instead of a service worker", () => {
  const firefox = toFirefoxManifest(manifest);
  assert.equal(firefox.background.service_worker, undefined);
  assert.deepEqual(firefox.background.scripts, [manifest.background.service_worker]);
  assert.equal(firefox.minimum_chrome_version, undefined);
});

test("firefox manifest declares gecko settings", () => {
  const { gecko } = toFirefoxManifest(manifest).browser_specific_settings;
  assert.equal(gecko.id, GECKO_ID);
  assert.equal(gecko.strict_min_version, "128.0");
  assert.deepEqual(gecko.data_collection_permissions, { required: ["none"] });
});

test("firefox transform does not mutate the source manifest", () => {
  const before = structuredClone(manifest);
  toFirefoxManifest(manifest);
  assert.deepEqual(manifest, before);
});
