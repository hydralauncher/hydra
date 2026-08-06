const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const systemRoot = process.env.SystemRoot ?? String.raw`C:\Windows`;
const taskScheduler = path.join(systemRoot, "System32", "schtasks.exe");
const stableDirectory = path.join(
  path.parse(systemRoot).root,
  "Program Files",
  "Hydra Overlay Input"
);
const broker = path.join(
  projectRoot,
  "hydra-native",
  "hydra-overlay-input.exe"
);
const presentMon = path.join(projectRoot, "presentmon", "PresentMon.exe");
const stableBroker = path.join(stableDirectory, "hydra-overlay-input.exe");
const stablePresentMon = path.join(stableDirectory, "PresentMon.exe");
const clientExecutable = require("electron");
const dataDirectory = path.join(
  process.env.APPDATA ??
    path.join(path.parse(systemRoot).root, "Users", process.env.USERNAME ?? ""),
  "hydralauncher",
  "overlay-input"
);
const filesMatch = (left, right) =>
  fs.existsSync(left) &&
  fs.existsSync(right) &&
  fs.readFileSync(left).equals(fs.readFileSync(right));

if (process.platform === "win32") {
  if (!fs.existsSync(broker)) {
    const build = childProcess.spawnSync(
      process.execPath,
      [path.join(__dirname, "build-native-addon.cjs")],
      { cwd: projectRoot, stdio: "inherit", windowsHide: true }
    );
    if (build.status !== 0) process.exit(build.status ?? 1);
  }

  const task = childProcess.spawnSync(
    taskScheduler,
    ["/Query", "/TN", "Hydra Overlay Input", "/XML"],
    { encoding: "utf8", windowsHide: true }
  );
  if (
    task.status !== 0 ||
    !task.stdout.toLowerCase().includes(stableBroker.toLowerCase()) ||
    !task.stdout.toLowerCase().includes(dataDirectory.toLowerCase()) ||
    !task.stdout.toLowerCase().includes(clientExecutable.toLowerCase()) ||
    !filesMatch(broker, stableBroker) ||
    !filesMatch(presentMon, stablePresentMon)
  ) {
    const setup = childProcess.spawnSync(
      process.execPath,
      [path.join(__dirname, "setup-overlay-input.cjs")],
      { cwd: projectRoot, stdio: "inherit", windowsHide: true }
    );
    if (setup.status !== 0) process.exit(setup.status ?? 1);
  }
}

const electronVite = path.join(
  projectRoot,
  "node_modules",
  "electron-vite",
  "bin",
  "electron-vite.js"
);
const dev = childProcess.spawn(process.execPath, [electronVite, "dev"], {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true,
});

dev.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
