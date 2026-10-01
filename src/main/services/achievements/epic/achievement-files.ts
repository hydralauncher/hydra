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
  const userRoots = await Promise.all(
    Wine.getPrefixUserProfiles(prefix).map((name) =>
      realpath(path.join(usersRoot, name)).catch(() => null)
    )
  );
  for (const userRoot of userRoots) {
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

async function getEpicAchievementRoots(
  game: Game,
  warn: (message: string) => void
): Promise<EpicAchievementRoots | null> {
  if (process.platform === "win32") {
    const roaming = SystemPath.getPath("appData") || process.env.APPDATA || "";
    if (!path.isAbsolute(roaming)) {
      warn("Cannot resolve AppData for Epic achievements");
      return null;
    }
    const configuredLocal = process.env.LOCALAPPDATA;
    const local =
      configuredLocal && path.isAbsolute(configuredLocal)
        ? configuredLocal
        : path.resolve(roaming, "..", "Local");
    return { roaming: [roaming], local: [local] };
  }

  const roots = await getWineRoots(game);
  if (roots.roaming.length || game.winePrefixPath) return roots;
  const home = SystemPath.getPath("home");
  if (!path.isAbsolute(home)) return roots;

  let roaming = home;
  if (process.platform !== "darwin") {
    const dataHome = process.env.XDG_DATA_HOME;
    roaming =
      dataHome && path.isAbsolute(dataHome)
        ? dataHome
        : path.join(home, ".local", "share");
  }
  return { roaming: [roaming], local: [] };
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

  const roots = await getEpicAchievementRoots(game, warn);
  if (!roots) {
    previousWarnings.set(warningKey, warnedThisScan);
    return { files: [], ambiguous: true };
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
