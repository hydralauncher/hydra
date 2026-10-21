import path from "node:path";
import type { AchievementFile, Game } from "@types";
import { SystemPath } from "../../system-path";
import { Wine } from "../../wine";
import { achievementsLogger } from "../../logger";
import { resolveGameExecutablePath } from "../resolve-game-executable-path";
import { findEpicAchievementFilesInRoots } from "./find-epic-achievement-files";
import { getNemirtingasSaveRoot } from "./nemirtingas-save-root";

interface AppDataRoots {
  roaming: string[];
  local: string[];
}

const getWindowsAppDataRoots = (): AppDataRoots => {
  const roaming = SystemPath.getPath("appData");
  const local = process.env.LOCALAPPDATA;

  return {
    roaming: [roaming],
    local: [
      local && path.isAbsolute(local)
        ? local
        : path.resolve(roaming, "..", "Local"),
    ],
  };
};

const getWineAppDataRoots = async (game: Game): Promise<AppDataRoots> => {
  const prefixPath = await Wine.resolvePrefixPath(
    Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
  );
  if (!prefixPath) return { roaming: [], local: [] };

  const appDataRoots = Wine.getPrefixUserProfiles(prefixPath).map((profile) =>
    path.join(prefixPath, "drive_c", "users", profile, "AppData")
  );

  return {
    roaming: appDataRoots.map((root) => path.join(root, "Roaming")),
    local: appDataRoots.map((root) => path.join(root, "Local")),
  };
};

const getNemirtingasRoots = async (game: Game, roaming: string[]) => {
  const saveRoot = await getNemirtingasSaveRoot(
    resolveGameExecutablePath(game),
    (message) => achievementsLogger.warn(message, game.objectId)
  );

  if (saveRoot === null) return [];
  return saveRoot ? [saveRoot] : roaming;
};

export const findEpicAchievementFiles = async (
  game: Game,
  options: { allProfiles?: boolean } = {}
): Promise<AchievementFile[]> => {
  if (game.shop !== "epic") return [];

  const { roaming, local } =
    process.platform === "win32"
      ? getWindowsAppDataRoots()
      : await getWineAppDataRoots(game);

  // The engine writes to LocalAppData; LBX-1070 also reports Roaming.
  return findEpicAchievementFilesInRoots(
    game.objectId,
    {
      nemirtingas: await getNemirtingasRoots(game, roaming),
      alanWake2: [...local, ...roaming],
    },
    options
  );
};
