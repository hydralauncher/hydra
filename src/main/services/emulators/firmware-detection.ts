import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const firmwareSearchDirs = (executablePath: string | null): string[] => {
  const home = homedir();
  const dirs: string[] = [];

  if (process.platform === "win32") {
    const appData =
      process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
    dirs.push(path.join(appData, "rpcs3", "dev_flash"));
  } else {
    dirs.push(
      path.join(home, ".config", "rpcs3", "dev_flash"),
      path.join(
        home,
        ".var",
        "app",
        "net.rpcs3.RPCS3",
        "config",
        "rpcs3",
        "dev_flash"
      )
    );
  }

  if (executablePath) {
    dirs.push(path.join(path.dirname(executablePath), "dev_flash"));
  }

  return dirs;
};

export const isPs3FirmwareInstalled = async (
  executablePath: string | null
): Promise<boolean> => {
  for (const dir of firmwareSearchDirs(executablePath)) {
    if (!existsSync(dir)) continue;
    const sysExternal = path.join(dir, "sys", "external");
    if (!existsSync(sysExternal)) continue;
    try {
      const entries = await fs.readdir(sysExternal);
      if (entries.length > 0) return true;
    } catch {
      // unreadable — keep looking
    }
  }
  return false;
};
