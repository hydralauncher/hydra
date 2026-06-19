import type { DetectedRom, EmulatorSystem } from "@types";

import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel } from "@main/level";
import { platformToSystem } from "@main/helpers";
import { emulators } from "@main/services";

import { isWithin } from "./rom-path-utils";

const listEmulatorRoms = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
): Promise<DetectedRom[]> => {
  const config = await emulators.getEmulatorConfig(system);
  const folders = config.romFolders.map((folder) => folder.path);
  if (folders.length === 0) return [];

  const entries = await gamesSublevel.iterator().all();

  const roms: DetectedRom[] = [];
  for (const [key, game] of entries) {
    if (game.isDeleted) continue;
    if (game.shop !== "launchbox") continue;
    if (platformToSystem(game.platform) !== system) continue;

    const discs = game.discs ?? [];
    const inRomFolder = discs.some((disc) =>
      folders.some((folder) => isWithin(disc.path, folder))
    );
    if (!inRomFolder) continue;

    const assets = await gamesShopAssetsSublevel.get(key).catch(() => null);
    const skus = discs
      .map((disc) => disc.sku ?? "")
      .filter((sku) => sku.length > 0);

    roms.push({
      objectId: game.objectId,
      title: game.title,
      libraryImageUrl: assets?.libraryImageUrl ?? null,
      iconUrl: assets?.iconUrl ?? game.iconUrl ?? null,
      sizeBytes: game.romSizeBytes ?? null,
      skus,
    });
  }

  return roms.sort((a, b) => a.title.localeCompare(b.title));
};

registerEvent("listEmulatorRoms", listEmulatorRoms);
