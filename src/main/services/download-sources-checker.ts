import { chunk } from "lodash-es";
import { updateGameRecord } from "@main/services/game-record-updater";
import { HydraApi } from "./hydra-api";
import {
  gamesSublevel,
  getDownloadSourcesCheckBaseline,
  updateDownloadSourcesCheckBaseline,
  updateDownloadSourcesSinceValue,
  downloadSourcesSublevel,
  db,
  levelKeys,
} from "@main/level";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import type { Game, UserPreferences } from "@types";

interface DownloadSourcesChangeResponse {
  shop: string;
  objectId: string;
  newDownloadOptionsCount: number;
  downloadSourceIds: string[];
}

const DOWNLOAD_SOURCES_CHANGES_API_MAX_GAMES = 1000;

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
        await updateGameRecord(`${game.shop}:${game.objectId}`, {
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
          await updateGameRecord(`${game.shop}:${game.objectId}`, {
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

  private static async requestChangesInChunks(
    downloadSourceIds: string[],
    gamesChunks: { shop: string; objectId: string }[][],
    since: string
  ): Promise<{
    responses: DownloadSourcesChangeResponse[];
    allChunksSucceeded: boolean;
  }> {
    const responses: DownloadSourcesChangeResponse[] = [];

    for (const [chunkIndex, gamesChunk] of gamesChunks.entries()) {
      try {
        const chunkResponse = await HydraApi.checkDownloadSourcesChanges(
          downloadSourceIds,
          gamesChunk,
          since
        );
        if (Array.isArray(chunkResponse)) responses.push(...chunkResponse);
      } catch (error) {
        logger.error(
          `Failed to check download sources changes for chunk ${chunkIndex + 1} of ${gamesChunks.length}, keeping the baseline:`,
          error
        );
        return { responses, allChunksSucceeded: false };
      }
    }

    return { responses, allChunksSucceeded: true };
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
      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      if (userPreferences?.enableNewDownloadOptionsBadges === false) {
        logger.info(
          "New download options badges are disabled, skipping download sources check"
        );
        return;
      }

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
      const gamesChunks = chunk(games, DOWNLOAD_SOURCES_CHANGES_API_MAX_GAMES);

      logger.info(
        `Making ${gamesChunks.length} sequential API calls to HydraApi.checkDownloadSourcesChanges with:`,
        {
          downloadSourceIds,
          gamesCount: games.length,
          chunksCount: gamesChunks.length,
          since,
        }
      );

      const { responses, allChunksSucceeded } =
        await this.requestChangesInChunks(
          downloadSourceIds,
          gamesChunks,
          since
        );

      logger.info("API calls completed, responses:", responses);

      await updateDownloadSourcesSinceValue(since);
      logger.info(`Saved 'since' value: ${since} (for modal comparison)`);

      if (allChunksSucceeded) {
        const now = new Date().toISOString();
        await updateDownloadSourcesCheckBaseline(now);
        logger.info(
          `Updated baseline to: ${now} (will be 'since' on next app start)`
        );
      }

      const gamesWithNewOptions = await this.processApiResponse(
        responses,
        nonCustomGames
      );

      this.sendNewDownloadOptionsEvent(clearedPayload, gamesWithNewOptions);

      logger.info(
        allChunksSucceeded
          ? "Download sources check completed successfully"
          : "Download sources check completed partially, will retry from the same baseline on next start"
      );
    } catch (error) {
      logger.error("Failed to check download sources changes:", error);
    }
  }
}
