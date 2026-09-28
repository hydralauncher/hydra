import { findGameExecutableInFolder } from "@main/helpers/find-game-executable";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { gamesSublevel, levelKeys } from "@main/level";
import type { Game } from "@types";
import { runAutomaticCloudSaveSync } from "../cloud-save";
import { clearMissingExecutables } from "../clear-missing-executables";
import { updateGameRecord } from "../game-record-updater";
import { GameExecutables } from "../game-executables";
import { steamSyncLogger } from "../logger";
import {
  resolveSteamAppExecutable,
  type SteamAppInfo,
} from "./steam-app-info-core";
import { getSteamLibraryFolders } from "../steam";
import { getSteamAppInstallDirectories } from "./steam-installation";
import {
  findInstalledSteamApp,
  isStaleSteamLibraryExecutable,
} from "./steam-installation-core";
import { loadSteamAppInfo } from "./steam-launch-executables";

export type SteamExecutableLinkProgress = (
  processed: number,
  total: number
) => void;

const loadExecutableCatalogue = (forceRetry = true) =>
  GameExecutables.ensureLoaded(forceRetry).catch(() => false);

const findSteamGameExecutable = async (
  objectId: string,
  installDirectory: string,
  appInfos: Map<string, SteamAppInfo>,
  hasCatalogue: boolean
) => {
  const appInfo = appInfos.get(objectId);
  const launchExecutable = appInfo
    ? await resolveSteamAppExecutable(appInfo, installDirectory)
    : null;

  if (launchExecutable) {
    return { executablePath: launchExecutable, source: "appinfo" };
  }

  const catalogueExecutables = hasCatalogue
    ? GameExecutables.getExecutablesForGame(objectId)
    : null;
  if (!catalogueExecutables?.length) return null;

  const catalogueExecutable = await findGameExecutableInFolder(
    installDirectory,
    catalogueExecutables
  );

  return catalogueExecutable
    ? { executablePath: catalogueExecutable, source: "catalogue" }
    : null;
};

const linkExecutable = async (candidate: Game, executablePath: string) => {
  const gameKey = levelKeys.game(candidate.shop, candidate.objectId);
  let didLink = false;

  const updatedGame = await updateGameRecord(gameKey, (game) => {
    if (game.isDeleted || !game.hasActiveSteamImport || game.executablePath) {
      return {};
    }

    didLink = true;
    return updateGameExecutablePath(game, executablePath);
  });

  if (!didLink || !updatedGame) return false;

  void runAutomaticCloudSaveSync(
    candidate.objectId,
    candidate.shop,
    "environment-changed"
  ).catch((error) => {
    steamSyncLogger.error(
      `Failed to sync cloud saves after linking Steam executable ${candidate.objectId}`,
      error
    );
  });

  return true;
};

const isLinkCandidate = (game: Game | undefined): game is Game =>
  game?.shop === "steam" &&
  game.isDeleted !== true &&
  game.hasActiveSteamImport === true &&
  !game.executablePath;

const linkCandidate = async (
  game: Game,
  installDirectory: string,
  appInfos: Map<string, SteamAppInfo>,
  hasCatalogue: boolean
) => {
  const match = await findSteamGameExecutable(
    game.objectId,
    installDirectory,
    appInfos,
    hasCatalogue
  );

  if (!match || !(await linkExecutable(game, match.executablePath))) {
    return false;
  }

  steamSyncLogger.log(
    `Linked ${match.source} executable for imported Steam game ${game.objectId}: ${match.executablePath}`
  );
  return true;
};

export const linkSteamGameExecutable = async (
  steamAppId: string
): Promise<boolean> => {
  try {
    const game = await gamesSublevel.get(levelKeys.game("steam", steamAppId));
    if (!isLinkCandidate(game)) return false;

    const installedApp = await findInstalledSteamApp(
      steamAppId,
      await getSteamLibraryFolders().catch(() => [])
    );
    if (!installedApp) return false;

    const [appInfos, hasCatalogue] = await Promise.all([
      loadSteamAppInfo([steamAppId]),
      loadExecutableCatalogue(false),
    ]);

    return await linkCandidate(
      game,
      installedApp.installDirectory,
      appInfos,
      hasCatalogue
    );
  } catch (error) {
    steamSyncLogger.error(
      `Failed to auto-detect Steam executable for ${steamAppId}`,
      error
    );
    return false;
  }
};

const clearStaleSteamExecutable = async (steamAppId: string) => {
  const game = await gamesSublevel.get(levelKeys.game("steam", steamAppId));
  const executablePath = game?.executablePath;

  if (
    game?.isDeleted === true ||
    game?.hasActiveSteamImport !== true ||
    !executablePath ||
    !(await isStaleSteamLibraryExecutable(
      executablePath,
      await getSteamLibraryFolders().catch(() => [])
    ))
  ) {
    return false;
  }

  let didClear = false;

  await updateGameRecord(levelKeys.game("steam", steamAppId), (current) => {
    if (current.executablePath !== executablePath) return {};

    didClear = true;
    return {
      executablePath: null,
      executablePathUpdatedAt: null,
      installedSizeInBytes: null,
    };
  });

  if (didClear) {
    steamSyncLogger.log(
      `Cleared missing Steam executable for ${steamAppId}: ${executablePath}`
    );
  }

  return didClear;
};

export const refreshSteamGameExecutable = async (
  steamAppId: string
): Promise<boolean> => {
  try {
    const didClear = await clearStaleSteamExecutable(steamAppId);
    const didLink = await linkSteamGameExecutable(steamAppId);

    return didClear || didLink;
  } catch (error) {
    steamSyncLogger.error(
      `Failed to refresh Steam executable for ${steamAppId}`,
      error
    );
    return false;
  }
};

export const linkImportedSteamGameExecutables = async (
  onProgress?: SteamExecutableLinkProgress
): Promise<number> => {
  try {
    const importedGames = (await gamesSublevel.iterator().all())
      .map(([, game]) => game)
      .filter(
        (game) =>
          game.shop === "steam" &&
          game.isDeleted !== true &&
          game.hasActiveSteamImport === true
      );
    const clearedGames = await clearMissingExecutables(importedGames);
    const clearedObjectIds = new Set(clearedGames.map((game) => game.objectId));
    const candidates = [
      ...importedGames.filter((game) => !clearedObjectIds.has(game.objectId)),
      ...clearedGames,
    ].filter(isLinkCandidate);

    const installDirectories = await getSteamAppInstallDirectories(
      candidates.map((game) => game.objectId)
    );
    const installedCandidates = candidates.flatMap((game) => {
      const installDirectory = installDirectories.get(game.objectId);
      return installDirectory ? [{ game, installDirectory }] : [];
    });
    const total = installedCandidates.length;

    onProgress?.(0, total);
    if (total === 0) return 0;

    const [appInfos, hasCatalogue] = await Promise.all([
      loadSteamAppInfo(installedCandidates.map(({ game }) => game.objectId)),
      loadExecutableCatalogue(),
    ]);

    let linkedCount = 0;
    let processed = 0;

    for (const { game, installDirectory } of installedCandidates) {
      if (await linkCandidate(game, installDirectory, appInfos, hasCatalogue)) {
        linkedCount += 1;
      }

      processed += 1;
      onProgress?.(processed, total);
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
