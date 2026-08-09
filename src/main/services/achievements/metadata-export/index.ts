import type { Game } from "@types";

import { achievementsLogger } from "../../logger";
import { sendGameLauncherStatus } from "../../game-launcher-status";
import { downloadAchievementIcons } from "./download-achievement-icons";
import { generateAchievementMetadata } from "./generate-achievement-metadata";

const GENERATION_TIMEOUT_IN_MS = 15_000;

const abortControllers = new Map<string, AbortController>();

const withTimeout = <T>(promise: Promise<T>, timeoutInMs: number) =>
  Promise.race([
    promise,
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutInMs)
    ),
  ]);

export const abortAchievementMetadataExport = (gameKey: string) => {
  const abortController = abortControllers.get(gameKey);

  if (!abortController) return;

  abortControllers.delete(gameKey);
  abortController.abort();

  achievementsLogger.log(
    `Stopped the achievement metadata export of ${gameKey}, the game was closed`
  );
};

export const runAchievementMetadataExport = async (
  gameKey: string,
  game: Game
) => {
  abortAchievementMetadataExport(gameKey);

  const abortController = new AbortController();
  abortControllers.set(gameKey, abortController);

  try {
    sendGameLauncherStatus("generating_achievements");

    const result = await withTimeout(
      generateAchievementMetadata(game),
      GENERATION_TIMEOUT_IN_MS
    );

    if (abortController.signal.aborted) return;

    if (!result?.icons.length || !result.steamSettingsDirectories.length) {
      abortControllers.delete(gameKey);
      sendGameLauncherStatus("complete");
      return;
    }

    sendGameLauncherStatus(
      "downloading_achievement_icons",
      `0/${result.icons.length}`
    );

    downloadAchievementIcons({
      steamSettingsDirectories: result.steamSettingsDirectories,
      icons: result.icons,
      signal: abortController.signal,
      onProgress: (downloaded, total) =>
        sendGameLauncherStatus(
          "downloading_achievement_icons",
          `${downloaded}/${total}`
        ),
    })
      .catch((error) => {
        achievementsLogger.error("Failed to download achievement icons", error);
      })
      .finally(() => {
        abortControllers.delete(gameKey);
        sendGameLauncherStatus("complete");
      });
  } catch (error) {
    abortControllers.delete(gameKey);

    achievementsLogger.error(
      "Failed to export emulator achievement metadata",
      error
    );

    sendGameLauncherStatus("complete");
  }
};
