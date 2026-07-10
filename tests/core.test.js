const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SETTINGS,
  calculateProgress,
  getVideoIdentity,
  normalizeSettings,
} = require("../src/core.js");

test("normalizeSettings supplies fresh-install defaults", () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
});

test("normalizeSettings accepts supported values and rejects invalid ones", () => {
  assert.deepEqual(
    normalizeSettings({
      progressBarEnabled: false,
      defaultPlaybackRate: "1.5",
      defaultQuality: 1080,
    }),
    {
      progressBarEnabled: false,
      defaultPlaybackRate: 1.5,
      defaultQuality: "1080",
    },
  );

  assert.deepEqual(
    normalizeSettings({
      progressBarEnabled: "yes",
      defaultPlaybackRate: 3,
      defaultQuality: "best",
    }),
    DEFAULT_SETTINGS,
  );
});

test("calculateProgress clamps played and buffered fractions", () => {
  assert.deepEqual(calculateProgress(25, 100, 70), {
    valid: true,
    played: 0.25,
    buffered: 0.7,
  });
  assert.deepEqual(calculateProgress(120, 100, 80), {
    valid: true,
    played: 1,
    buffered: 1,
  });
  assert.deepEqual(calculateProgress(50, 100, 20), {
    valid: true,
    played: 0.5,
    buffered: 0.5,
  });
});

test("calculateProgress rejects live and invalid durations", () => {
  assert.deepEqual(calculateProgress(10, Infinity, 20), {
    valid: false,
    played: 0,
    buffered: 0,
  });
  assert.deepEqual(calculateProgress(0, 0, 0), {
    valid: false,
    played: 0,
    buffered: 0,
  });
});

test("getVideoIdentity prefers the player video id", () => {
  assert.equal(
    getVideoIdentity(
      "https://www.youtube.com/watch?v=url-id",
      "player-id",
      "blob:media",
    ),
    "video:player-id",
  );
});

test("getVideoIdentity falls back through URL and media source", () => {
  assert.equal(
    getVideoIdentity("https://www.youtube.com/watch?v=url-id", "", "blob:media"),
    "video:url-id",
  );
  assert.equal(getVideoIdentity("not a url", "", "blob:media"), "media:blob:media");
  assert.equal(getVideoIdentity("not a url", "", ""), "");
});
