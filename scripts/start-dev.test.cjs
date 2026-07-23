const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { quoteWindowsArgument } = require("./start-dev.cjs");

const projectRoot = path.resolve(__dirname, "..");

test("quotes Windows arguments for the elevated development process", () => {
  assert.equal(quoteWindowsArgument("plain"), "plain");
  assert.equal(quoteWindowsArgument("two words"), '"two words"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.equal(
    quoteWindowsArgument("C:\\Program Files\\"),
    '"C:\\Program Files\\\\"'
  );
});

test("development and packaged Windows builds request elevation", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
  );
  const builderConfig = fs.readFileSync(
    path.join(projectRoot, "electron-builder.yml"),
    "utf8"
  );
  assert.equal(packageJson.scripts.dev, "node ./scripts/start-dev.cjs");
  assert.match(builderConfig, /requestedExecutionLevel: requireAdministrator/u);
});
