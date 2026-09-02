import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type { EmulationSavePlatform, MemoryCardSaveRecord } from "@types";
import { buildLocalLaunchboxAssetIndex } from "./memcard-local-assets";

const listLocalEmulationSaves = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform
): Promise<MemoryCardSaveRecord[]> => {
  if (platform !== "psp" && platform !== "gamecube") return [];

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
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube">
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
  const unresolvedSkus = Array.from(
    new Set(
      discovered
        .filter((save) => !localAssets.has(emulators.normalizeSku(save.sku)))
        .map((save) => save.sku)
    )
  );
  const remoteAssets = await emulators.fetchShopDetailsForSkus(unresolvedSkus);

  return discovered.map((save) => {
    const normalizedSku = emulators.normalizeSku(save.sku);
    const remoteEntry = remoteAssets.get(normalizedSku);
    const assets =
      localAssets.get(normalizedSku) ??
      (remoteEntry ? emulators.mapEntryToAssets(remoteEntry) : null);
    return {
      cardFilePath: save.sourcePath,
      cardLabel: save.sourceLabel,
      folderName: save.saveIdentity,
      sku: save.sku,
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
