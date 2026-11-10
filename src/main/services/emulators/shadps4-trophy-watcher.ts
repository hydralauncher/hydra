import { promises as fs } from "node:fs";

import type { Game } from "@types";
import { platformToSystem } from "@shared";

import { getEmulatorConfig } from "./emulators-repository";
import {
  startEmulatorTrophyWatcher,
  type EmulatorTrophyWatcher,
} from "./emulator-trophy-watcher";
import {
  parseUnlockedTrophies,
  resolveShadps4TrophyFile,
} from "./shadps4-trophies";

interface StartShadps4TrophyWatcherOptions {
  gameKey: string;
  executablePath: string;
  discPath: string;
}

export const startShadps4TrophyWatcher = ({
  gameKey,
  executablePath,
  discPath,
}: StartShadps4TrophyWatcherOptions): EmulatorTrophyWatcher => {
  let trophyFile: string | null = null;

  return startEmulatorTrophyWatcher({
    gameKey,
    emulatorName: "shadPS4",
    snapshot: async () => {
      trophyFile ??= await resolveShadps4TrophyFile(executablePath, discPath);
      if (!trophyFile) return null;

      const file = trophyFile;
      const stats = await fs.stat(file).catch(() => null);
      if (!stats) return null;

      return {
        version: String(stats.mtimeMs),
        read: async () => {
          const contents = await fs.readFile(file, "utf8").catch(() => null);
          return contents ? parseUnlockedTrophies(contents) : null;
        },
      };
    },
  });
};

export const removeShadps4TrophyFile = async (game: Game): Promise<void> => {
  if (platformToSystem(game.platform) !== "ps4") return;

  const discPath = game.selectedDiscPath ?? game.discs?.[0]?.path;
  const { executablePath } = await getEmulatorConfig("ps4");
  if (!discPath || !executablePath) return;

  const trophyFile = await resolveShadps4TrophyFile(executablePath, discPath);
  if (trophyFile) await fs.rm(trophyFile, { force: true });
};
