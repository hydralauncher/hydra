import type { Game } from "@types";

import { achievementsLogger } from "../../logger";
import { sendGameLauncherStatus } from "../../game-launcher-status";
import { downloadAchievementIcons } from "./download-achievement-icons";
import { generateAchievementMetadata } from "./generate-achievement-metadata";

const GENERATION_TIMEOUT_IN_MS = 15_000;

const abortControllers = new Map<string, AbortController>();

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

  const finishExport = () => {
    if (abortControllers.get(gameKey) === abortController) {
      abortControllers.delete(gameKey);
      sendGameLauncherStatus(gameKey, "complete");
    }
  };

  const generationTimeout = setTimeout(() => {
    abortController.abort();
  }, GENERATION_TIMEOUT_IN_MS);

  try {
    sendGameLauncherStatus(gameKey, "generating_achievements");

    const result = await generateAchievementMetadata(
      game,
      abortController.signal
    ).finally(() => clearTimeout(generationTimeout));

    if (abortController.signal.aborted) {
      finishExport();
      return;
    }

    if (!result?.targets.length) {
      finishExport();
      return;
    }

    const totalIcons = result.targets.reduce(
      (total, { icons }) => total + icons.length,
      0
    );

    sendGameLauncherStatus(
      gameKey,
      "downloading_achievement_icons",
      `0/${totalIcons}`
    );

    downloadAchievementIcons({
      containmentRoot: result.containmentRoot,
      targets: result.targets,
      signal: abortController.signal,
      onProgress: (downloaded, total) =>
        sendGameLauncherStatus(
          gameKey,
          "downloading_achievement_icons",
          `${downloaded}/${total}`
        ),
    })
      .catch((error) => {
        achievementsLogger.error("Failed to download achievement icons", error);
      })
      .finally(finishExport);
  } catch (error) {
    clearTimeout(generationTimeout);

    if (!abortController.signal.aborted) {
      achievementsLogger.error(
        "Failed to export emulator achievement metadata",
        error
      );
    }

    finishExport();
  }
};
