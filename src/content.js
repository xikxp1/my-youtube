(function initMyYouTube() {
  "use strict";

  if (globalThis.__myYouTubeContentLoaded) {
    return;
  }
  Object.defineProperty(globalThis, "__myYouTubeContentLoaded", {
    configurable: false,
    value: true,
  });

  const {
    DEFAULT_SETTINGS,
    calculateProgress,
    getVideoIdentity,
    normalizeSettings,
  } = globalThis.MyYouTubeCore;
  const MESSAGE_SOURCE = "my-youtube:v1";
  const MAX_QUALITY_ATTEMPTS = 8;

  const state = {
    settings: DEFAULT_SETTINGS,
    settingsLoaded: false,
    player: null,
    video: null,
    videoEvents: null,
    bar: null,
    animationFrame: 0,
    scanScheduled: false,
    identity: "",
    speedApplied: false,
    speedRequestId: "",
    qualityApplied: false,
    qualityAttempt: 0,
    qualityRequestId: "",
    qualityRetryTimer: 0,
    speedFinalizationTimer: 0,
  };

  function createProgressBar(player) {
    const staleBar = document.querySelector("#my-youtube-progress");
    if (staleBar) {
      staleBar.remove();
    }

    const root = document.createElement("div");
    const buffered = document.createElement("div");
    const played = document.createElement("div");

    root.id = "my-youtube-progress";
    root.setAttribute("aria-hidden", "true");
    buffered.id = "my-youtube-progress-buffered";
    played.id = "my-youtube-progress-played";
    root.append(buffered, played);
    player.append(root);

    return { root, buffered, played };
  }

  function removeProgressBar() {
    state.bar?.root.remove();
    state.bar = null;
  }

  function getBufferedEnd(video) {
    try {
      let bufferedEnd = 0;
      for (let index = 0; index < video.buffered.length; index += 1) {
        bufferedEnd = Math.max(bufferedEnd, video.buffered.end(index));
      }
      return bufferedEnd;
    } catch {
      return 0;
    }
  }

  function isAdPlaying() {
    return Boolean(
      state.player?.classList.contains("ad-showing") ||
        state.player?.classList.contains("ad-interrupting"),
    );
  }

  function isLiveVideo(video) {
    return Boolean(
      !Number.isFinite(video.duration) ||
        state.player?.classList.contains("ytp-live") ||
        state.player?.classList.contains("ytp-live-stream"),
    );
  }

  function updateProgress() {
    if (!state.video || !state.bar) {
      return;
    }

    const progress = calculateProgress(
      state.video.currentTime,
      state.video.duration,
      getBufferedEnd(state.video),
    );
    const shouldHide =
      !state.settingsLoaded ||
      !state.settings.progressBarEnabled ||
      !progress.valid ||
      isAdPlaying() ||
      isLiveVideo(state.video);

    state.bar.root.hidden = shouldHide;
    if (shouldHide) {
      return;
    }

    state.bar.played.style.transform = `scaleX(${progress.played})`;
    state.bar.buffered.style.transform = `scaleX(${progress.buffered})`;
  }

  function updateRuntimeMetadata() {
    if (!state.bar) {
      return;
    }

    state.bar.root.dataset.playbackRateTarget = String(
      state.settings.defaultPlaybackRate,
    );
    state.bar.root.dataset.qualityTarget = state.settings.defaultQuality;
    state.bar.root.dataset.settingsLoaded = String(state.settingsLoaded);
  }

  function stopAnimation() {
    if (state.animationFrame) {
      cancelAnimationFrame(state.animationFrame);
      state.animationFrame = 0;
    }
  }

  function startAnimation() {
    if (state.animationFrame) {
      return;
    }

    const animate = () => {
      state.animationFrame = 0;
      updateProgress();
      if (state.video && !state.video.paused && !state.video.ended) {
        state.animationFrame = requestAnimationFrame(animate);
      }
    };

    state.animationFrame = requestAnimationFrame(animate);
  }

  function clearQualityRequest() {
    window.clearTimeout(state.qualityRetryTimer);
    state.qualityRetryTimer = 0;
    state.qualityRequestId = "";
  }

  function resetDefaultsForVideo(identity) {
    clearQualityRequest();
    window.clearTimeout(state.speedFinalizationTimer);
    state.speedFinalizationTimer = 0;
    state.identity = identity;
    state.speedApplied = false;
    state.speedRequestId = "";
    state.qualityApplied = false;
    state.qualityAttempt = 0;
  }

  function readIdentity() {
    const explicitVideoId =
      document
        .querySelector("ytd-watch-flexy[video-id]")
        ?.getAttribute("video-id") || state.player?.dataset.videoId;

    return getVideoIdentity(
      location.href,
      explicitVideoId,
      state.video?.currentSrc,
    );
  }

  function syncIdentity() {
    const identity = readIdentity();
    if (identity && identity !== state.identity) {
      resetDefaultsForVideo(identity);
    }
    return identity;
  }

  function notifyPlayerSpeed(targetRate) {
    const requestId = `${state.identity}:speed:${Date.now()}`;
    state.speedRequestId = requestId;
    state.bar?.root.setAttribute("data-speed-status", "pending");
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: "APPLY_SPEED",
        requestId,
        playbackRate: targetRate,
      },
      location.origin,
    );
  }

  function applySpeed({ finalize = false, force = false } = {}) {
    if (
      !state.settingsLoaded ||
      !state.video ||
      isAdPlaying() ||
      state.video.readyState < HTMLMediaElement.HAVE_METADATA ||
      (state.speedApplied && !force)
    ) {
      return;
    }

    const video = state.video;
    const identity = state.identity;
    const targetRate = state.settings.defaultPlaybackRate;
    try {
      video.defaultPlaybackRate = targetRate;
      video.playbackRate = targetRate;
      state.speedApplied = finalize;

      if (finalize) {
        notifyPlayerSpeed(targetRate);
        window.clearTimeout(state.speedFinalizationTimer);
        state.speedFinalizationTimer = window.setTimeout(() => {
          state.speedFinalizationTimer = 0;
          if (
            state.video !== video ||
            state.identity !== identity ||
            isAdPlaying() ||
            video.paused ||
            video.playbackRate === targetRate
          ) {
            return;
          }

          // YouTube commonly resets a just-started video to 1×. Correct that
          // initialization reset once, then leave later manual changes alone.
          if (video.playbackRate === 1) {
            video.defaultPlaybackRate = targetRate;
            video.playbackRate = targetRate;
            notifyPlayerSpeed(targetRate);
          }
        }, 750);
      }
    } catch {
      // A protected or transitioning media element can reject a rate temporarily.
      state.speedApplied = false;
    }
  }

  function requestQuality({ force = false } = {}) {
    if (
      !state.settingsLoaded ||
      !state.video ||
      isAdPlaying() ||
      state.video.readyState < HTMLMediaElement.HAVE_METADATA ||
      (state.video.paused && !force) ||
      state.qualityApplied ||
      state.qualityRequestId
    ) {
      return;
    }

    state.qualityAttempt += 1;
    state.qualityRequestId = `${state.identity}:${Date.now()}:${state.qualityAttempt}`;
    state.bar?.root.setAttribute("data-quality-status", "pending");
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: "APPLY_QUALITY",
        requestId: state.qualityRequestId,
        quality: state.settings.defaultQuality,
      },
      location.origin,
    );
  }

  function applyDefaults({ finalize = false, force = false } = {}) {
    if (!syncIdentity()) {
      return;
    }
    applySpeed({ finalize, force });
    if (finalize || force) {
      requestQuality({ force });
    }
  }

  function detachVideo() {
    state.videoEvents?.abort();
    state.videoEvents = null;
    state.video = null;
    stopAnimation();
  }

  function attachVideo(video) {
    detachVideo();
    state.video = video;
    state.videoEvents = new AbortController();
    const options = { signal: state.videoEvents.signal };

    for (const eventName of [
      "loadedmetadata",
      "durationchange",
      "progress",
      "timeupdate",
      "seeking",
      "seeked",
    ]) {
      video.addEventListener(
        eventName,
        () => {
          syncIdentity();
          updateProgress();
          applyDefaults();
        },
        options,
      );
    }

    video.addEventListener(
      "playing",
      () => {
        applyDefaults({ finalize: true });
        startAnimation();
      },
      options,
    );
    video.addEventListener("pause", stopAnimation, options);
    video.addEventListener("ended", stopAnimation, options);
    video.addEventListener(
      "emptied",
      () => {
        stopAnimation();
        updateProgress();
      },
      options,
    );

    syncIdentity();
    updateProgress();
    applyDefaults({ finalize: !video.paused });
    if (!video.paused && !video.ended) {
      startAnimation();
    }
  }

  function scanForPlayer() {
    state.scanScheduled = false;
    if (location.pathname !== "/watch") {
      if (state.player) {
        detachVideo();
        removeProgressBar();
        state.player = null;
      }
      return;
    }

    const player = document.querySelector("#movie_player.html5-video-player");

    if (!player) {
      if (state.player) {
        detachVideo();
        removeProgressBar();
        state.player = null;
      }
      return;
    }

    if (player !== state.player) {
      detachVideo();
      removeProgressBar();
      state.player = player;
      state.bar = createProgressBar(player);
      updateRuntimeMetadata();
    } else if (!state.bar?.root.isConnected) {
      state.bar = createProgressBar(player);
      updateRuntimeMetadata();
    }

    const video = player.querySelector("video.html5-main-video, video");
    if (video && video !== state.video) {
      attachVideo(video);
    } else {
      syncIdentity();
      updateProgress();
      applyDefaults({ finalize: Boolean(state.video && !state.video.paused) });
    }
  }

  function scheduleScan() {
    if (state.scanScheduled) {
      return;
    }
    state.scanScheduled = true;
    queueMicrotask(scanForPlayer);
  }

  function forceApplyChangedSettings(previousSettings) {
    const speedChanged =
      previousSettings.defaultPlaybackRate !== state.settings.defaultPlaybackRate;
    const qualityChanged =
      previousSettings.defaultQuality !== state.settings.defaultQuality;

    if (speedChanged) {
      state.speedApplied = false;
    }
    if (qualityChanged) {
      clearQualityRequest();
      state.qualityApplied = false;
      state.qualityAttempt = 0;
    }

    updateProgress();
    updateRuntimeMetadata();
    if (!syncIdentity()) {
      return;
    }
    if (speedChanged) {
      applySpeed({
        finalize: Boolean(state.video && !state.video.paused),
        force: true,
      });
    }
    if (qualityChanged) {
      requestQuality({ force: true });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (
      message?.source === MESSAGE_SOURCE &&
      message.type === "SPEED_RESULT" &&
      message.requestId === state.speedRequestId
    ) {
      state.speedRequestId = "";
      state.bar?.root.setAttribute(
        "data-speed-status",
        message.success
          ? `applied:${message.playbackRate}`
          : `unavailable:${message.reason || "unknown"}`,
      );
      return;
    }

    if (
      !message ||
      message.source !== MESSAGE_SOURCE ||
      message.type !== "QUALITY_RESULT" ||
      message.requestId !== state.qualityRequestId
    ) {
      return;
    }

    state.qualityRequestId = "";
    if (message.success || !message.retryable) {
      state.qualityApplied = true;
      state.bar?.root.setAttribute(
        "data-quality-status",
        message.success
          ? `applied:${message.qualityCode || "auto"}`
          : `unavailable:${message.reason || "unknown"}`,
      );
      return;
    }

    if (state.qualityAttempt < MAX_QUALITY_ATTEMPTS) {
      const delay = Math.min(250 * 2 ** (state.qualityAttempt - 1), 2000);
      state.qualityRetryTimer = window.setTimeout(() => {
        state.qualityRetryTimer = 0;
        requestQuality();
      }, delay);
    } else {
      state.qualityApplied = true;
      state.bar?.root.setAttribute("data-quality-status", "timed-out");
    }
  });

  document.addEventListener("yt-navigate-finish", scheduleScan);
  document.addEventListener("yt-page-data-updated", scheduleScan);

  const observer = new MutationObserver((records) => {
    if (!state.player) {
      scheduleScan();
      return;
    }

    const touchesPlayer = records.some((record) => {
      if (record.target === state.player || state.player.contains(record.target)) {
        return true;
      }

      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node === state.player ||
          (node instanceof Element &&
            (node.matches("#movie_player, video") ||
              Boolean(node.querySelector("#movie_player, video")))),
      );
    });

    if (touchesPlayer) {
      scheduleScan();
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    // Some Chromium-compatible environments expose sync storage through a
    // local-storage shim. Accept both event names while keeping one settings
    // schema and one write path in the popup.
    if (areaName !== "sync" && areaName !== "local") {
      return;
    }

    const previousSettings = state.settings;
    const changedValues = Object.fromEntries(
      Object.entries(changes).map(([key, change]) => [key, change.newValue]),
    );
    state.settings = normalizeSettings({
      ...state.settings,
      ...changedValues,
    });
    forceApplyChangedSettings(previousSettings);
  });

  chrome.storage.sync
    .get(DEFAULT_SETTINGS)
    .then((stored) => {
      state.settings = normalizeSettings(stored);
      state.settingsLoaded = true;
      updateRuntimeMetadata();
      scheduleScan();
    })
    .catch(() => {
      state.settings = DEFAULT_SETTINGS;
      state.settingsLoaded = true;
      updateRuntimeMetadata();
      scheduleScan();
    });

  scheduleScan();
})();
