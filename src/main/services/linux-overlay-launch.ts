import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { levelKeys } from "@main/level";
import { resolveHydraOverlayPreferences } from "@shared";
import type { Game, UserPreferences } from "@types";

const metricsDirectories = new Map<string, string>();

const gameKey = (game: Pick<Game, "shop" | "objectId">) =>
  levelKeys.game(game.shop, game.objectId);

export const prepareLinuxOverlayLaunch = (
  game: Game | undefined,
  preferences: UserPreferences | null,
  mangohudAvailable: boolean,
  mangohudRequestedByUser: boolean
) => {
  if (process.platform === "linux" && game) {
    metricsDirectories.delete(gameKey(game));
  }

  if (process.platform !== "linux" || !game || !mangohudAvailable) {
    return {
      useMangohud: mangohudRequestedByUser && mangohudAvailable,
      environment: {} as Record<string, string>,
    };
  }

  const overlayPreferences = resolveHydraOverlayPreferences(preferences);
  if (
    !overlayPreferences.overlayEnabled ||
    !overlayPreferences.overlayPerformanceEnabled
  ) {
    return {
      useMangohud: mangohudRequestedByUser,
      environment: {} as Record<string, string>,
    };
  }

  const metricsDirectory = path.join(
    app.getPath("userData"),
    "overlay-metrics",
    `${game.shop}-${game.objectId}-${Date.now()}`
  );
  fs.mkdirSync(metricsDirectory, { recursive: true });
  metricsDirectories.set(gameKey(game), metricsDirectory);

  const options = [
    "read_cfg",
    ...(!mangohudRequestedByUser ? ["no_display"] : []),
    "autostart_log=1",
    "log_interval=100",
    `output_folder=${metricsDirectory}`,
    "permit_upload=0",
  ];

  return {
    useMangohud: true,
    environment: { MANGOHUD_CONFIG: options.join(",") },
  };
};

export const getLinuxOverlayMetricsDirectory = (
  game: Pick<Game, "shop" | "objectId">
) => metricsDirectories.get(gameKey(game)) ?? null;
