(function initInjectionFallback() {
  "use strict";

  const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com"]);

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

  if (typeof chrome !== "undefined" && chrome.webNavigation) {
    chrome.webNavigation.onCommitted.addListener(injectIntoWatchPage);
    chrome.webNavigation.onHistoryStateUpdated.addListener(injectIntoWatchPage);
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { isWatchUrl };
  }
})();
