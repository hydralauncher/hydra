import { gamesSublevel } from "@main/level";
import type { RetroArchConfig } from "@types";

import { buildRetroArchLibraryStats } from "./library-stats";
import {
  getRetroArchConfig,
  recomputeRetroArchTotals,
  updateRetroArchConfig,
} from "./retroarch-repository";

export const refreshRetroArchLibraryStats =
  async (): Promise<RetroArchConfig> => {
    const config = await getRetroArchConfig();
    if (config.romFolders.length === 0) return config;

    const entries = await gamesSublevel.iterator().all();
    const { counts, rollups } = buildRetroArchLibraryStats(
      config.romFolders,
      entries.map(([, game]) => game)
    );

    return updateRetroArchConfig((current) =>
      recomputeRetroArchTotals({
        ...current,
        perPlatformCounts: counts,
        romFolders: current.romFolders.map((folder) => {
          const rollup = rollups.get(folder.path);
          if (!rollup) return folder;
          return {
            ...folder,
            fileCount: rollup.fileCount,
            sizeBytes: rollup.sizeBytes,
          };
        }),
      })
    );
  };
