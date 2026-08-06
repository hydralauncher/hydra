const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "start-dev.cjs"), "utf8");

test("development installs the input broker once without elevating Hydra", () => {
  assert.match(source, /schtasks\.exe/u);
  assert.match(source, /setup-overlay-input\.cjs/u);
  assert.doesNotMatch(source, /isCurrentProcessElevated|launchElevated/u);
});
