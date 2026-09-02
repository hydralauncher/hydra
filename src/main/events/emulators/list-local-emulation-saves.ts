import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type { EmulationSavePlatform, MemoryCardSaveRecord } from "@types";
import {
  buildLocalLaunchboxAssetIndex,
  findUniqueLocalAssetBySkuPrefix,
} from "./memcard-local-assets";

const listLocalEmulationSaves = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform
): Promise<MemoryCardSaveRecord[]> => {
  if (platform !== "psp" && platform !== "gamecube" && platform !== "wii") {
    return [];
  }

  try {
    return await discoverAndMapFileSaves(platform);
  } catch (error) {
    logger.error("Could not discover local emulator saves", {
      platform,
      error,
    });
    return [];
  }
};

const discoverAndMapFileSaves = async (
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube" | "wii">
): Promise<MemoryCardSaveRecord[]> => {
  const config = await emulators.getEmulatorConfig(
    emulators.emulationSavePlatformToSystem(platform)
  );
  if (!config.executablePath) return [];

  const discovered = await emulators.discoverEmulationFileSaves(
    platform,
    config.executablePath
  );
  const localAssets = await buildLocalLaunchboxAssetIndex();
  const findLocalAsset = (sku: string) => {
    const normalizedSku = emulators.normalizeSku(sku);
    const exact = localAssets.get(normalizedSku);
    if (exact || platform !== "wii") {
      return { assets: exact, sku: normalizedSku };
    }

    const candidate = findUniqueLocalAssetBySkuPrefix(
      localAssets,
      normalizedSku,
      6
    );
    if (candidate) {
      return candidate;
    }
    return { assets: undefined, sku: normalizedSku };
  };
  const unresolvedSkus = Array.from(
    new Set(
      discovered
        .filter((save) => !findLocalAsset(save.sku).assets)
        .map((save) => save.sku)
    )
  );
  const remoteAssets = await emulators.fetchShopDetailsForSkus(unresolvedSkus);

  return discovered.map((save) => {
    const normalizedSku = emulators.normalizeSku(save.sku);
    const remoteEntry = remoteAssets.get(normalizedSku);
    const local = findLocalAsset(save.sku);
    const assets =
      local.assets ??
      (remoteEntry ? emulators.mapEntryToAssets(remoteEntry) : null);
    return {
      cardFilePath: save.sourcePath,
      cardLabel: save.sourceLabel,
      folderName: save.saveIdentity,
      sku: local.assets ? local.sku : save.sku,
      objectId: assets?.objectId ?? null,
      shop: assets ? "launchbox" : null,
      title: assets?.title ?? null,
      iconUrl: assets?.iconUrl ?? null,
      libraryImageUrl: assets?.libraryImageUrl ?? null,
      libraryHeroImageUrl: assets?.libraryHeroImageUrl ?? null,
      logoImageUrl: assets?.logoImageUrl ?? null,
      fileCount: save.fileCount,
      sizeBytes: save.sizeBytes,
      createdAt: save.createdAt,
      modifiedAt: save.modifiedAt,
      detectedAt: Date.now(),
    };
  });
};

registerEvent("listLocalEmulationSaves", listLocalEmulationSaves);
