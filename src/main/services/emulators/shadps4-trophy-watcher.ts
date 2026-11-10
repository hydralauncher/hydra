import { promises as fs } from "node:fs";

import type { Game } from "@types";
import { platformToSystem } from "@shared";

import { prepareLinuxGameCaptureSession } from "../linux-game-capture-session";
import { achievementsLogger } from "../logger";
import { getEmulatorConfig } from "./emulators-repository";
import { loadEmulatorAchievementTracking } from "./load-emulator-achievement-tracking";
import {
  parseUnlockedTrophies,
  resolveShadps4TrophyFile,
} from "./shadps4-trophies";
import {
  startTrophyFileWatcher,
  type TrophyFileWatcher,
} from "./trophy-file-watcher";

export type Shadps4TrophyWatcher = TrophyFileWatcher;

interface StartShadps4TrophyWatcherOptions {
  gameKey: string;
  executablePath: string;
  discPath: string;
}

const prepareCaptureOnce = async (gameKey: string, game: Game) => {
  const tracking = await loadEmulatorAchievementTracking();
  if (tracking.souvenirs && game.remoteId) {
    await prepareLinuxGameCaptureSession(gameKey);
  }
};

export const startShadps4TrophyWatcher = ({
  gameKey,
  executablePath,
  discPath,
}: StartShadps4TrophyWatcherOptions): Shadps4TrophyWatcher =>
  startTrophyFileWatcher({
    gameKey,
    label: "shadPS4",
    resolveFile: () => resolveShadps4TrophyFile(executablePath, discPath),
    readUnlocks: async (file) => {
      const contents = await fs.readFile(file, "utf8").catch(() => null);
      return contents ? parseUnlockedTrophies(contents) : null;
    },
    onFirstChange: (game) => {
      prepareCaptureOnce(gameKey, game).catch((error) => {
        achievementsLogger.warn(
          "Failed to prepare shadPS4 trophy capture",
          gameKey,
          error
        );
      });
    },
  });

export const removeShadps4TrophyFile = async (game: Game): Promise<void> => {
  if (platformToSystem(game.platform) !== "ps4") return;

  const discPath = game.selectedDiscPath ?? game.discs?.[0]?.path;
  const { executablePath } = await getEmulatorConfig("ps4");
  if (!discPath || !executablePath) return;

  const trophyFile = await resolveShadps4TrophyFile(executablePath, discPath);
  if (trophyFile) await fs.rm(trophyFile, { force: true });
};
