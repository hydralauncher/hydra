import { emulators, WindowManager, logger } from "@main/services";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type { EmulatorSystem } from "@types";

import { runLaunchboxImport } from "./import-launchbox-roms";
import { setClassicsImporting } from "./classics-import-state";

const SYSTEMS: EmulatorSystem[] = ["ps1", "ps2", "ps3"];

export const reimportClassicsGames = async () => {
  const language =
    (await db
      .get<string, string>(levelKeys.language, { valueEncoding: "utf8" })
      .catch(() => "en")) ?? "en";

  const configs = await Promise.all(
    SYSTEMS.map(async (system) => ({
      system,
      config: await emulators.getEmulatorConfig(system),
    }))
  );

  const systemsToScan = configs.filter(
    ({ config }) => config.romFolders.length > 0
  );

  if (systemsToScan.length === 0) return;

  setClassicsImporting(true);
  WindowManager.sendToAppWindows("on-classics-import-status", true);

  try {
    for (const { system, config } of systemsToScan) {
      try {
        await runLaunchboxImport(
          system,
          config.romFolders.map((folder) => ({
            path: folder.path,
            scanSubfolders: folder.scanSubfolders,
          })),
          language,
          { cancelled: false }
        );
      } catch (err) {
        logger.error(`Failed to reimport classics games for ${system}`, err);
      }
    }

    WindowManager.sendToAppWindows("on-library-batch-complete");
  } finally {
    setClassicsImporting(false);
    WindowManager.sendToAppWindows("on-classics-import-status", false);
  }
};
