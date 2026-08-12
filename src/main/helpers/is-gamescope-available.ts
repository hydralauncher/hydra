import { spawnSync } from "node:child_process";

export const isGamescopeAvailable = (): boolean => {
  if (process.platform !== "linux") {
    return false;
  }

  const result = spawnSync("/bin/sh", ["-c", "command -v gamescope"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error && result.status === 0;
};
