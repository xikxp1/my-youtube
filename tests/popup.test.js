const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../src/core.js");
const root = path.join(__dirname, "..");

test("popup exposes the custom playback rate constraints", () => {
  const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
  const speedInput = popupHtml.match(
    /<input\s+[^>]*id="defaultPlaybackRate"[^>]*>/s,
  )?.[0];

  assert.ok(speedInput);
  assert.match(speedInput, /type="number"/);
  assert.match(speedInput, /min="0\.05"/);
  assert.match(speedInput, /max="4"/);
  assert.match(speedInput, /step="0\.05"/);
});

test("popup exposes an auto-like toggle", () => {
  const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
  assert.match(popupHtml, /id="autoLikeEnabled"\s+type="checkbox"/);
});

test("popup does not save invalid playback rates", async () => {
  const listeners = new Map();
  const storedWrites = [];
  const progressInput = createInput({ checked: true });
  const autoLikeInput = createInput({ checked: true });
  const speedInput = createInput({ value: "1" });
  const qualityInput = createInput({ value: "auto" });
  const status = { textContent: "" };
  const elements = {
    "#progressBarEnabled": progressInput,
    "#autoLikeEnabled": autoLikeInput,
    "#defaultPlaybackRate": speedInput,
    "#defaultQuality": qualityInput,
    "#status": status,
  };

  for (const input of [
    progressInput,
    autoLikeInput,
    speedInput,
    qualityInput,
  ]) {
    input.addEventListener = (eventName, listener) => {
      listeners.set(input, listener);
    };
  }

  const context = {
    MyYouTubeCore: core,
    document: {
      querySelector: (selector) => elements[selector],
    },
    chrome: {
      storage: {
        local: {
          get: async () => core.DEFAULT_SETTINGS,
          set: async (settings) => storedWrites.push(settings),
        },
      },
    },
    window: {
      clearTimeout: () => {},
      setTimeout: () => 1,
    },
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(root, "popup.js"), "utf8"),
    context,
  );
  await Promise.resolve();

  speedInput.value = "1.33";
  await listeners.get(speedInput)();
  assert.equal(storedWrites.length, 0);
  assert.equal(speedInput.value, "1");
  assert.equal(status.textContent, "Use 0.05× to 4× in 0.05 steps");

  speedInput.value = "1.35";
  autoLikeInput.checked = false;
  await listeners.get(speedInput)();
  assert.equal(storedWrites.length, 1);
  assert.equal(storedWrites[0].defaultPlaybackRate, 1.35);
  assert.equal(storedWrites[0].autoLikeEnabled, false);
});

function createInput({ checked = false, value = "" } = {}) {
  return {
    checked,
    value,
    checkValidity() {
      return core.isValidPlaybackRate(this.value);
    },
  };
}
