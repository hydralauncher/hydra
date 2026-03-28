import { spawnSync } from "node:child_process";

export const isMangohudAvailable = (): boolean => {
  if (process.platform !== "linux") {
    return false;
  }

  const result = spawnSync("mangohud", ["--version"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error && result.status === 0;
};
