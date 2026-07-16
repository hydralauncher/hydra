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
import type {
  ArtworkAssetType,
  Game,
  GameArtworkSelection,
  GameShop,
} from "@types";

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
  if (!game) return null;

  const { url, original } = MANUAL_ASSET_FIELDS[type];
  const existing = game[url];

  if (existing == null && game[original] == null) return null;

  const patch = { ...game };
  patch[url] = null;
  patch[original] = null;
  await gamesSublevel.put(gameKey, patch);

  return {
    previousGame: game,
    oldAssetPath:
      typeof existing === "string" && existing.startsWith("local:")
        ? existing.slice("local:".length)
        : null,
  };
};

const rollbackArtworkSelection = async (
  gameKey: string,
  previousGame: Game | null,
  previousSelection: GameArtworkSelection | null
) => {
  if (previousGame) {
    await gamesSublevel.put(gameKey, previousGame).catch(() => {});
  }

  if (previousSelection) {
    await gamesArtworkSelectionSublevel
      .put(gameKey, previousSelection)
      .catch(() => {});
  } else {
    await gamesArtworkSelectionSublevel.del(gameKey).catch(() => {});
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

  const clearedManualAsset = await clearManualCustomAsset(gameKey, type);

  const syncToCloud = () => {
    if (isClearing) {
      deleteCustomArtwork(shop, objectId, type).catch(() => {});
    } else if (url) {
      saveSteamGridDbArtwork(shop, objectId, type, url).catch(() => {});
    }
  };

  const record: GameArtworkSelection | null = Object.keys(selected).length
    ? {
        objectId,
        shop,
        selected,
        updatedAt: Date.now(),
      }
    : null;

  try {
    if (record) {
      await gamesArtworkSelectionSublevel.put(gameKey, record);
    } else {
      await gamesArtworkSelectionSublevel.del(gameKey);
    }
  } catch (error) {
    await rollbackArtworkSelection(
      gameKey,
      clearedManualAsset?.previousGame ?? null,
      existing ?? null
    );
    throw error;
  }

  if (clearedManualAsset?.oldAssetPath) {
    fs.promises.unlink(clearedManualAsset.oldAssetPath).catch(() => {});
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");
  syncToCloud();

  return record;
};

registerEvent("setGameArtworkSelection", setGameArtworkSelection);
