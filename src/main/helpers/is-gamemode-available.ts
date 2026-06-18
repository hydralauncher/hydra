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

  const ldconfigPaths = ["/usr/sbin/ldconfig", "/sbin/ldconfig", "ldconfig"];

  let hasGamemodeLibraries = false;

  for (const ldconfigPath of ldconfigPaths) {
    const libraryCheck = spawnSync(ldconfigPath, ["-p"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      shell: false,
    });

    if (
      !libraryCheck.error &&
      libraryCheck.status === 0 &&
      libraryCheck.stdout.includes("libgamemode.so") &&
      libraryCheck.stdout.includes("libgamemodeauto.so")
    ) {
      hasGamemodeLibraries = true;
      break;
    }
  }

  if (!hasGamemodeLibraries) {
    return false;
  }

  const result = spawnSync("gamemoderun", ["/bin/sh", "-c", "exit 0"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error && result.status === 0;
};
