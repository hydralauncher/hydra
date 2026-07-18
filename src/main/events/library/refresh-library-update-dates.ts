import { registerEvent } from "../register-event";
import { gamesSublevel, downloadSourcesSublevel } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { logger, WindowManager } from "@main/services";
import { levelKeys } from "@main/level/sublevels";
import type { GameRepack } from "@types";

const refreshLibraryUpdateDates = async (_event: any) => {
  logger.info("Starting refreshLibraryUpdateDates...");
  try {
    const installedGames = await gamesSublevel.values().all();
    const nonCustomGames = installedGames.filter((game) => game.shop !== "custom");

    if (nonCustomGames.length === 0) {
      return;
    }

    const downloadSources = await downloadSourcesSublevel.values().all();
    const downloadSourceIds = downloadSources.map((source) => source.id);

    if (downloadSourceIds.length === 0) {
      return;
    }

    const BATCH_SIZE = 5;
    let updatedCount = 0;

    for (let i = 0; i < nonCustomGames.length; i += BATCH_SIZE) {
      const batch = nonCustomGames.slice(i, i + BATCH_SIZE);
      
      const promises = batch.map(async (game) => {
        try {
          const downloads = await HydraApi.get<GameRepack[]>(
            `/games/${game.shop}/${game.objectId}/download-sources`,
            {
              take: 100,
              skip: 0,
              downloadSourceIds,
            },
            {
              needsAuth: false,
            }
          );

          if (downloads && downloads.length > 0) {
            // Sort to find the latest uploadDate
            const validDates = downloads
              .map((d) => (d.uploadDate ? new Date(d.uploadDate).getTime() : 0))
              .filter((time) => time > 0);

            if (validDates.length > 0) {
              const latestTime = Math.max(...validDates);
              const latestDateIso = new Date(latestTime).toISOString();

              if (game.latestUpdateDate !== latestDateIso) {
                await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
                  ...game,
                  latestUpdateDate: latestDateIso,
                });
                return true;
              }
            }
          }
        } catch (err) {
          logger.error(`Failed to fetch updates for ${game.title}`, err);
        }
        return false;
      });

      const results = await Promise.all(promises);
      updatedCount += results.filter(Boolean).length;
    }

    logger.info(`Finished refreshLibraryUpdateDates. Updated ${updatedCount} games.`);
    
    if (updatedCount > 0) {
      WindowManager.mainWindow?.webContents.send("on-library-batch-complete");
    }

  } catch (error) {
    logger.error("Error in refreshLibraryUpdateDates", error);
  }
};

registerEvent("refreshLibraryUpdateDates", refreshLibraryUpdateDates);
