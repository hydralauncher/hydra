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
  assert.match(builder, /filter:[\s\S]*hydra-native\.node/u);
  assert.match(builder, /hydra-overlay-input\.exe/u);
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
  assert.match(cargo, /evdev = "0\.13\.2"/u);
  assert.match(brokerInstaller, /app\.getPath\("userData"\)/u);
  assert.match(brokerInstaller, /"Program Files"/u);
  assert.match(brokerInstaller, /Copy-Item -LiteralPath/u);
  assert.match(brokerInstaller, /--data-directory/u);
  assert.match(brokerInstaller, /--client-executable/u);
  assert.match(brokerInstaller, /Register-ScheduledTask/u);
});

test("Linux overlay uses XWayland geometry without portal prompts", () => {
  const main = read("src/main/index.ts");
  const native = read("native/hydra-native/src/lib.rs");
  const manager = read("src/main/services/overlay-manager.ts");
  const overlay = read("src/renderer/src/pages/overlay/overlay.tsx");

  assert.match(main, /appendSwitch\("ozone-platform", "x11"\)/u);
  assert.doesNotMatch(main, /GlobalShortcutsPortal/u);
  assert.match(native, /BTN_SELECT/u);
  assert.match(native, /BTN_START/u);
  assert.match(native, /ABS_HAT0X/u);
  assert.match(native, /ABS_HAT0Y/u);
  assert.match(native, /grab_key/u);
  assert.match(native, /ungrab_key/u);
  assert.match(native, /stop_overlay_keyboard_watcher/u);
  assert.match(native, /LINUX_GAMEPAD_BUTTONS/u);
  assert.match(
    manager,
    /process\.platform === "win32" \|\| process\.platform === "linux"/u
  );
  assert.doesNotMatch(overlay, /BatteryManager|getBatteryLabel|<Battery/u);
  const shortcutRegistration = manager.slice(
    manager.indexOf("private static registerShortcut")
  );
  assert.ok(
    shortcutRegistration.indexOf('process.platform === "linux"') <
      shortcutRegistration.indexOf("globalShortcut.register")
  );
});

test("overlay notes reject stale cross-game requests", () => {
  const events = read("src/main/events/overlay/index.ts");
  const preload = read("src/preload/index.ts");
  const overlay = read("src/renderer/src/pages/overlay/overlay.tsx");

  assert.match(events, /isActiveGame\(shop, objectId\)/u);
  assert.match(
    preload,
    /ipcRenderer\.invoke\(\s*"saveOverlayNote",\s*shop,\s*objectId,\s*note\s*\)/u
  );
  assert.match(
    overlay,
    /saveOverlayNote\(activeNoteShop, activeNoteObjectId, note\)/u
  );
  assert.match(overlay, /maxLength=\{20_000\}/u);
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

test("long Windows performance sessions rotate their capture output", () => {
  const broker = read("native/hydra-native/src/bin/hydra-overlay-input.rs");
  const monitor = read("src/main/services/overlay-fps-monitor.ts");

  assert.match(broker, /restart/u);
  assert.match(monitor, /MAX_CAPTURE_FILE_BYTES/u);
  assert.match(monitor, /restartBrokerCapture/u);
});

test("PresentMon download is integrity checked", () => {
  const postinstall = read("scripts/postinstall.cjs");

  assert.match(postinstall, /presentMonSha256/u);
  assert.match(postinstall, /createHash\("sha256"\)/u);
  assert.match(postinstall, /checksum mismatch/u);
  assert.match(postinstall, /PresentMon-LICENSE\.txt/u);
});

test("Windows overlay helpers do not resolve system tools through PATH", () => {
  const sources = [
    read("scripts/setup-overlay-input.cjs"),
    read("scripts/start-dev.cjs"),
    read("src/main/services/overlay-input-broker.ts"),
  ];
  const pathResolvedSystemTool =
    /(?:spawn|spawnSync|execFileAsync)\(\s*["'](?:powershell|schtasks)\.exe["']/u;

  for (const source of sources) {
    assert.doesNotMatch(source, pathResolvedSystemTool);
    assert.match(source, /SystemRoot/u);
    assert.match(source, /System32/u);
  }
});

test("overlay buttons declare non-submit behavior", () => {
  const sources = [
    read("src/renderer/src/pages/overlay/overlay.tsx"),
    read("src/renderer/src/pages/overlay/overlay-performance.tsx"),
  ];

  for (const source of sources) {
    const buttons = source.match(/<button\b[^>]*>/gu) ?? [];
    assert.ok(buttons.length > 0);
    for (const button of buttons) assert.match(button, /type="button"/u);
  }
});

test("fullscreen overlay presentation does not activate over the game", () => {
  const manager = read("src/main/services/overlay-manager.ts");
  const native = read("native/hydra-native/src/lib.rs");

  assert.match(manager, /shouldPreserveGameFocus/u);
  assert.match(manager, /overlayWindow\.showInactive\(\)/u);
  assert.match(native, /SWP_NOACTIVATE \| SWP_SHOWWINDOW/u);
});

test("elevated broker acknowledges game process termination", () => {
  const broker = read("native/hydra-native/src/bin/hydra-overlay-input.rs");
  const client = read("src/main/services/overlay-input-broker.ts");

  assert.match(broker, /TerminateProcess/u);
  assert.match(broker, /HydraOverlayInputBroker/u);
  assert.match(broker, /GetNamedPipeClientProcessId/u);
  assert.match(broker, /QueryFullProcessImageNameW/u);
  assert.match(broker, /client_executable/u);
  assert.doesNotMatch(broker, /terminate\.request|terminate\.result/u);
  assert.doesNotMatch(broker, /capture\.pid/u);
  assert.match(client, /requestElevatedProcessTermination/u);
  assert.match(client, /requestElevatedPerformanceCapture/u);
  assert.match(client, /HydraOverlayInputBroker/u);
});
