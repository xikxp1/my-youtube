(function initBackground() {
  "use strict";

  const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com"]);
  const AUTO_LIKE_MESSAGE = "CLAIM_AUTO_LIKE";
  const AUTO_LIKE_KEY_PREFIX = "my-youtube:auto-liked:";

  function isWatchUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" &&
        WATCH_HOSTS.has(parsed.hostname) &&
        parsed.pathname === "/watch";
    } catch {
      return false;
    }
  }

  async function injectIntoWatchPage(details) {
    if (details.frameId !== 0 || !isWatchUrl(details.url)) {
      return;
    }

    const target = { tabId: details.tabId, frameIds: [0] };
    try {
      await chrome.scripting.insertCSS({
        target,
        files: ["src/content.css"],
      });
      await chrome.scripting.executeScript({
        target,
        files: ["src/main-world.js"],
        world: "MAIN",
      });
      await chrome.scripting.executeScript({
        target,
        files: ["src/core.js", "src/content.js"],
        world: "ISOLATED",
      });
    } catch {
      // Static content scripts remain the primary path. The fallback must
      // never interfere with navigation if Arc rejects programmatic injection.
    }
  }

  function isValidVideoIdentity(value) {
    return (
      typeof value === "string" &&
      /^video:[A-Za-z0-9_-]{1,64}$/.test(value)
    );
  }

  function createAutoLikeClaimer(storageArea) {
    const pendingClaims = new Set();

    return async function claimAutoLike(videoIdentity) {
      if (
        !isValidVideoIdentity(videoIdentity) ||
        pendingClaims.has(videoIdentity)
      ) {
        return false;
      }

      pendingClaims.add(videoIdentity);
      const key = `${AUTO_LIKE_KEY_PREFIX}${videoIdentity}`;
      try {
        const stored = await storageArea.get(key);
        if (stored[key] === true) {
          return false;
        }

        await storageArea.set({ [key]: true });
        return true;
      } catch {
        return false;
      } finally {
        pendingClaims.delete(videoIdentity);
      }
    };
  }

  async function handleAutoLikeMessage(message, claimAutoLike) {
    if (
      message?.type !== AUTO_LIKE_MESSAGE ||
      !isValidVideoIdentity(message.videoIdentity)
    ) {
      return { claimed: false };
    }

    return {
      claimed: await claimAutoLike(message.videoIdentity),
    };
  }

  if (typeof chrome !== "undefined") {
    if (chrome.webNavigation) {
      chrome.webNavigation.onCommitted.addListener(injectIntoWatchPage);
      chrome.webNavigation.onHistoryStateUpdated.addListener(injectIntoWatchPage);
    }

    if (chrome.runtime?.onMessage && chrome.storage?.session) {
      const claimAutoLike = createAutoLikeClaimer(chrome.storage.session);
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== AUTO_LIKE_MESSAGE) {
          return false;
        }

        handleAutoLikeMessage(message, claimAutoLike).then(sendResponse);
        return true;
      });
    }
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      AUTO_LIKE_KEY_PREFIX,
      AUTO_LIKE_MESSAGE,
      createAutoLikeClaimer,
      handleAutoLikeMessage,
      isValidVideoIdentity,
      isWatchUrl,
    };
  }
})();
