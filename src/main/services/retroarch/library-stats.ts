import { isWithin } from "../../events/emulators/rom-path-utils";
import { platformToRetroArchPlatform } from "../../../shared/retroarch-platform";
import type { Game, RetroArchPlatform, RomFolder } from "@types";

import { RETROARCH_PLATFORMS } from "./retroarch-cores";

export interface RetroArchFolderRollup {
  fileCount: number;
  sizeBytes: number;
}

export interface RetroArchLibraryStats {
  counts: Record<RetroArchPlatform, number>;
  rollups: Map<string, RetroArchFolderRollup>;
}

const emptyCounts = (): Record<RetroArchPlatform, number> =>
  Object.fromEntries(
    RETROARCH_PLATFORMS.map((platform) => [platform, 0])
  ) as Record<RetroArchPlatform, number>;

export const buildRetroArchLibraryStats = (
  folders: RomFolder[],
  games: Game[]
): RetroArchLibraryStats => {
  const counts = emptyCounts();
  const rollups = new Map<string, RetroArchFolderRollup>(
    folders.map((folder) => [folder.path, { fileCount: 0, sizeBytes: 0 }])
  );

  if (folders.length === 0) return { counts, rollups };

  for (const game of games) {
    if (game.isDeleted) continue;
    if (game.shop !== "launchbox") continue;

    const platform = platformToRetroArchPlatform(game.platform);
    if (!platform) continue;

    const discs = game.discs ?? [];
    const folder = folders.find((candidate) =>
      discs.some((disc) => isWithin(disc.path, candidate.path))
    );
    if (!folder) continue;

    counts[platform] += 1;

    const rollup = rollups.get(folder.path);
    if (rollup) {
      rollup.fileCount += 1;
      rollup.sizeBytes += game.romSizeBytes ?? 0;
    }
  }

  return { counts, rollups };
};
