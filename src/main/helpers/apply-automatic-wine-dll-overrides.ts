import { db, gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import { detectWineDllOverridesForGame } from "@main/events/library/detect-wine-dll-overrides";
import { buildWineDllOverridesValue, mergeLaunchOptionEnvVars } from "@shared";
import type { Game, UserPreferences } from "@types";

export const applyAutomaticWineDllOverrides = async (
  game: Game
): Promise<void> => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  if (!userPreferences?.autoDetectWineDllOverrides) return;

  try {
    const { dllNames, steamOverlayEnv } =
      await detectWineDllOverridesForGame(game);

    if (dllNames.length === 0) return;

    const merged = mergeLaunchOptionEnvVars(game.launchOptions ?? "", {
      WINEDLLOVERRIDES: buildWineDllOverridesValue(dllNames),
      ...steamOverlayEnv,
    });

    await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
      ...game,
      launchOptions: merged,
    });
  } catch (error) {
    logger.error(
      `[applyAutomaticWineDllOverrides] Failed for ${game.objectId}`,
      error
    );
  }
};
