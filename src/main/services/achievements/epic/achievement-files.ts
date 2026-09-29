import path from "node:path";
import { realpath } from "node:fs/promises";
import type { Game } from "@types";
import { SystemPath } from "../../system-path";
import { Wine } from "../../wine";
import { achievementsLogger } from "../../logger";
import { resolveGameExecutablePath } from "../resolve-game-executable-path";
import {
  inspectEpicAchievementFilesInRoots,
  getNemirtingasSaveRoot,
  type EpicAchievementDiscovery,
  type EpicAchievementFile,
  type EpicAchievementRoots,
} from "./achievement-state";

export {
  parseEpicAchievementFile,
  type EpicAchievementDiscovery,
  type EpicAchievementSource,
  type EpicAchievementUnlock,
} from "./achievement-state";

const previousWarnings = new Map<string, Set<string>>();

async function getWineRoots(game: Game): Promise<EpicAchievementRoots> {
  const requestedPrefix = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    game.objectId
  );
  const prefix = await Wine.resolvePrefixPath(requestedPrefix);
  if (!prefix) return { roaming: [], local: [] };

  const usersRoot = await realpath(path.join(prefix, "drive_c", "users")).catch(
    () => null
  );
  if (!usersRoot) return { roaming: [], local: [] };
  const roaming: string[] = [];
  const local: string[] = [];
  for (const name of Wine.getPrefixUserProfiles(prefix)) {
    const userRoot = await realpath(path.join(usersRoot, name)).catch(
      () => null
    );
    if (!userRoot) continue;
    const relative = path.relative(usersRoot, userRoot);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      continue;
    roaming.push(path.join(userRoot, "AppData", "Roaming"));
    local.push(path.join(userRoot, "AppData", "Local"));
  }
  return { roaming, local };
}

export async function inspectEpicAchievementFiles(
  game: Game
): Promise<EpicAchievementDiscovery> {
  if (game.shop !== "epic") return { files: [], ambiguous: false };
  const warningKey = `${game.shop}:${game.objectId}`;
  const warnedThisScan = new Set<string>();
  const warn = (message: string) => {
    warnedThisScan.add(message);
    if (!previousWarnings.get(warningKey)?.has(message))
      achievementsLogger.warn(message, game.objectId);
  };

  let roots: EpicAchievementRoots;
  if (process.platform === "win32") {
    const roaming = SystemPath.getPath("appData") || process.env.APPDATA || "";
    if (!path.isAbsolute(roaming)) {
      warn("Cannot resolve AppData for Epic achievements");
      previousWarnings.set(warningKey, warnedThisScan);
      return { files: [], ambiguous: true };
    }
    const configuredLocal = process.env.LOCALAPPDATA;
    const local =
      configuredLocal && path.isAbsolute(configuredLocal)
        ? configuredLocal
        : path.resolve(roaming, "..", "Local");
    roots = { roaming: [roaming], local: [local] };
  } else {
    roots = await getWineRoots(game);
    if (roots.roaming.length === 0 && !game.winePrefixPath) {
      const home = SystemPath.getPath("home");
      if (path.isAbsolute(home)) {
        const roaming =
          process.platform === "darwin"
            ? home
            : process.env.XDG_DATA_HOME &&
                path.isAbsolute(process.env.XDG_DATA_HOME)
              ? process.env.XDG_DATA_HOME
              : path.join(home, ".local", "share");
        roots = { roaming: [roaming], local: [] };
      }
    }
  }

  const saveRoot = await getNemirtingasSaveRoot(
    resolveGameExecutablePath(game),
    warn
  );
  if (saveRoot === null) roots.roaming = [];
  else if (saveRoot) roots.roaming = [saveRoot];

  const discovered = await inspectEpicAchievementFilesInRoots(
    game.objectId,
    roots,
    warn
  );
  previousWarnings.set(warningKey, warnedThisScan);
  return {
    ...discovered,
    ambiguous: discovered.ambiguous || saveRoot === null,
  };
}

export async function findEpicAchievementFiles(
  game: Game
): Promise<EpicAchievementFile[]> {
  return (await inspectEpicAchievementFiles(game)).files;
}
