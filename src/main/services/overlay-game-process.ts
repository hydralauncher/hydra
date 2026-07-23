import type { Game } from "@types";
import path from "node:path";

import { NativeAddon } from "./native-addon";

export const findOverlayGameProcess = async (game: Game) => {
  const targets = [game.executablePath, ...(game.trackingExecutablePaths ?? [])]
    .filter((value): value is string => Boolean(value))
    .map((value) => path.normalize(value).toLowerCase());

  if (!targets.length) return null;

  const processes = await NativeAddon.listProcesses();
  return (
    processes.find((candidate) => {
      const executable = candidate.exe
        ? path.normalize(candidate.exe).toLowerCase()
        : null;
      const processName = candidate.name.toLowerCase();
      return targets.some(
        (target) =>
          executable === target ||
          (executable && path.basename(executable) === path.basename(target)) ||
          processName === path.basename(target)
      );
    }) ?? null
  );
};
