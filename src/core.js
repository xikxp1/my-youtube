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
    defaultPlaybackRate: 1,
    defaultQuality: "auto",
  });

  const PLAYBACK_RATES = Object.freeze([
    0.25,
    0.5,
    0.75,
    1,
    1.25,
    1.5,
    1.75,
    2,
  ]);

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

  function normalizeSettings(value) {
    const settings = value && typeof value === "object" ? value : {};
    const playbackRate = Number(settings.defaultPlaybackRate);
    const quality = String(settings.defaultQuality ?? "auto");

    return {
      progressBarEnabled:
        typeof settings.progressBarEnabled === "boolean"
          ? settings.progressBarEnabled
          : DEFAULT_SETTINGS.progressBarEnabled,
      defaultPlaybackRate: PLAYBACK_RATES.includes(playbackRate)
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

  return {
    DEFAULT_SETTINGS,
    PLAYBACK_RATES,
    QUALITY_VALUES,
    calculateProgress,
    getVideoIdentity,
    normalizeSettings,
  };
});
