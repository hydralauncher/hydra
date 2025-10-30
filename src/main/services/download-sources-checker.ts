import { HydraApi } from "./hydra-api";
import { gamesSublevel, getLastDownloadSourcesCheck, updateLastDownloadSourcesCheck, downloadSourcesSublevel } from "@main/level";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import type { Game } from "@types";

interface DownloadSourcesChangeResponse {
  shop: string;
  objectId: string;
  newDownloadOptionsCount: number;
  downloadSourceIds: string[];
}

export class DownloadSourcesChecker {
  static async checkForChanges(): Promise<void> {
    logger.info("DownloadSourcesChecker.checkForChanges() called");
    
    try {
      // Get all installed games (excluding custom games)
      const installedGames = await gamesSublevel.values().all();
      const nonCustomGames = installedGames.filter((game: Game) => game.shop !== 'custom');
      logger.info(`Found ${installedGames.length} total games, ${nonCustomGames.length} non-custom games`);
      
      if (nonCustomGames.length === 0) {
        logger.info("No non-custom games found, skipping download sources check");
        return;
      }

      // Get download sources
      const downloadSources = await downloadSourcesSublevel.values().all();
      const downloadSourceIds = downloadSources.map(source => source.id);
      logger.info(`Found ${downloadSourceIds.length} download sources: ${downloadSourceIds.join(', ')}`);

      if (downloadSourceIds.length === 0) {
        logger.info("No download sources found, skipping download sources check");
        return;
      }

      // Get last check timestamp or use a default (24 hours ago)
      const lastCheck = await getLastDownloadSourcesCheck();
      const since = lastCheck || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      logger.info(`Last check: ${lastCheck}, using since: ${since}`);

      // Clear any previously stored new download option counts so badges don't persist across restarts
      const previouslyFlaggedGames = nonCustomGames.filter(
        (game: Game) => (game as Game).newDownloadOptionsCount && (game as Game).newDownloadOptionsCount! > 0
      );

      const clearedPayload: { gameId: string; count: number }[] = [];
      if (previouslyFlaggedGames.length > 0) {
        logger.info(`Clearing stale newDownloadOptionsCount for ${previouslyFlaggedGames.length} games`);
        for (const game of previouslyFlaggedGames) {
          await gamesSublevel.put(`${game.shop}:${game.objectId}`, {
            ...game,
            newDownloadOptionsCount: undefined,
          });
          clearedPayload.push({ gameId: `${game.shop}:${game.objectId}`, count: 0 });
        }
      }

      // Prepare games array for API call (excluding custom games)
      const games = nonCustomGames.map((game: Game) => ({
        shop: game.shop,
        objectId: game.objectId
      }));

      logger.info(`Checking download sources changes for ${games.length} non-custom games since ${since}`);
      logger.info(`Making API call to HydraApi.checkDownloadSourcesChanges with:`, {
        downloadSourceIds,
        gamesCount: games.length,
        since
      });

      // Call the API
      const response = await HydraApi.checkDownloadSourcesChanges(
        downloadSourceIds,
        games,
        since
      );
      
      logger.info("API call completed, response:", response);

      // Update the last check timestamp
      await updateLastDownloadSourcesCheck(new Date().toISOString());

      // Process the response and store newDownloadOptionsCount for games with new options
      if (response && Array.isArray(response)) {
        const gamesWithNewOptions: { gameId: string; count: number }[] = [];
        
        for (const gameUpdate of response as DownloadSourcesChangeResponse[]) {
          if (gameUpdate.newDownloadOptionsCount > 0) {
            const game = nonCustomGames.find(g => 
              g.shop === gameUpdate.shop && g.objectId === gameUpdate.objectId
            );
            
            if (game) {
              // Store the new download options count in the game data
              await gamesSublevel.put(`${game.shop}:${game.objectId}`, {
                ...game,
                newDownloadOptionsCount: gameUpdate.newDownloadOptionsCount
              });
              
              gamesWithNewOptions.push({
                gameId: `${game.shop}:${game.objectId}`,
                count: gameUpdate.newDownloadOptionsCount
              });
              
              logger.info(`Game ${game.title} has ${gameUpdate.newDownloadOptionsCount} new download options`);
            }
          }
        }
        
        // Send IPC event to renderer to clear stale badges and set fresh counts from response
        const eventPayload = [...clearedPayload, ...gamesWithNewOptions];
        if (eventPayload.length > 0 && WindowManager.mainWindow) {
          WindowManager.mainWindow.webContents.send("on-new-download-options", eventPayload);
        }
        
        logger.info(`Found new download options for ${gamesWithNewOptions.length} games`);
      }

      logger.info("Download sources check completed successfully");
    } catch (error) {
      logger.error("Failed to check download sources changes:", error);
    }
  }
}