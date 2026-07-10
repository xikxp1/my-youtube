const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTO_LIKE_KEY_PREFIX,
  AUTO_LIKE_MESSAGE,
  createAutoLikeClaimer,
  handleAutoLikeMessage,
  isValidVideoIdentity,
  isWatchUrl,
} = require("../src/background.js");

test("fallback injection is restricted to supported YouTube watch pages", () => {
  assert.equal(isWatchUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isWatchUrl("https://youtube.com/watch?v=abc"), true);
  assert.equal(isWatchUrl("https://www.youtube.com/shorts/abc"), false);
  assert.equal(isWatchUrl("https://music.youtube.com/watch?v=abc"), false);
  assert.equal(isWatchUrl("https://example.com/watch?v=abc"), false);
  assert.equal(isWatchUrl("not a url"), false);
});

test("video identity validation only accepts bounded YouTube identities", () => {
  assert.equal(isValidVideoIdentity("video:dQw4w9WgXcQ"), true);
  assert.equal(isValidVideoIdentity("video:abc_DEF-123"), true);
  assert.equal(isValidVideoIdentity("media:blob:123"), false);
  assert.equal(isValidVideoIdentity("video:"), false);
  assert.equal(isValidVideoIdentity("video:contains spaces"), false);
});

test("auto-like claims persist once per video and remain independent", async () => {
  const storage = createSessionStorage();
  const claimAutoLike = createAutoLikeClaimer(storage);

  assert.equal(await claimAutoLike("video:first"), true);
  assert.equal(await claimAutoLike("video:first"), false);
  assert.equal(await claimAutoLike("video:second"), true);
  assert.deepEqual(storage.data, {
    [`${AUTO_LIKE_KEY_PREFIX}video:first`]: true,
    [`${AUTO_LIKE_KEY_PREFIX}video:second`]: true,
  });
});

test("concurrent auto-like claims allow only one caller", async () => {
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const storage = createSessionStorage();
  const originalGet = storage.get;
  storage.get = async (key) => {
    await readGate;
    return originalGet(key);
  };
  const claimAutoLike = createAutoLikeClaimer(storage);

  const firstClaim = claimAutoLike("video:shared");
  const secondClaim = claimAutoLike("video:shared");
  assert.equal(await secondClaim, false);
  releaseRead();
  assert.equal(await firstClaim, true);
});

test("auto-like messages validate the payload", async () => {
  const claims = [];
  const claimAutoLike = async (identity) => {
    claims.push(identity);
    return true;
  };
  assert.deepEqual(
    await handleAutoLikeMessage(
      {
        type: AUTO_LIKE_MESSAGE,
        videoIdentity: "video:abc",
      },
      claimAutoLike,
    ),
    { claimed: true },
  );
  assert.deepEqual(
    await handleAutoLikeMessage(
      { type: "UNKNOWN", videoIdentity: "video:abc" },
      claimAutoLike,
    ),
    { claimed: false },
  );
  assert.deepEqual(
    await handleAutoLikeMessage(
      { type: AUTO_LIKE_MESSAGE, videoIdentity: "media:abc" },
      claimAutoLike,
    ),
    { claimed: false },
  );
  assert.deepEqual(claims, ["video:abc"]);
});

function createSessionStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return { [key]: data[key] };
    },
    async set(values) {
      Object.assign(data, values);
    },
  };
}
