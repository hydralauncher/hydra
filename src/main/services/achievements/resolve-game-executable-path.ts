import path from "node:path";
import fs from "node:fs";

import type { Game } from "@types";

import { Wine } from "../wine";

export const resolveGameExecutablePath = (game: Game) => {
  if (!game.executablePath) return null;

  const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    game.objectId
  );

  if (!effectiveWinePrefixPath) return game.executablePath;

  const prefixedExecutablePath = path.join(
    effectiveWinePrefixPath,
    game.executablePath
  );

  return fs.existsSync(prefixedExecutablePath)
    ? prefixedExecutablePath
    : game.executablePath;
};
