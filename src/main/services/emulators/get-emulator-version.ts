import { spawnSync } from "node:child_process";
import { resolveEmulatorExecutableTarget } from "./macos-app-bundle";

const VERSION_REGEX = /\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.-]*)/;

export const getEmulatorVersion = (
  executablePath: string,
  binary: { versionFlags: string[] }
): string | null => {
  const executableTarget = resolveEmulatorExecutableTarget(executablePath);
  if (!executableTarget) return null;

  for (const flag of binary.versionFlags) {
    const result = spawnSync(executableTarget, [flag], {
      encoding: "utf8",
      shell: false,
      timeout: 5000,
    });

    if (result.error) continue;

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const match = VERSION_REGEX.exec(output);
    if (match) return match[0];
  }

  return null;
};
