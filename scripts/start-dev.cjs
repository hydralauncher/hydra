const childProcess = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const elevatedMarker = "--hydra-dev-elevated";

const quoteWindowsArgument = (value) => {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
};

const loadNativeAddon = () => {
  try {
    return require(path.join(projectRoot, "hydra-native", "hydra-native.node"));
  } catch (error) {
    throw new Error(
      "Hydra's native addon is missing. Run yarn build:native before yarn dev.",
      { cause: error }
    );
  }
};

const launchDevServer = () => {
  const cliPath = path.join(
    projectRoot,
    "node_modules",
    "electron-vite",
    "bin",
    "electron-vite.js"
  );
  const child = childProcess.spawn(process.execPath, [cliPath, "dev"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
};

const run = () => {
  if (process.platform !== "win32") {
    launchDevServer();
    return;
  }

  const nativeAddon = loadNativeAddon();
  const elevated = nativeAddon.isCurrentProcessElevated();
  const relaunched = process.argv.includes(elevatedMarker);

  if (elevated) {
    launchDevServer();
  } else if (relaunched) {
    console.error(
      "Hydra development requires administrator approval on Windows."
    );
    process.exitCode = 1;
  } else {
    console.log("Requesting administrator access for Hydra development...");
    const parameters = [__filename, elevatedMarker]
      .map(quoteWindowsArgument)
      .join(" ");
    const launched = nativeAddon.launchElevated(
      process.execPath,
      parameters,
      projectRoot
    );
    if (!launched) {
      console.error("Administrator access was cancelled or unavailable.");
      process.exitCode = 1;
    }
  }
};

if (require.main === module) run();

module.exports = { quoteWindowsArgument };
