const test = require("node:test");
const assert = require("node:assert/strict");

const { isWatchUrl } = require("../src/background.js");

test("fallback injection is restricted to supported YouTube watch pages", () => {
  assert.equal(isWatchUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isWatchUrl("https://youtube.com/watch?v=abc"), true);
  assert.equal(isWatchUrl("https://www.youtube.com/shorts/abc"), false);
  assert.equal(isWatchUrl("https://music.youtube.com/watch?v=abc"), false);
  assert.equal(isWatchUrl("https://example.com/watch?v=abc"), false);
  assert.equal(isWatchUrl("not a url"), false);
});
