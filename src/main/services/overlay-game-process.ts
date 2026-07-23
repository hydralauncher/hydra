import type { Game } from "@types";

import { NativeAddon } from "./native-addon";
import { rankOverlayGameProcesses } from "./overlay-game-process-ranking";

const getOverlayProcessTargets = (game: Game) =>
  [game.executablePath, ...(game.trackingExecutablePaths ?? [])].filter(
    (value): value is string => Boolean(value)
  );

export const findOverlayGameProcesses = async (game: Game) => {
  const targets = getOverlayProcessTargets(game);
  if (!targets.length) return [];

  const [processes, foregroundPid] = await Promise.all([
    NativeAddon.listProcesses(),
    Promise.resolve(NativeAddon.getForegroundProcessId()),
  ]);

  return rankOverlayGameProcesses(processes, targets, foregroundPid);
};

export const findOverlayGameProcess = async (game: Game) =>
  (await findOverlayGameProcesses(game))[0] ?? null;
