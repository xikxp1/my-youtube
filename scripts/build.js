#!/usr/bin/env node
"use strict";

// Builds browser-specific extension packages into dist/.
// Usage: node scripts/build.js [chrome|firefox ...]  (defaults to all targets)

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");

const FILES = ["popup.html", "popup.css", "popup.js"];
const DIRS = ["src", "icons"];

const GECKO_ID = "my-youtube@xikxp1";
const GECKO_MIN_VERSION = "128.0";

function toChromeManifest(manifest) {
  return structuredClone(manifest);
}

function toFirefoxManifest(manifest) {
  const result = structuredClone(manifest);
  delete result.minimum_chrome_version;

  const { service_worker: serviceWorker, ...background } = result.background;
  result.background = { ...background, scripts: [serviceWorker] };

  result.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION,
      data_collection_permissions: { required: ["none"] },
    },
  };
  return result;
}

const TARGETS = {
  chrome: toChromeManifest,
  firefox: toFirefoxManifest,
};

function build(target) {
  const transform = TARGETS[target];
  if (!transform) {
    throw new Error(`Unknown target "${target}". Use: ${Object.keys(TARGETS).join(", ")}`);
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"),
  );
  const outDir = path.join(distRoot, target);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const file of FILES) {
    fs.copyFileSync(path.join(projectRoot, file), path.join(outDir, file));
  }
  for (const dir of DIRS) {
    fs.cpSync(path.join(projectRoot, dir), path.join(outDir, dir), {
      recursive: true,
      filter: (src) => path.basename(src) !== ".DS_Store",
    });
  }
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(transform(manifest), null, 2)}\n`,
  );

  const zipPath = path.join(distRoot, `my-youtube-${target}-${manifest.version}.zip`);
  fs.rmSync(zipPath, { force: true });
  execFileSync("zip", ["-qr", "-X", zipPath, "."], { cwd: outDir });
  console.log(`Built ${path.relative(projectRoot, zipPath)}`);
}

if (require.main === module) {
  const targets = process.argv.slice(2);
  for (const target of targets.length ? targets : Object.keys(TARGETS)) {
    build(target);
  }
}

module.exports = { GECKO_ID, toChromeManifest, toFirefoxManifest };
