import path from "node:path";
import type { Game } from "@types";
import { levelKeys } from "@main/level";
import { getSteamLibraryFolders } from "./steam";
import { updateGameRecord } from "./game-record-updater";
import { logger } from "./logger";
import { isExecutableMissingFromAvailableStorage } from "./executable-availability-core";
import {
  isPathInsideSteamInstallDirectory,
  isStaleSteamLibraryExecutable,
} from "./steam-integration/steam-installation-core";

const isInsideSteamLibrary = (
  executablePath: string,
  libraryFolders: string[]
) =>
  libraryFolders.some((folder) =>
    isPathInsideSteamInstallDirectory(
      executablePath,
      path.join(folder, "steamapps", "common")
    )
  );

const isExecutableGone = (executablePath: string, libraryFolders: string[]) =>
  isInsideSteamLibrary(executablePath, libraryFolders)
    ? isStaleSteamLibraryExecutable(executablePath, libraryFolders)
    : isExecutableMissingFromAvailableStorage(executablePath);

export const clearMissingExecutables = async (
  games: Game[]
): Promise<Game[]> => {
  const candidates = games.filter(
    (game) =>
      game.isDeleted !== true &&
      game.shop !== "custom" &&
      game.shop !== "launchbox" &&
      Boolean(game.executablePath)
  );
  if (candidates.length === 0) return [];

  const libraryFolders = await getSteamLibraryFolders().catch(() => []);
  const clearedGames: Game[] = [];

  for (const game of candidates) {
    const executablePath = game.executablePath!;
    if (!(await isExecutableGone(executablePath, libraryFolders))) continue;

    let didClear = false;
    const updatedGame = await updateGameRecord(
      levelKeys.game(game.shop, game.objectId),
      (current) => {
        if (current.executablePath !== executablePath) return {};

        didClear = true;
        return {
          executablePath: null,
          executablePathUpdatedAt: null,
          installedSizeInBytes: null,
        };
      }
    );

    if (!didClear || !updatedGame) continue;

    logger.info(
      `[ClearMissingExecutables] Cleared missing executable for ${game.shop}:${game.objectId}: ${executablePath}`
    );
    clearedGames.push(updatedGame);
  }

  return clearedGames;
};
