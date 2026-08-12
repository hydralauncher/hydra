import { spawnSync } from "node:child_process";

export const isGamescopeAvailable = (): boolean => {
  if (process.platform !== "linux") {
    return false;
  }

  // nosonar
  const result = spawnSync("gamescope", ["--help"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error;
};
