const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../src/core.js");
const root = path.join(__dirname, "..");

test("auto-like retries when reaction controls finish loading after a paused seek", async () => {
  const videoListeners = new Map();
  const messages = [];
  let controlsReady = false;
  let likeClicks = 0;
  let observerCallback;
  const createdElements = [];

  class FakeElement {
    constructor(kind = "") {
      this.kind = kind;
      this.dataset = {};
      this.isConnected = true;
      this.style = {};
      this.textContentWrites = 0;
      this._textContent = "";
    }

    get textContent() {
      return this._textContent;
    }

    set textContent(value) {
      this._textContent = String(value);
      this.textContentWrites += 1;
    }

    append() {}

    closest(selector) {
      return this.matches(selector) ? this : null;
    }

    matches(selector) {
      return Boolean(this.kind && selector.includes(this.kind));
    }

    querySelector() {
      return null;
    }

    remove() {
      this.isConnected = false;
    }

    setAttribute(name, value) {
      this[name] = String(value);
    }
  }

  const createButton = (kind) => {
    const button = new FakeElement("button[aria-pressed]");
    button.disabled = false;
    button.click = () => {
      if (kind === "like") {
        likeClicks += 1;
      }
    };
    button.getAttribute = (name) => {
      if (name === "aria-disabled") {
        return "false";
      }
      if (name === "aria-pressed") {
        return "false";
      }
      return null;
    };
    return button;
  };
  const likeButton = createButton("like");
  const dislikeButton = createButton("dislike");
  const likeHost = new FakeElement("like-button-view-model");
  const dislikeHost = new FakeElement("dislike-button-view-model");
  likeHost.querySelector = (selector) =>
    selector === "button" ? likeButton : null;
  dislikeHost.querySelector = (selector) =>
    selector === "button" ? dislikeButton : null;
  const reactionContainer = new FakeElement();
  reactionContainer.querySelector = (selector) => {
    if (selector === "like-button-view-model") {
      return likeHost;
    }
    if (selector === "dislike-button-view-model") {
      return dislikeHost;
    }
    return null;
  };

  const video = new FakeElement("video");
  Object.assign(video, {
    buffered: { length: 0, end: () => 0 },
    currentSrc: "blob:video",
    currentTime: 51,
    defaultPlaybackRate: 1,
    duration: 100,
    ended: false,
    paused: true,
    playbackRate: 1,
    readyState: 1,
  });
  video.addEventListener = (name, listener) => {
    videoListeners.set(name, listener);
  };

  const player = new FakeElement("#movie_player");
  player.classList = { contains: () => false };
  player.contains = (element) => element === video;
  player.querySelector = (selector) =>
    selector === "video.html5-main-video, video" ? video : null;

  const documentObject = {
    addEventListener: () => {},
    createElement: () => {
      const element = new FakeElement();
      createdElements.push(element);
      return element;
    },
    querySelector(selector) {
      if (selector === "#my-youtube-progress") {
        return null;
      }
      if (selector === "#movie_player.html5-video-player") {
        return player;
      }
      if (selector === "ytd-watch-flexy[video-id]") {
        return { getAttribute: () => "test-video" };
      }
      if (
        controlsReady &&
        selector ===
          "ytd-watch-metadata #actions #top-level-buttons-computed"
      ) {
        return reactionContainer;
      }
      return null;
    },
  };

  const context = {
    AbortController,
    Element: FakeElement,
    HTMLMediaElement: { HAVE_METADATA: 1 },
    MyYouTubeCore: core,
    MutationObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }

      observe() {}
    },
    cancelAnimationFrame: () => {},
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          return { claimed: true };
        },
      },
      storage: {
        local: {
          get: async () => core.DEFAULT_SETTINGS,
        },
        onChanged: {
          addListener: () => {},
        },
      },
    },
    document: documentObject,
    location: {
      href: "https://www.youtube.com/watch?v=test-video",
      origin: "https://www.youtube.com",
      pathname: "/watch",
    },
    queueMicrotask,
    requestAnimationFrame: () => 1,
    window: {
      addEventListener: () => {},
      clearTimeout,
      postMessage: () => {},
      setTimeout,
    },
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(root, "src/content.js"), "utf8"),
    context,
  );
  await settleAsyncWork();
  assert.equal(likeClicks, 0);
  assert.deepEqual(messages, []);
  const time = createdElements.find(
    (element) => element.id === "my-youtube-time",
  );
  assert.equal(time.textContent, "0:51 / 1:40");
  assert.equal(time.textContentWrites, 1);

  controlsReady = true;
  observerCallback([
    {
      addedNodes: [likeButton],
      removedNodes: [],
      target: likeHost,
    },
  ]);
  await settleAsyncWork();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "CLAIM_AUTO_LIKE");
  assert.equal(messages[0].videoIdentity, "video:test-video");
  assert.equal(likeClicks, 1);
  assert.equal(time.textContentWrites, 1);
});

async function settleAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}
