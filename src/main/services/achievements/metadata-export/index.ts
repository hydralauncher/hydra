import type { Game } from "@types";

import { achievementsLogger } from "../../logger";
import { sendGameLauncherStatus } from "../../game-launcher-status";
import { downloadAchievementIcons } from "./download-achievement-icons";
import { generateAchievementMetadata } from "./generate-achievement-metadata";

const GENERATION_TIMEOUT_IN_MS = 15_000;
const ICONS_TIMEOUT_IN_MS = 5 * 60_000;

const withTimeout = <T>(promise: Promise<T>, timeoutInMs: number) =>
  Promise.race([
    promise,
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutInMs)
    ),
  ]);

/**
 * Runs during game launch: writes the emulator achievement metadata file when
 * it is missing, then downloads its icons in the background. Never rejects, and
 * never holds the launch for longer than the generation timeout.
 */
export const runAchievementMetadataExport = async (game: Game) => {
  try {
    sendGameLauncherStatus("generating_achievements");

    const result = await withTimeout(
      generateAchievementMetadata(game),
      GENERATION_TIMEOUT_IN_MS
    );

    if (!result?.icons.length) {
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
      signal: AbortSignal.timeout(ICONS_TIMEOUT_IN_MS),
      onProgress: (downloaded, total) =>
        sendGameLauncherStatus(
          "downloading_achievement_icons",
          `${downloaded}/${total}`
        ),
    })
      .then(() => sendGameLauncherStatus("complete"))
      .catch((error) => {
        achievementsLogger.error("Failed to download achievement icons", error);
        sendGameLauncherStatus("complete");
      });
  } catch (error) {
    achievementsLogger.error(
      "Failed to export emulator achievement metadata",
      error
    );
    sendGameLauncherStatus("complete");
  }
};
