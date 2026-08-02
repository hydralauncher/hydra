import path from "node:path";
import fs from "node:fs";
import { registerEvent } from "../register-event";
import { CrossOver, logger } from "@main/services";
import type { CrossOverBottle } from "@main/services/crossover";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import type { GameShop, UserPreferences } from "@types";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";

/**
 * Get CrossOver installation info and available bottles
 */
const getCrossoverInfo = async (): Promise<{
  installed: boolean;
  version: string | null;
  appPath: string;
  bottlesDirectory: string;
  bottles: CrossOverBottle[];
}> => {
  return CrossOver.detect();
};

/**
 * List all CrossOver bottles
 */
const getCrossoverBottles = async (): Promise<CrossOverBottle[]> => {
  return CrossOver.listBottles();
};

/**
 * Create a new CrossOver bottle
 */
const createCrossoverBottle = async (
  _event: Electron.IpcMainInvokeEvent,
  name: string
): Promise<CrossOverBottle | null> => {
  return CrossOver.createBottle(name);
};

/**
 * Get or create the default Hydra bottle
 */
const getDefaultCrossoverBottle = async (): Promise<CrossOverBottle> => {
  return CrossOver.getDefaultBottle();
};

/**
 * Launch a Windows executable in a CrossOver bottle
 */
const launchInCrossoverBottle = async (
  _event: Electron.IpcMainInvokeEvent,
  bottleName: string,
  executablePath: string,
  args?: string[]
): Promise<boolean> => {
  try {
    await CrossOver.launchInBottle(bottleName, executablePath, args);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Run a Windows installer in a CrossOver bottle
 */
const installInCrossoverBottle = async (
  _event: Electron.IpcMainInvokeEvent,
  bottleName: string,
  installerPath: string,
  args?: string[]
): Promise<boolean> => {
  try {
    await CrossOver.installInBottle(bottleName, installerPath, args);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Copy game files into a CrossOver bottle's Program Files directory
 */
const copyGameToCrossoverBottle = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const gameKey = levelKeys.game(shop, objectId);
  const [download, game] = await Promise.all([
    downloadsSublevel.get(gameKey),
    gamesSublevel.get(gameKey),
  ]);

  if (!download?.folderName || !game) return null;

  const sourcePath = path.join(
    download.downloadPath ?? (await getDownloadsPath()),
    download.folderName
  );

  const bottleName = game.crossoverBottle ?? CrossOver.getDefaultBottle().name;
  const destinationPath = CrossOver.copyGameToBottle(bottleName, sourcePath, game.title);

  // Clean up original download folder after copying to bottle
  try {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    const shouldDelete =
      download?.automaticallyDeleteArchiveFiles ??
      userPreferences?.deleteArchiveFilesAfterExtractionByDefault ??
      false;

    if (shouldDelete && fs.existsSync(sourcePath)) {
      await fs.promises.rm(sourcePath, { recursive: true, force: true });
      logger.info(`Cleaned up original download folder after copying to CrossOver bottle: ${sourcePath}`);

      // Clear installer size since the original files are gone
      if (game) {
        await gamesSublevel.put(gameKey, {
          ...game,
          installerSizeInBytes: null,
        });
      }
    }
  } catch (error) {
    logger.error("Failed to clean up original download folder after bottle copy", error);
  }

  return destinationPath;
};

registerEvent("getCrossoverInfo", getCrossoverInfo);
registerEvent("getCrossoverBottles", getCrossoverBottles);
registerEvent("createCrossoverBottle", createCrossoverBottle);
registerEvent("getDefaultCrossoverBottle", getDefaultCrossoverBottle);
registerEvent("launchInCrossoverBottle", launchInCrossoverBottle);
registerEvent("installInCrossoverBottle", installInCrossoverBottle);
registerEvent("copyGameToCrossoverBottle", copyGameToCrossoverBottle);
