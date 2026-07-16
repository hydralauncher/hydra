import fs from "node:fs";

import { registerEvent } from "../register-event";
import {
  db,
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

interface ManualAssetClear {
  updatedGame: Game | null;
  localPathToDelete: string | null;
}

const prepareManualCustomAssetClear = async (
  gameKey: string,
  type: ArtworkAssetType
): Promise<ManualAssetClear> => {
  const game = await gamesSublevel.get(gameKey);
  if (!game) return { updatedGame: null, localPathToDelete: null };

  const { url, original } = MANUAL_ASSET_FIELDS[type];
  const existing = game[url];

  if (existing == null && game[original] == null) {
    return { updatedGame: null, localPathToDelete: null };
  }

  const updatedGame = { ...game };
  updatedGame[url] = null;
  updatedGame[original] = null;

  return {
    updatedGame,
    localPathToDelete:
      typeof existing === "string" && existing.startsWith("local:")
        ? existing.slice("local:".length)
        : null,
  };
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

  const manualAssetClear = await prepareManualCustomAssetClear(gameKey, type);

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

  const batch = db.batch();
  if (manualAssetClear.updatedGame) {
    batch.put(gameKey, manualAssetClear.updatedGame, {
      sublevel: gamesSublevel,
    });
  }

  if (record) {
    batch.put(gameKey, record, { sublevel: gamesArtworkSelectionSublevel });
  } else {
    batch.del(gameKey, { sublevel: gamesArtworkSelectionSublevel });
  }

  await batch.write();

  if (manualAssetClear.localPathToDelete) {
    await fs.promises
      .unlink(manualAssetClear.localPathToDelete)
      .catch(() => {});
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");
  syncToCloud();

  return record;
};

registerEvent("setGameArtworkSelection", setGameArtworkSelection);
