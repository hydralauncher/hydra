import { spawnSync } from "node:child_process";

export const isWinetricksAvailable = (): boolean => {
  if (process.platform !== "linux") {
    return false;
  }

  const result = spawnSync("winetricks", ["--version"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error && result.status === 0;
};
