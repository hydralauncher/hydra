const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const taskScheduler = path.join(systemRoot, "System32", "schtasks.exe");
const broker = path.join(
  projectRoot,
  "hydra-native",
  "hydra-overlay-input.exe"
);

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
  if (task.status !== 0 || !task.stdout.includes(broker)) {
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
