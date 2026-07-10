const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyQuality,
  applySpeed,
  chooseQualityLevel,
  isValidPlaybackRate,
  toQualityEntry,
} = require("../src/main-world.js");

test("applySpeed uses the YouTube player controller", () => {
  const calls = [];
  const result = applySpeed(1.5, {
    querySelector: () => ({
      setPlaybackRate: (rate) => calls.push(rate),
    }),
  });

  assert.deepEqual(result, {
    success: true,
    retryable: false,
    playbackRate: 1.5,
  });
  assert.deepEqual(calls, [1.5]);
});

test("applySpeed accepts custom rates and rejects invalid rates", () => {
  const calls = [];
  const video = { defaultPlaybackRate: 1, playbackRate: 1 };
  const documentObject = {
    querySelector: () => ({
      setPlaybackRate: (rate) => calls.push(rate),
      querySelector: () => video,
    }),
  };

  assert.equal(isValidPlaybackRate(1.35), true);
  assert.deepEqual(applySpeed("1.35", documentObject), {
    success: true,
    retryable: false,
    playbackRate: 1.35,
  });
  assert.deepEqual(applySpeed(1.33, documentObject), {
    success: false,
    retryable: false,
    reason: "invalid-speed",
  });
  assert.deepEqual(calls, [1.35]);
  assert.deepEqual(video, {
    defaultPlaybackRate: 1.35,
    playbackRate: 1.35,
  });
});

test("applySpeed fails safely when the player controller is unavailable", () => {
  assert.deepEqual(applySpeed(1.5, { querySelector: () => null }), {
    success: false,
    retryable: true,
    reason: "player-not-ready",
  });
  assert.deepEqual(applySpeed(1.5, { querySelector: () => ({}) }), {
    success: false,
    retryable: false,
    reason: "unsupported",
  });
});

test("quality entries normalize YouTube codes and labels", () => {
  assert.deepEqual(toQualityEntry("hd1080"), {
    code: "hd1080",
    resolution: 1080,
  });
  assert.deepEqual(toQualityEntry({ quality: "small", qualityLabel: "240p" }), {
    code: "small",
    resolution: 240,
  });
  assert.deepEqual(toQualityEntry("highres"), {
    code: "highres",
    resolution: 4320,
  });
});

test("quality selection uses an exact or closest lower resolution", () => {
  const available = ["hd2160", "hd1080", "hd720", "medium"];
  assert.equal(chooseQualityLevel("1080", available), "hd1080");
  assert.equal(chooseQualityLevel("1440", available), "hd1080");
  assert.equal(chooseQualityLevel("480", available), "medium");
});

test("quality selection uses the lowest level when no lower level exists", () => {
  assert.equal(chooseQualityLevel("144", ["hd1080", "hd720"]), "hd720");
});

test("quality selection can request a preferred level before levels load", () => {
  assert.equal(chooseQualityLevel("2160", []), "hd2160");
  assert.equal(chooseQualityLevel("auto", []), "auto");
});

test("applyQuality sets a fixed range when player internals are available", () => {
  const calls = [];
  const player = {
    getAvailableQualityLevels: () => ["hd1080", "hd720"],
    setPlaybackQualityRange: (...args) => calls.push(["range", ...args]),
    setPlaybackQuality: (...args) => calls.push(["quality", ...args]),
  };
  const result = applyQuality("1440", {
    querySelector: () => player,
  });

  assert.deepEqual(result, {
    success: true,
    retryable: false,
    qualityCode: "hd1080",
  });
  assert.deepEqual(calls, [
    ["range", "hd1080", "hd1080"],
    ["quality", "hd1080"],
  ]);
});

test("applyQuality fails safely when player internals are unavailable", () => {
  assert.deepEqual(applyQuality("1080", { querySelector: () => null }), {
    success: false,
    retryable: true,
    reason: "player-not-ready",
  });
  assert.deepEqual(applyQuality("1080", { querySelector: () => ({}) }), {
    success: false,
    retryable: false,
    reason: "unsupported",
  });
});
