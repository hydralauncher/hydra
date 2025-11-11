import { HydraApi } from "./hydra-api";
import {
  gamesSublevel,
  getDownloadSourcesCheckBaseline,
  updateDownloadSourcesCheckBaseline,
  updateDownloadSourcesSinceValue,
  downloadSourcesSublevel,
} from "@main/level";
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
  private static async clearStaleBadges(
    nonCustomGames: Game[]
  ): Promise<{ gameId: string; count: number }[]> {
    const previouslyFlaggedGames = nonCustomGames.filter(
      (game: Game) =>
        game.newDownloadOptionsCount && game.newDownloadOptionsCount > 0
    );

    const clearedPayload: { gameId: string; count: number }[] = [];
    if (previouslyFlaggedGames.length > 0) {
      logger.info(
        `Clearing stale newDownloadOptionsCount for ${previouslyFlaggedGames.length} games`
      );
      for (const game of previouslyFlaggedGames) {
        await gamesSublevel.put(`${game.shop}:${game.objectId}`, {
          ...game,
          newDownloadOptionsCount: undefined,
        });
        clearedPayload.push({
          gameId: `${game.shop}:${game.objectId}`,
          count: 0,
        });
      }
    }

    return clearedPayload;
  }

  private static async processApiResponse(
    response: unknown,
    nonCustomGames: Game[]
  ): Promise<{ gameId: string; count: number }[]> {
    if (!response || !Array.isArray(response)) {
      return [];
    }

    const gamesWithNewOptions: { gameId: string; count: number }[] = [];

    for (const gameUpdate of response as DownloadSourcesChangeResponse[]) {
      if (gameUpdate.newDownloadOptionsCount > 0) {
        const game = nonCustomGames.find(
          (g) =>
            g.shop === gameUpdate.shop && g.objectId === gameUpdate.objectId
        );

        if (game) {
          await gamesSublevel.put(`${game.shop}:${game.objectId}`, {
            ...game,
            newDownloadOptionsCount: gameUpdate.newDownloadOptionsCount,
          });

          gamesWithNewOptions.push({
            gameId: `${game.shop}:${game.objectId}`,
            count: gameUpdate.newDownloadOptionsCount,
          });
        }
      }
    }

    return gamesWithNewOptions;
  }

  private static sendNewDownloadOptionsEvent(
    clearedPayload: { gameId: string; count: number }[],
    gamesWithNewOptions: { gameId: string; count: number }[]
  ): void {
    const eventPayload = [...clearedPayload, ...gamesWithNewOptions];
    if (eventPayload.length > 0 && WindowManager.mainWindow) {
      WindowManager.mainWindow.webContents.send(
        "on-new-download-options",
        eventPayload
      );
    }

    logger.info(
      `Found new download options for ${gamesWithNewOptions.length} games`
    );
  }

  static async checkForChanges(): Promise<void> {
    logger.info("DownloadSourcesChecker.checkForChanges() called");

    try {
      // Get all installed games (excluding custom games)
      const installedGames = await gamesSublevel.values().all();
      const nonCustomGames = installedGames.filter(
        (game: Game) => game.shop !== "custom"
      );
      logger.info(
        `Found ${installedGames.length} total games, ${nonCustomGames.length} non-custom games`
      );

      if (nonCustomGames.length === 0) {
        logger.info(
          "No non-custom games found, skipping download sources check"
        );
        return;
      }

      const downloadSources = await downloadSourcesSublevel.values().all();
      const downloadSourceIds = downloadSources.map((source) => source.id);
      logger.info(
        `Found ${downloadSourceIds.length} download sources: ${downloadSourceIds.join(", ")}`
      );

      if (downloadSourceIds.length === 0) {
        logger.info(
          "No download sources found, skipping download sources check"
        );
        return;
      }

      const previousBaseline = await getDownloadSourcesCheckBaseline();
      const since =
        previousBaseline ||
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      logger.info(`Using since: ${since} (from last app start)`);

      const clearedPayload = await this.clearStaleBadges(nonCustomGames);

      const games = nonCustomGames.map((game: Game) => ({
        shop: game.shop,
        objectId: game.objectId,
      }));

      logger.info(
        `Checking download sources changes for ${games.length} non-custom games since ${since}`
      );
      logger.info(
        `Making API call to HydraApi.checkDownloadSourcesChanges with:`,
        {
          downloadSourceIds,
          gamesCount: games.length,
          since,
        }
      );

      const response = await HydraApi.checkDownloadSourcesChanges(
        downloadSourceIds,
        games,
        since
      );

      logger.info("API call completed, response:", response);

      await updateDownloadSourcesSinceValue(since);
      logger.info(`Saved 'since' value: ${since} (for modal comparison)`);

      const now = new Date().toISOString();
      await updateDownloadSourcesCheckBaseline(now);
      logger.info(
        `Updated baseline to: ${now} (will be 'since' on next app start)`
      );

      const gamesWithNewOptions = await this.processApiResponse(
        response,
        nonCustomGames
      );

      this.sendNewDownloadOptionsEvent(clearedPayload, gamesWithNewOptions);

      logger.info("Download sources check completed successfully");
    } catch (error) {
      logger.error("Failed to check download sources changes:", error);
    }
  }
}
