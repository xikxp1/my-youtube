(function initQualityBridge() {
  "use strict";

  if (globalThis.__myYouTubeMainBridgeLoaded) {
    return;
  }
  Object.defineProperty(globalThis, "__myYouTubeMainBridgeLoaded", {
    configurable: false,
    value: true,
  });

  const MESSAGE_SOURCE = "my-youtube:v1";
  const ALLOWED_PLAYBACK_RATES = new Set([
    0.25,
    0.5,
    0.75,
    1,
    1.25,
    1.5,
    1.75,
    2,
  ]);
  const QUALITY_CODES = Object.freeze({
    144: "tiny",
    240: "small",
    360: "medium",
    480: "large",
    720: "hd720",
    1080: "hd1080",
    1440: "hd1440",
    2160: "hd2160",
    4320: "highres",
  });
  const CODE_RESOLUTIONS = Object.freeze({
    tiny: 144,
    small: 240,
    medium: 360,
    large: 480,
    hd720: 720,
    hd1080: 1080,
    hd1440: 1440,
    hd2160: 2160,
    hd2880: 2880,
    hd4320: 4320,
    highres: 4320,
  });
  const ALLOWED_QUALITIES = new Set([
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

  function toQualityEntry(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return { code: QUALITY_CODES[value] || String(value), resolution: value };
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      const numeric = Number.parseInt(trimmed.replace(/[^0-9]/g, ""), 10);
      const resolution = CODE_RESOLUTIONS[trimmed] || numeric;
      return Number.isFinite(resolution) && resolution > 0
        ? { code: QUALITY_CODES[resolution] || trimmed, resolution }
        : null;
    }

    if (value && typeof value === "object") {
      const code =
        value.quality || value.qualityCode || value.id || value.format || "";
      const label = value.qualityLabel || value.label || value.resolution || "";
      return toQualityEntry(code) || toQualityEntry(label);
    }

    return null;
  }

  function chooseQualityLevel(target, availableValues) {
    const normalizedTarget = String(target);
    if (normalizedTarget === "auto") {
      return "auto";
    }

    const requestedResolution = Number(normalizedTarget);
    if (!Number.isFinite(requestedResolution)) {
      return null;
    }

    const available = (Array.isArray(availableValues) ? availableValues : [])
      .map(toQualityEntry)
      .filter(Boolean)
      .sort((left, right) => right.resolution - left.resolution);

    if (available.length === 0) {
      return QUALITY_CODES[requestedResolution] || null;
    }

    const lowerOrEqual = available.find(
      (entry) => entry.resolution <= requestedResolution,
    );
    return (lowerOrEqual || available[available.length - 1]).code;
  }

  function getAvailableQualities(player) {
    try {
      if (typeof player.getAvailableQualityData === "function") {
        const data = player.getAvailableQualityData();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }

      if (typeof player.getAvailableQualityLevels === "function") {
        const levels = player.getAvailableQualityLevels();
        if (Array.isArray(levels)) {
          return levels;
        }
      }
    } catch {
      // Player internals are best-effort and can change without notice.
    }

    return [];
  }

  function applyQuality(target, documentObject) {
    const player = documentObject.querySelector(
      "#movie_player, .html5-video-player",
    );

    if (!player) {
      return { success: false, retryable: true, reason: "player-not-ready" };
    }

    const hasRangeSetter = typeof player.setPlaybackQualityRange === "function";
    const hasQualitySetter = typeof player.setPlaybackQuality === "function";
    if (!hasRangeSetter && !hasQualitySetter) {
      return { success: false, retryable: false, reason: "unsupported" };
    }

    const qualityCode = chooseQualityLevel(target, getAvailableQualities(player));
    if (!qualityCode) {
      return { success: false, retryable: false, reason: "invalid-quality" };
    }

    try {
      if (hasRangeSetter) {
        player.setPlaybackQualityRange(qualityCode, qualityCode);
      }
      if (hasQualitySetter) {
        player.setPlaybackQuality(qualityCode);
      }
      return { success: true, retryable: false, qualityCode };
    } catch {
      return { success: false, retryable: true, reason: "player-not-ready" };
    }
  }

  function applySpeed(targetRate, documentObject) {
    const player = documentObject.querySelector(
      "#movie_player, .html5-video-player",
    );

    if (!player) {
      return { success: false, retryable: true, reason: "player-not-ready" };
    }
    if (typeof player.setPlaybackRate !== "function") {
      return { success: false, retryable: false, reason: "unsupported" };
    }

    try {
      player.setPlaybackRate(targetRate);
      return { success: true, retryable: false, playbackRate: targetRate };
    } catch {
      return { success: false, retryable: true, reason: "player-not-ready" };
    }
  }

  function verifyQuality(target, expectedQualityCode) {
    if (target === "auto") {
      return;
    }

    window.setTimeout(() => {
      const player = document.querySelector("#movie_player, .html5-video-player");
      if (!player) {
        return;
      }

      let currentQuality = "";
      try {
        currentQuality =
          typeof player.getPlaybackQuality === "function"
            ? player.getPlaybackQuality()
            : "";
      } catch {
        // Fall through and retry once when the current value cannot be read.
      }

      if (!currentQuality || currentQuality !== expectedQualityCode) {
        applyQuality(target, document);
      }
    }, 750);
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.addEventListener("message", (event) => {
      if (event.source !== window) {
        return;
      }

      const message = event.data;
      if (
        !message ||
        message.source !== MESSAGE_SOURCE ||
        typeof message.requestId !== "string"
      ) {
        return;
      }

      if (message.type === "APPLY_SPEED") {
        const playbackRate = Number(message.playbackRate);
        if (!ALLOWED_PLAYBACK_RATES.has(playbackRate)) {
          return;
        }

        const result = applySpeed(playbackRate, document);
        window.postMessage(
          {
            source: MESSAGE_SOURCE,
            type: "SPEED_RESULT",
            requestId: message.requestId,
            ...result,
          },
          location.origin,
        );
        return;
      }

      if (
        message.type !== "APPLY_QUALITY" ||
        !ALLOWED_QUALITIES.has(String(message.quality))
      ) {
        return;
      }

      const result = applyQuality(String(message.quality), document);
      if (result.success) {
        verifyQuality(String(message.quality), result.qualityCode);
      }
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: "QUALITY_RESULT",
          requestId: message.requestId,
          ...result,
        },
        location.origin,
      );
    });
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      applyQuality,
      applySpeed,
      chooseQualityLevel,
      toQualityEntry,
    };
  }
})();
