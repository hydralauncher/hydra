import { findGameExecutableInFolder } from "@main/helpers/find-game-executable";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { gamesSublevel, levelKeys } from "@main/level";
import { runAutomaticCloudSaveSync } from "../cloud-save";
import { GameExecutables } from "../game-executables";
import { steamSyncLogger } from "../logger";
import { getSteamAppInstallDirectories } from "./steam-installation";

export const linkImportedSteamGameExecutables = async (): Promise<number> => {
  try {
    const candidates = (await gamesSublevel.iterator().all())
      .map(([, game]) => game)
      .filter(
        (game) =>
          game.shop === "steam" &&
          game.isDeleted !== true &&
          game.hasActiveSteamImport === true &&
          !game.executablePath &&
          Boolean(GameExecutables.getExecutablesForGame(game.objectId)?.length)
      );

    const installDirectories = await getSteamAppInstallDirectories(
      candidates.map((game) => game.objectId)
    );
    let linkedCount = 0;

    for (const candidate of candidates) {
      const installDirectory = installDirectories.get(candidate.objectId);
      const executables = GameExecutables.getExecutablesForGame(
        candidate.objectId
      );

      if (!installDirectory || !executables?.length) continue;

      const executablePath = await findGameExecutableInFolder(
        installDirectory,
        executables
      );
      if (!executablePath) continue;

      const gameKey = levelKeys.game(candidate.shop, candidate.objectId);
      const currentGame = await gamesSublevel.get(gameKey);

      if (
        !currentGame ||
        currentGame.isDeleted ||
        !currentGame.hasActiveSteamImport ||
        currentGame.executablePath
      ) {
        continue;
      }

      await gamesSublevel.put(
        gameKey,
        updateGameExecutablePath(currentGame, executablePath)
      );
      linkedCount += 1;

      steamSyncLogger.log(
        `Auto-detected executable for imported Steam game ${candidate.objectId}: ${executablePath}`
      );

      void runAutomaticCloudSaveSync(
        candidate.objectId,
        candidate.shop,
        "environment-changed"
      );
    }

    return linkedCount;
  } catch (error) {
    steamSyncLogger.error(
      "Failed to auto-detect imported Steam executables",
      error
    );
    return 0;
  }
};
