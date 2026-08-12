import { spawnSync } from "node:child_process";

export const isGamescopeAvailable = (): boolean => {
  if (process.platform !== "linux") {
    return false;
  }

  const result = spawnSync("gamescope", ["--help"], {
    // nosonar
    stdio: "ignore",
    shell: false,
  });

  return !result.error;
};
