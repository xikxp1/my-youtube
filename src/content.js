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
    findReactionControls,
    formatVideoTime,
    getVideoIdentity,
    isPastAutoLikeThreshold,
    normalizeSettings,
  } = globalThis.MyYouTubeCore;
  const MESSAGE_SOURCE = "my-youtube:v1";
  const AUTO_LIKE_MESSAGE = "CLAIM_AUTO_LIKE";
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
    autoLikeStatus: "idle",
    autoLikeVisitToken: 0,
  };

  function createProgressBar(player) {
    const staleBar = document.querySelector("#my-youtube-progress");
    const staleTime = document.querySelector("#my-youtube-time");
    if (staleBar) {
      staleBar.remove();
    }
    if (staleTime) {
      staleTime.remove();
    }

    const root = document.createElement("div");
    const buffered = document.createElement("div");
    const played = document.createElement("div");
    const time = document.createElement("div");

    root.id = "my-youtube-progress";
    root.setAttribute("aria-hidden", "true");
    buffered.id = "my-youtube-progress-buffered";
    played.id = "my-youtube-progress-played";
    time.id = "my-youtube-time";
    time.setAttribute("aria-hidden", "true");
    root.append(buffered, played);
    player.append(root, time);

    return { root, buffered, played, time };
  }

  function removeProgressBar() {
    state.bar?.root.remove();
    state.bar?.time.remove();
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
    const shouldHideOverlays =
      !state.settingsLoaded ||
      !progress.valid ||
      isAdPlaying() ||
      isLiveVideo(state.video);

    state.bar.root.hidden =
      shouldHideOverlays || !state.settings.progressBarEnabled;
    state.bar.time.hidden = shouldHideOverlays || !state.settings.timerEnabled;
    if (shouldHideOverlays) {
      return;
    }

    if (state.settings.progressBarEnabled) {
      state.bar.played.style.transform = `scaleX(${progress.played})`;
      state.bar.buffered.style.transform = `scaleX(${progress.buffered})`;
    }
    if (state.settings.timerEnabled) {
      const timeText = `${formatVideoTime(
        state.video.currentTime,
      )} / ${formatVideoTime(state.video.duration)}`;
      if (state.bar.time.textContent !== timeText) {
        state.bar.time.textContent = timeText;
      }
    }
  }

  function updateRuntimeMetadata() {
    if (!state.bar) {
      return;
    }

    state.bar.root.dataset.playbackRateTarget = String(
      state.settings.defaultPlaybackRate,
    );
    state.bar.root.dataset.qualityTarget = state.settings.defaultQuality;
    state.bar.root.dataset.autoLikeEnabled = String(
      state.settings.autoLikeEnabled,
    );
    state.bar.root.dataset.timerEnabled = String(state.settings.timerEnabled);
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

  function resetAutoLikeForVisit() {
    state.autoLikeStatus = "idle";
    state.autoLikeVisitToken += 1;
    state.bar?.root.setAttribute("data-auto-like-status", "idle");
  }

  function setAutoLikeStatus(status) {
    state.autoLikeStatus = status;
    state.bar?.root.setAttribute("data-auto-like-status", status);
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
    resetAutoLikeForVisit();
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

  async function maybeAutoLike() {
    if (
      !state.settingsLoaded ||
      !state.settings.autoLikeEnabled ||
      !state.video ||
      !state.identity.startsWith("video:") ||
      state.autoLikeStatus !== "idle" ||
      location.pathname !== "/watch" ||
      isAdPlaying() ||
      isLiveVideo(state.video) ||
      !isPastAutoLikeThreshold(state.video.currentTime, state.video.duration)
    ) {
      return;
    }

    const identity = state.identity;
    const video = state.video;
    const visitToken = state.autoLikeVisitToken;
    let controls = findReactionControls(document);
    if (!controls) {
      state.bar?.root.setAttribute(
        "data-auto-like-status",
        "waiting-for-controls",
      );
      return;
    }

    if (controls.liked || controls.disliked) {
      setAutoLikeStatus("skipped:reaction-present");
      return;
    }

    setAutoLikeStatus("checking");
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: AUTO_LIKE_MESSAGE,
        videoIdentity: identity,
      });
    } catch {
      if (state.autoLikeVisitToken === visitToken) {
        setAutoLikeStatus("idle");
        state.bar?.root.setAttribute(
          "data-auto-like-status",
          "waiting-for-background",
        );
      }
      return;
    }

    if (
      state.autoLikeVisitToken !== visitToken ||
      state.identity !== identity ||
      state.video !== video ||
      !state.settings.autoLikeEnabled ||
      location.pathname !== "/watch" ||
      isAdPlaying() ||
      isLiveVideo(video) ||
      !isPastAutoLikeThreshold(video.currentTime, video.duration)
    ) {
      return;
    }

    if (!response?.claimed) {
      setAutoLikeStatus("skipped:session-history");
      return;
    }

    controls = findReactionControls(document);
    if (!controls || controls.liked || controls.disliked) {
      setAutoLikeStatus("skipped:state-changed");
      return;
    }

    setAutoLikeStatus("clicked");
    controls.likeButton.click();
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
          void maybeAutoLike();
        },
        options,
      );
    }

    video.addEventListener(
      "playing",
      () => {
        applyDefaults({ finalize: true });
        void maybeAutoLike();
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
    void maybeAutoLike();
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
    } else if (!state.bar?.root.isConnected || !state.bar?.time.isConnected) {
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
      void maybeAutoLike();
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
    const autoLikeChanged =
      previousSettings.autoLikeEnabled !== state.settings.autoLikeEnabled;

    if (speedChanged) {
      state.speedApplied = false;
    }
    if (qualityChanged) {
      clearQualityRequest();
      state.qualityApplied = false;
      state.qualityAttempt = 0;
    }
    if (autoLikeChanged) {
      resetAutoLikeForVisit();
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
    void maybeAutoLike();
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

  document.addEventListener("yt-navigate-finish", () => {
    resetAutoLikeForVisit();
    scheduleScan();
  });
  document.addEventListener("yt-page-data-updated", scheduleScan);

  const observer = new MutationObserver((records) => {
    if (!state.player) {
      scheduleScan();
      return;
    }

    const reactionSelector =
      "like-button-view-model, dislike-button-view-model, #segmented-like-button, #segmented-dislike-button";
    const touchesPlayer = records.some((record) => {
      if (
        record.target === state.bar?.root ||
        record.target === state.bar?.time ||
        state.bar?.root.contains?.(record.target)
      ) {
        return false;
      }

      if (record.target === state.player || state.player.contains(record.target)) {
        return true;
      }

      if (
        record.target instanceof Element &&
        (record.target.matches(reactionSelector) ||
          Boolean(record.target.closest(reactionSelector)))
      ) {
        return true;
      }

      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node === state.player ||
          (node instanceof Element &&
            (node.matches(
              `#movie_player, video, button[aria-pressed], ${reactionSelector}, ytd-segmented-like-dislike-button-renderer`,
            ) ||
              Boolean(
                node.querySelector(
                  `#movie_player, video, button[aria-pressed], ${reactionSelector}, ytd-segmented-like-dislike-button-renderer`,
                ),
              ))),
      );
    });

    if (touchesPlayer) {
      scheduleScan();
    }
  });
  observer.observe(document, {
    attributes: true,
    attributeFilter: ["aria-disabled", "aria-pressed", "disabled"],
    childList: true,
    subtree: true,
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
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

  chrome.storage.local
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
