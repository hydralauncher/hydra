import { gamesSublevel, levelKeys, playLaterSublevel } from "@main/level";
import type { PlayLaterEntry, ShopAssets } from "@types";
import { registerEvent } from "../register-event";

const addGameToPlayLater = async (
  _event: Electron.IpcMainInvokeEvent,
  assets: ShopAssets
): Promise<PlayLaterEntry | null> => {
  const key = levelKeys.game(assets.shop, assets.objectId);

  const libraryGame = await gamesSublevel.get(key);
  if (libraryGame && !libraryGame.isDeleted) return null;

  const entry: PlayLaterEntry = { ...assets, addedAt: Date.now() };
  await playLaterSublevel.put(key, entry);

  return entry;
};

registerEvent("addGameToPlayLater", addGameToPlayLater);
