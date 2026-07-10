(function initCore(root, factory) {
  const isCommonJs = typeof module === "object" && module.exports;
  if (root && !isCommonJs && root.MyYouTubeCore) {
    return;
  }

  const core = factory();

  if (isCommonJs) {
    module.exports = core;
  }

  if (root && !isCommonJs) {
    Object.defineProperty(root, "MyYouTubeCore", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze(core),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function createCore() {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    progressBarEnabled: true,
    autoLikeEnabled: true,
    defaultPlaybackRate: 1,
    defaultQuality: "auto",
  });

  const AUTO_LIKE_THRESHOLD = 0.5;
  const REACTION_CONTAINER_SELECTORS = Object.freeze([
    "ytd-watch-metadata #actions #top-level-buttons-computed",
    "ytd-watch-metadata #actions",
    "#above-the-fold #top-level-buttons-computed",
  ]);
  const LIKE_BUTTON_SELECTORS = Object.freeze([
    "like-button-view-model",
    "#segmented-like-button",
  ]);
  const DISLIKE_BUTTON_SELECTORS = Object.freeze([
    "dislike-button-view-model",
    "#segmented-dislike-button",
  ]);

  const PLAYBACK_RATE_MIN = 0.05;
  const PLAYBACK_RATE_MAX = 4;
  const PLAYBACK_RATE_STEP = 0.05;
  const PLAYBACK_RATE_SCALE = 100;

  const QUALITY_VALUES = Object.freeze([
    "auto",
    "144",
    "240",
    "360",
    "480",
    "720",
    "1080",
    "1440",
    "2160",
    "4320",
  ]);

  function isValidPlaybackRate(value) {
    const playbackRate = Number(value);
    if (!Number.isFinite(playbackRate)) {
      return false;
    }

    const scaledRate = playbackRate * PLAYBACK_RATE_SCALE;
    const rateInHundredths = Math.round(scaledRate);
    const minInHundredths = PLAYBACK_RATE_MIN * PLAYBACK_RATE_SCALE;
    const maxInHundredths = PLAYBACK_RATE_MAX * PLAYBACK_RATE_SCALE;
    const stepInHundredths = PLAYBACK_RATE_STEP * PLAYBACK_RATE_SCALE;

    return (
      Math.abs(scaledRate - rateInHundredths) < 1e-8 &&
      rateInHundredths >= minInHundredths &&
      rateInHundredths <= maxInHundredths &&
      rateInHundredths % stepInHundredths === 0
    );
  }

  function normalizeSettings(value) {
    const settings = value && typeof value === "object" ? value : {};
    const playbackRate = Number(settings.defaultPlaybackRate);
    const quality = String(settings.defaultQuality ?? "auto");

    return {
      progressBarEnabled:
        typeof settings.progressBarEnabled === "boolean"
          ? settings.progressBarEnabled
          : DEFAULT_SETTINGS.progressBarEnabled,
      autoLikeEnabled:
        typeof settings.autoLikeEnabled === "boolean"
          ? settings.autoLikeEnabled
          : DEFAULT_SETTINGS.autoLikeEnabled,
      defaultPlaybackRate: isValidPlaybackRate(playbackRate)
        ? playbackRate
        : DEFAULT_SETTINGS.defaultPlaybackRate,
      defaultQuality: QUALITY_VALUES.includes(quality)
        ? quality
        : DEFAULT_SETTINGS.defaultQuality,
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function calculateProgress(currentTime, duration, bufferedEnd) {
    const safeDuration = Number(duration);

    if (!Number.isFinite(safeDuration) || safeDuration <= 0) {
      return { valid: false, played: 0, buffered: 0 };
    }

    const played = clamp(Number(currentTime) / safeDuration || 0, 0, 1);
    const buffered = clamp(Number(bufferedEnd) / safeDuration || 0, played, 1);

    return { valid: true, played, buffered };
  }

  function getVideoIdentity(url, explicitVideoId, mediaSource) {
    if (typeof explicitVideoId === "string" && explicitVideoId.trim()) {
      return `video:${explicitVideoId.trim()}`;
    }

    try {
      const parsed = new URL(url);
      const videoId = parsed.searchParams.get("v");
      if (videoId) {
        return `video:${videoId}`;
      }
    } catch {
      // Fall through to the media source when the URL is incomplete.
    }

    if (typeof mediaSource === "string" && mediaSource.trim()) {
      return `media:${mediaSource.trim()}`;
    }

    return "";
  }

  function isPastAutoLikeThreshold(currentTime, duration) {
    const safeCurrentTime = Number(currentTime);
    const safeDuration = Number(duration);
    return (
      Number.isFinite(safeCurrentTime) &&
      Number.isFinite(safeDuration) &&
      safeDuration > 0 &&
      safeCurrentTime / safeDuration > AUTO_LIKE_THRESHOLD
    );
  }

  function findButton(container, selectors) {
    for (const selector of selectors) {
      const host = container.querySelector(selector);
      if (!host) {
        continue;
      }

      if (typeof host.matches === "function" && host.matches("button")) {
        return host;
      }

      const button = host.querySelector("button");
      if (button) {
        return button;
      }
    }

    return null;
  }

  function readPressedState(button) {
    if (
      !button ||
      button.disabled === true ||
      button.getAttribute("aria-disabled") === "true"
    ) {
      return null;
    }

    const pressed = button.getAttribute("aria-pressed");
    if (pressed === "true") {
      return true;
    }
    if (pressed === "false") {
      return false;
    }
    return null;
  }

  function findReactionControls(documentObject) {
    if (!documentObject || typeof documentObject.querySelector !== "function") {
      return null;
    }

    for (const selector of REACTION_CONTAINER_SELECTORS) {
      const container = documentObject.querySelector(selector);
      if (!container) {
        continue;
      }

      const likeButton = findButton(container, LIKE_BUTTON_SELECTORS);
      const dislikeButton = findButton(container, DISLIKE_BUTTON_SELECTORS);
      const liked = readPressedState(likeButton);
      const disliked = readPressedState(dislikeButton);
      if (liked === null || disliked === null) {
        continue;
      }

      return { likeButton, dislikeButton, liked, disliked };
    }

    return null;
  }

  return {
    AUTO_LIKE_THRESHOLD,
    DEFAULT_SETTINGS,
    PLAYBACK_RATE_MAX,
    PLAYBACK_RATE_MIN,
    PLAYBACK_RATE_STEP,
    QUALITY_VALUES,
    calculateProgress,
    findReactionControls,
    getVideoIdentity,
    isValidPlaybackRate,
    isPastAutoLikeThreshold,
    normalizeSettings,
  };
});
