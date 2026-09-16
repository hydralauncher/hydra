// Runs an arbitrary cargo command for the sidecar with the MSVC environment the
// Windows host needs — the same resolution `build-stream-sidecar.cjs` uses, so a
// one-off check and a real build cannot disagree about the toolchain.
//
//   node scripts/cargo-msvc.mjs check --release
//   node scripts/cargo-msvc.mjs test  --release -- --skip live_video_and_control_smoke
//   node scripts/cargo-msvc.mjs build --release
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCargoEnvironment } from "./lib/native-build.cjs";

const cargoArgs = process.argv.slice(2);
if (cargoArgs.length === 0) {
  console.error("usage: node scripts/cargo-msvc.mjs <cargo command> [args…]");
  process.exit(2);
}

const manifestDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "native",
  "hydra-stream"
);

const { target, environment } = loadCargoEnvironment();

// `--target` is a cargo option, so it has to land before the `--` that hands the
// rest to the test harness — appended after it, cargo ignores it and silently
// falls back to the default (GNU) host toolchain.
const separator = cargoArgs.indexOf("--");
const cargoArguments =
  target === null
    ? cargoArgs
    : separator === -1
      ? [...cargoArgs, "--target", target]
      : [
          ...cargoArgs.slice(0, separator),
          "--target",
          target,
          ...cargoArgs.slice(separator),
        ];

const child = spawn("cargo", cargoArguments, {
  cwd: manifestDirectory,
  env: environment ?? process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
