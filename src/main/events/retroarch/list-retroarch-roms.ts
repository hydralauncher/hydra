import type { DetectedRom, RetroArchPlatform } from "@types";

import { registerEvent } from "../register-event";
import {
  gamesSublevel,
  gamesShopAssetsSublevel,
  gamesArtworkSelectionSublevel,
} from "@main/level";
import { platformToRetroArchPlatform } from "@main/helpers";
import { retroarch } from "@main/services";
import { composeAssetsWithArtwork } from "@shared";

import { isWithin } from "../emulators/rom-path-utils";

export interface RetroArchDetectedRom extends DetectedRom {
  platform: RetroArchPlatform;
}

const listRetroArchRoms = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<RetroArchDetectedRom[]> => {
  const config = await retroarch.getRetroArchConfig();
  const folders = config.romFolders.map((folder) => folder.path);
  if (folders.length === 0) return [];

  const entries = await gamesSublevel.iterator().all();

  const roms: RetroArchDetectedRom[] = [];
  for (const [key, game] of entries) {
    if (game.isDeleted) continue;
    if (game.shop !== "launchbox") continue;

    const platform = platformToRetroArchPlatform(game.platform);
    if (!platform) continue;

    const discs = game.discs ?? [];
    const inRomFolder = discs.some((disc) =>
      folders.some((folder) => isWithin(disc.path, folder))
    );
    if (!inRomFolder) continue;

    const assets = await gamesShopAssetsSublevel.get(key).catch(() => null);
    const artworkSelection = await gamesArtworkSelectionSublevel
      .get(key)
      .catch(() => null);
    const composedAssets = composeAssetsWithArtwork(
      assets ?? null,
      artworkSelection
    );

    roms.push({
      objectId: game.objectId,
      title: game.title,
      coverImageUrl: composedAssets?.coverImageUrl ?? null,
      libraryImageUrl: composedAssets?.libraryImageUrl ?? null,
      iconUrl: composedAssets?.iconUrl ?? game.iconUrl ?? null,
      customCoverImageUrl: game.customCoverImageUrl ?? null,
      customIconUrl: game.customIconUrl ?? null,
      sizeBytes: game.romSizeBytes ?? null,
      skus: [],
      platform,
    });
  }

  return roms.sort((a, b) => a.title.localeCompare(b.title));
};

registerEvent("listRetroArchRoms", listRetroArchRoms);
