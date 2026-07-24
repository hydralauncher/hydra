const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(projectRoot, file), "utf8");

test("native overlay packaging has no ASDF runtime or elevation manifest", () => {
  const packageJson = JSON.parse(read("package.json"));
  const builder = read("electron-builder.yml");
  const lockfile = read("yarn.lock");

  assert.equal(packageJson.scripts.dev, "node ./scripts/start-dev.cjs");
  assert.equal(
    packageJson.optionalDependencies?.["@asdf-overlay/core"],
    undefined
  );
  assert.doesNotMatch(builder, /@asdf-overlay|requestedExecutionLevel/u);
  assert.doesNotMatch(lockfile, /@asdf-overlay\/core/u);
  assert.equal(
    fs.existsSync(path.join(projectRoot, "LICENSE-ASDF-OVERLAY")),
    false
  );
});

test("native input and UI use Shift+Tab", () => {
  const manager = read("src/main/services/overlay-manager.ts");
  const broker = read("native/hydra-native/src/bin/hydra-overlay-input.rs");

  assert.match(manager, /PREFERRED_SHORTCUT = "Shift\+Tab"/u);
  assert.match(
    broker,
    /RegisterHotKey\(window, HOTKEY_ID, MOD_SHIFT \| MOD_NOREPEAT, 0x09\)/u
  );
  assert.doesNotMatch(manager, /injectedOverlay|Shift\+F3/u);
});

test("platform overlay integration is installed on demand", () => {
  const installer = read("build/installer.nsh");
  const native = read("native/hydra-native/src/lib.rs");
  const cargo = read("native/hydra-native/Cargo.toml");
  const brokerInstaller = read("src/main/services/overlay-input-broker.ts");

  assert.match(installer, /\/SC ONCE \/SD 01\/01\/2099/u);
  assert.doesNotMatch(installer, /ONLOGON/u);
  assert.match(native, /GAMESCOPE_EXTERNAL_OVERLAY/u);
  assert.match(native, /GAMESCOPE_NO_FOCUS/u);
  assert.match(cargo, /x11rb = "0\.13\.2"/u);
  assert.match(brokerInstaller, /app\.getPath\("userData"\)/u);
  assert.match(brokerInstaller, /Register-ScheduledTask/u);
});

test("Windows FPS capture falls back to borderless native frame events", () => {
  const cargo = read("native/hydra-native/Cargo.toml");
  const broker = read("native/hydra-native/src/bin/hydra-overlay-input.rs");
  const monitor = read("src/main/services/overlay-fps-monitor.ts");

  assert.match(cargo, /windows-capture = "2\.0\.0"/u);
  assert.match(broker, /DrawBorderSettings::WithoutBorder/u);
  assert.match(broker, /MsBetweenPresents/u);
  assert.match(monitor, /FILTERED_CAPTURE_TIMEOUT/u);
  assert.match(monitor, /Windows Graphics Capture FPS fallback/u);
});

test("PresentMon runs without creating a console window", () => {
  const broker = read("native/hydra-native/src/bin/hydra-overlay-input.rs");

  assert.match(broker, /CommandExt/u);
  assert.match(broker, /creation_flags\(CREATE_NO_WINDOW\)/u);
});
