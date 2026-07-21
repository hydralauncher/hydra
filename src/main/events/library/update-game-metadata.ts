import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "@main/services";
import type { GameShop, Game } from "@types";

interface UpdateGameMetadataParams {
  shop: GameShop;
  objectId: string;
  userDescription?: string | null;
  userReleaseDate?: Date | null;
  userDeveloper?: string | null;
  userPublisher?: string | null;
  userRating?: number | null;
  userScreenshots?: string[] | null;
  userTitle?: string | null;
  hasManuallyUpdatedMetadata?: boolean;
}

const updateGameMetadata = async (
  _event: Electron.IpcMainInvokeEvent,
  params: UpdateGameMetadataParams
): Promise<Game | null> => {
  const {
    shop,
    objectId,
    userDescription,
    userReleaseDate,
    userDeveloper,
    userPublisher,
    userRating,
    userScreenshots,
    userTitle,
    hasManuallyUpdatedMetadata,
  } = params;

  const gameKey = levelKeys.game(shop, objectId);

  const existingGame = await gamesSublevel.get(gameKey);
  if (!existingGame) {
    throw new Error("Game not found");
  }

  const updatedGame = {
    ...existingGame,
    ...(userDescription !== undefined && { userDescription }),
    ...(userReleaseDate !== undefined && { userReleaseDate }),
    ...(userDeveloper !== undefined && { userDeveloper }),
    ...(userPublisher !== undefined && { userPublisher }),
    ...(userRating !== undefined && { userRating }),
    ...(userScreenshots !== undefined && { userScreenshots }),
    ...(userTitle !== undefined && { userTitle }),
    ...(hasManuallyUpdatedMetadata !== undefined && { hasManuallyUpdatedMetadata: true }),
  };

  await gamesSublevel.put(gameKey, updatedGame);
  WindowManager.sendToAppWindows("on-library-batch-complete");

  return updatedGame;
};

registerEvent("updateGameMetadata", updateGameMetadata);