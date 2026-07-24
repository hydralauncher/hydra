import type { Game } from "@types";

import { NativeAddon } from "./native-addon";
import {
  prioritizeVisibleOverlayProcesses,
  rankOverlayGameProcesses,
} from "./overlay-game-process-ranking";

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

  const ranked = rankOverlayGameProcesses(processes, targets, foregroundPid);
  if (process.platform !== "win32") return ranked;
  const visiblePids = new Set(
    ranked
      .filter((candidate) =>
        Boolean(NativeAddon.getProcessWindowBounds(candidate.pid))
      )
      .map((candidate) => candidate.pid)
  );
  return prioritizeVisibleOverlayProcesses(ranked, visiblePids);
};

export const findOverlayGameProcess = async (game: Game) =>
  (await findOverlayGameProcesses(game))[0] ?? null;
