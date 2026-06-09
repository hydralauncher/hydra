import { spawnSync } from "node:child_process";

export const isGamemodeAvailable = (): boolean => {
  if (process.platform !== "linux") {
    return false;
  }

  const commandCheck = spawnSync("/bin/sh", ["-c", "command -v gamemoderun"], {
    stdio: "ignore",
    shell: false,
  });

  if (commandCheck.status !== 0 || commandCheck.error) {
    return false;
  }

  const libraryCheck = spawnSync("ldconfig", ["-p"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
    shell: false,
  });

  const hasGamemodeLibraries =
    !libraryCheck.error &&
    libraryCheck.status === 0 &&
    libraryCheck.stdout.includes("libgamemode.so") &&
    libraryCheck.stdout.includes("libgamemodeauto.so");

  if (!hasGamemodeLibraries) {
    return false;
  }

  const result = spawnSync("gamemoderun", ["/bin/sh", "-c", "exit 0"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error && result.status === 0;
};
