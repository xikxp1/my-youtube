const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTO_LIKE_THRESHOLD,
  DEFAULT_SETTINGS,
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  PLAYBACK_RATE_STEP,
  calculateProgress,
  findReactionControls,
  getVideoIdentity,
  isPastAutoLikeThreshold,
  isValidPlaybackRate,
  normalizeSettings,
} = require("../src/core.js");

test("normalizeSettings supplies fresh-install defaults", () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
});

test("normalizeSettings accepts supported values and rejects invalid ones", () => {
  assert.deepEqual(
    normalizeSettings({
      progressBarEnabled: false,
      autoLikeEnabled: false,
      defaultPlaybackRate: "1.5",
      defaultQuality: 1080,
    }),
    {
      progressBarEnabled: false,
      autoLikeEnabled: false,
      defaultPlaybackRate: 1.5,
      defaultQuality: "1080",
    },
  );

  assert.deepEqual(
    normalizeSettings({
      progressBarEnabled: "yes",
      defaultPlaybackRate: 4.5,
      defaultQuality: "best",
    }),
    DEFAULT_SETTINGS,
  );
});

test("playback rate validation accepts custom values across the supported range", () => {
  assert.equal(PLAYBACK_RATE_MIN, 0.05);
  assert.equal(PLAYBACK_RATE_MAX, 4);
  assert.equal(PLAYBACK_RATE_STEP, 0.05);

  for (const value of [0.05, "0.25", 1, 1.35, "2.2", 4]) {
    assert.equal(isValidPlaybackRate(value), true, String(value));
  }

  assert.equal(
    normalizeSettings({ defaultPlaybackRate: "1.35" }).defaultPlaybackRate,
    1.35,
  );
});

test("playback rate validation rejects out-of-range and off-step values", () => {
  for (const value of ["", "fast", NaN, Infinity, 0, 0.04, 1.33, 4.05]) {
    assert.equal(isValidPlaybackRate(value), false, String(value));
    assert.equal(
      normalizeSettings({ defaultPlaybackRate: value }).defaultPlaybackRate,
      DEFAULT_SETTINGS.defaultPlaybackRate,
    );
  }
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

test("auto-like threshold is strictly beyond half of a finite video", () => {
  assert.equal(AUTO_LIKE_THRESHOLD, 0.5);
  assert.equal(isPastAutoLikeThreshold(49.99, 100), false);
  assert.equal(isPastAutoLikeThreshold(50, 100), false);
  assert.equal(isPastAutoLikeThreshold(50.01, 100), true);
  assert.equal(isPastAutoLikeThreshold("51", "100"), true);

  for (const [currentTime, duration] of [
    [1, 0],
    [1, Infinity],
    [NaN, 100],
    [Infinity, 100],
  ]) {
    assert.equal(isPastAutoLikeThreshold(currentTime, duration), false);
  }
});

test("reaction controls recognize modern and legacy neutral buttons", () => {
  for (const layout of ["modern", "legacy"]) {
    const fixture = createReactionFixture({ layout });
    assert.deepEqual(findReactionControls(fixture.documentObject), {
      likeButton: fixture.likeButton,
      dislikeButton: fixture.dislikeButton,
      liked: false,
      disliked: false,
    });
  }
});

test("reaction controls report existing likes and dislikes", () => {
  const liked = createReactionFixture({ liked: true });
  assert.equal(findReactionControls(liked.documentObject).liked, true);
  assert.equal(findReactionControls(liked.documentObject).disliked, false);

  const disliked = createReactionFixture({ disliked: true });
  assert.equal(findReactionControls(disliked.documentObject).liked, false);
  assert.equal(findReactionControls(disliked.documentObject).disliked, true);
});

test("reaction controls fail closed for unavailable or ambiguous buttons", () => {
  for (const options of [
    { missing: "like" },
    { missing: "dislike" },
    { disabled: "like" },
    { disabled: "dislike" },
    { ambiguous: "like" },
    { ambiguous: "dislike" },
  ]) {
    const fixture = createReactionFixture(options);
    assert.equal(findReactionControls(fixture.documentObject), null);
  }
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

function createReactionFixture({
  layout = "modern",
  liked = false,
  disliked = false,
  disabled = "",
  ambiguous = "",
  missing = "",
} = {}) {
  const createButton = (kind, pressed) => ({
    disabled: disabled === kind,
    getAttribute(name) {
      if (name === "aria-disabled") {
        return this.disabled ? "true" : "false";
      }
      if (name === "aria-pressed") {
        return ambiguous === kind ? null : String(pressed);
      }
      return null;
    },
  });
  const likeButton = createButton("like", liked);
  const dislikeButton = createButton("dislike", disliked);
  const createHost = (button) => ({
    matches: () => false,
    querySelector: (selector) => (selector === "button" ? button : null),
  });
  const selectors =
    layout === "legacy"
      ? {
          "#segmented-like-button": createHost(likeButton),
          "#segmented-dislike-button": createHost(dislikeButton),
        }
      : {
          "like-button-view-model": createHost(likeButton),
          "dislike-button-view-model": createHost(dislikeButton),
        };
  if (missing === "like") {
    delete selectors[layout === "legacy" ? "#segmented-like-button" : "like-button-view-model"];
  }
  if (missing === "dislike") {
    delete selectors[
      layout === "legacy"
        ? "#segmented-dislike-button"
        : "dislike-button-view-model"
    ];
  }

  const container = {
    querySelector: (selector) => selectors[selector] || null,
  };
  return {
    likeButton,
    dislikeButton,
    documentObject: {
      querySelector: (selector) =>
        selector === "ytd-watch-metadata #actions #top-level-buttons-computed"
          ? container
          : null,
    },
  };
}
