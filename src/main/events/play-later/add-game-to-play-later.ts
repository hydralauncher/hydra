import { gamesSublevel, levelKeys, playLaterSublevel } from "@main/level";
import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { HydraApi } from "@main/services/hydra-api";
import { isInLibrary } from "@shared";
import type { PlayLaterEntry, ShopAssets } from "@types";
import { registerEvent } from "../register-event";

const addGameToPlayLater = async (
  _event: Electron.IpcMainInvokeEvent,
  assets: ShopAssets
): Promise<PlayLaterEntry | null> => {
  // Local read only: the library as this account sees it, like getLibrary.
  const authContext = HydraApi.getAuthContext();
  const games = await gamesSublevel.values().all();
  const library = games.map((game) => getContextualEpicGame(game, authContext));
  if (isInLibrary(assets, library)) return null;

  const entry: PlayLaterEntry = { ...assets, addedAt: Date.now() };
  await playLaterSublevel.put(
    levelKeys.game(assets.shop, assets.objectId),
    entry
  );

  return entry;
};

registerEvent("addGameToPlayLater", addGameToPlayLater);
