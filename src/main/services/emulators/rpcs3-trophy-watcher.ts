import { promises as fs } from "node:fs";

import {
  startEmulatorTrophyWatcher,
  type EmulatorTrophyWatcher,
} from "./emulator-trophy-watcher";
import {
  resolveRpcs3TrophySources,
  type Rpcs3TrophySources,
} from "./rpcs3-trophy-sources";
import {
  listRpcs3TropUsrFiles,
  readRpcs3UnlockedTrophies,
} from "./rpcs3-trophies";

interface StartRpcs3TrophyWatcherOptions {
  gameKey: string;
  discPath: string;
}

export const startRpcs3TrophyWatcher = ({
  gameKey,
  discPath,
}: StartRpcs3TrophyWatcherOptions): EmulatorTrophyWatcher => {
  let sources: Rpcs3TrophySources | null = null;

  return startEmulatorTrophyWatcher({
    gameKey,
    emulatorName: "RPCS3",
    snapshot: async (game) => {
      sources ??= await resolveRpcs3TrophySources(game, discPath);
      if (!sources) return null;

      const files = await listRpcs3TropUsrFiles(
        sources.homeRoots,
        sources.npCommIds
      );
      if (!files.length) return null;

      const stats = await Promise.all(
        files.map((file) => fs.stat(file).catch(() => null))
      );
      const version = files
        .map((file, index) => {
          const fileStats = stats[index];
          return `${file}:${fileStats?.mtimeMs ?? 0}:${fileStats?.size ?? 0}`;
        })
        .join("|");

      return { version, read: () => readRpcs3UnlockedTrophies(files) };
    },
  });
};
