import fs from "node:fs/promises";
import path from "node:path";
import { Legendary } from "./legendary";

/** The private interpreter is shared; the Legendary cache wrapper is not. */
export async function getLegendaryLinuxPythonRunnerPath() {
  const binary = Legendary.getBinaryPath();
  if (process.platform !== "linux" || !binary)
    throw new Error("compatibility-runtime-unavailable");
  const runner = path.join(path.dirname(binary), "python-runner");
  const info = await fs.lstat(runner);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("compatibility-runtime-unavailable");
  await fs.access(runner, fs.constants.X_OK);
  return runner;
}
