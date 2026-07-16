import fs from "node:fs";

import { registerEvent } from "../register-event";
import {
  gamesArtworkSelectionSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import {
  WindowManager,
  saveSteamGridDbArtwork,
  deleteCustomArtwork,
} from "@main/services";
import type { ArtworkAssetType, GameArtworkSelection, GameShop } from "@types";

interface SetArtworkSelectionParams {
  shop: GameShop;
  objectId: string;
  type: ArtworkAssetType;
  url?: string;
  artworkId?: number;
  clear?: boolean;
}

type ManualUrlField =
  | "customIconUrl"
  | "customLogoImageUrl"
  | "customHeroImageUrl"
  | "customCoverImageUrl";

type ManualOriginalField =
  | "customOriginalIconPath"
  | "customOriginalLogoPath"
  | "customOriginalHeroPath"
  | "customOriginalCoverPath";

const MANUAL_ASSET_FIELDS: Record<
  ArtworkAssetType,
  { url: ManualUrlField; original: ManualOriginalField }
> = {
  icon: { url: "customIconUrl", original: "customOriginalIconPath" },
  logo: { url: "customLogoImageUrl", original: "customOriginalLogoPath" },
  hero: { url: "customHeroImageUrl", original: "customOriginalHeroPath" },
  grid: { url: "customCoverImageUrl", original: "customOriginalCoverPath" },
};

const clearManualCustomAsset = async (
  gameKey: string,
  type: ArtworkAssetType
) => {
  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  const { url, original } = MANUAL_ASSET_FIELDS[type];
  const existing = game[url];

  if (existing == null && game[original] == null) return;

  const patch = { ...game };
  patch[url] = null;
  patch[original] = null;
  await gamesSublevel.put(gameKey, patch);

  if (typeof existing === "string" && existing.startsWith("local:")) {
    fs.promises.unlink(existing.slice("local:".length)).catch(() => {});
  }
};

const setGameArtworkSelection = async (
  _event: Electron.IpcMainInvokeEvent,
  params: SetArtworkSelectionParams
): Promise<GameArtworkSelection | null> => {
  const { shop, objectId, type, url, artworkId, clear } = params;
  const gameKey = levelKeys.game(shop, objectId);
  const isClearing = clear || !url || artworkId == null;

  const existing = await gamesArtworkSelectionSublevel.get(gameKey);
  const selected: GameArtworkSelection["selected"] = { ...existing?.selected };

  if (isClearing) {
    delete selected[type];
  } else {
    selected[type] = { url, artworkId };
  }

  await clearManualCustomAsset(gameKey, type);

  const syncToCloud = () => {
    if (isClearing) {
      deleteCustomArtwork(shop, objectId, type).catch(() => {});
    } else if (url) {
      saveSteamGridDbArtwork(shop, objectId, type, url).catch(() => {});
    }
  };

  if (!Object.keys(selected).length) {
    await gamesArtworkSelectionSublevel.del(gameKey);
    WindowManager.sendToAppWindows("on-library-batch-complete");
    syncToCloud();
    return null;
  }

  const record: GameArtworkSelection = {
    objectId,
    shop,
    selected,
    updatedAt: Date.now(),
  };

  await gamesArtworkSelectionSublevel.put(gameKey, record);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  syncToCloud();

  return record;
};

registerEvent("setGameArtworkSelection", setGameArtworkSelection);
