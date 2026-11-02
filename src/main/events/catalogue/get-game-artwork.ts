import { registerEvent } from "../register-event";
import { fetchGameArtwork, logger } from "@main/services";
import { UserNotLoggedInError } from "@shared";
import type { ArtworkKind, ArtworkPage, GameShop } from "@types";

const getGameArtwork = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  kind: ArtworkKind,
  page = 0,
  /** Extra SteamGridDB filters (styles, types…); the API validates them. */
  parameters: Record<string, string> = {}
): Promise<ArtworkPage | null> => {
  if (shop === "custom") return null;

  try {
    return await fetchGameArtwork(shop, objectId, kind, page, parameters);
  } catch (error) {
    if (error instanceof UserNotLoggedInError) return null;

    logger.error("Failed to fetch game artwork", { shop, objectId, kind });
    throw error;
  }
};

registerEvent("getGameArtwork", getGameArtwork);
