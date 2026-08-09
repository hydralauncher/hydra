import fs from "node:fs";
import { registerEvent } from "../register-event";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { gamesSublevel } from "@main/level";
import { logger, WindowManager } from "@main/services";

interface RemovedGame {
  title: string;
  executablePath: string;
  iconUrl: string | null;
}

const pathExists = async (filePath: string): Promise<boolean | undefined> => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    logger.warn(
      `[RemoveUninstalledGameExecutables] Skipping ${filePath}: ${(err as Error).message}`
    );
    return undefined; // unavailable/unreadable — don't mark as removed
  }
};

const removeUninstalledGameExecutables = async () => {
  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(
          ([_key, game]) => game.isDeleted === false && game.shop !== "custom"
        )
        .map(([key, game]) => ({ key, game }))
    );

  const removedGames: RemovedGame[] = [];
  const gamesToCheck = games.filter((g) => g.game.executablePath);

  for (const { key, game } of gamesToCheck) {
    const exePath = game.executablePath!;
    const exists = await pathExists(exePath);
    if (exists === false) {
      await gamesSublevel.put(key, {
        ...updateGameExecutablePath(game, null),
        installedSizeInBytes: null,
        automaticCloudSync: false,
      });

      logger.info(
        `[RemoveUninstalledGameExecutables] Removed executable for ${game.objectId}: ${exePath}`
      );
      removedGames.push({
        title: game.title,
        executablePath: exePath,
        iconUrl: game.iconUrl ?? null,
      });
    }
  }

  if (removedGames.length > 0) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }
  return { removedGames: removedGames };
};

registerEvent(
  "removeUninstalledGameExecutables",
  removeUninstalledGameExecutables
);
