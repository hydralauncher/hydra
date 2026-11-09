import path from "node:path";

import type {
  CloudSavePathContext,
  Game,
  GameShop,
  RecompilationSaveRule,
} from "@types";
import { parseRecompilationCloudSaveObjectId } from "@shared";

import { gamesSublevel, levelKeys } from "@main/level";
import { getRecompilationInstallState } from "@main/events/recompilation/recompilation-installer";
import { resolveRecompilationPath } from "@main/events/recompilation/recompilation-paths";
import recompilationSaves from "@main/events/recompilation/recompilation-saves.json";

interface RecompilationSaveMapEntry {
  kind: string;
  tags: string[];
  // Same location on every OS.
  path?: string;
  when?: { os?: string; store?: string }[];
  // A location whose folder differs per OS: it syncs under one name and each
  // machine restores it into its own folder.
  id?: string;
  paths?: Partial<Record<CloudSavePathContext["platform"], string>>;
}

const SAVE_MAP = recompilationSaves as Record<
  string,
  { saves: RecompilationSaveMapEntry[] } | undefined
>;

const LOGICAL_SAVE_ROOT = "<recompilation>";

// `launchExecutablePath` is the port's executable as Hydra launches it. The path
// context holds it with links resolved, and on Linux an AppImage's `AppRun` is a
// link into `usr/bin`, while the port runs from the folder that holds `AppRun`.
export const getRecompilationSaveRules = (
  pathContext: CloudSavePathContext,
  launchExecutablePath?: string | null
): RecompilationSaveRule[] | undefined => {
  const port = parseRecompilationCloudSaveObjectId(
    pathContext.shop,
    pathContext.objectId
  );
  if (!port || !Object.hasOwn(SAVE_MAP, port.slug)) return undefined;

  const executablePath = launchExecutablePath || pathContext.executablePath;

  return (SAVE_MAP[port.slug]?.saves ?? []).flatMap(
    (entry): RecompilationSaveRule[] => {
      const kind = entry.kind === "file" ? "file" : "dir";
      if (entry.path) {
        return [
          {
            rawPath: entry.path,
            kind,
            tags: entry.tags,
            when: entry.when ?? [],
          },
        ];
      }

      if (!entry.id || !entry.paths) return [];
      const rule: RecompilationSaveRule = {
        rawPath: `${LOGICAL_SAVE_ROOT}/${entry.id}${kind === "dir" ? "/" : ""}`,
        kind,
        tags: entry.tags,
        // Limited to the OSes that have a folder, so on any other OS the cloud copy
        // is left for another machine instead of counting as missing.
        when: Object.keys(entry.paths).map((os) => ({ os })),
      };

      const template = entry.paths[pathContext.platform];
      if (!template) return [rule];
      if (template.includes("<base>") && !executablePath) return [];

      // Same resolution as the port's ROM paths: environment folders (XDG_DATA_HOME
      // included) and the folder of the port's executable, as a literal path.
      const preferredPath = resolveRecompilationPath(
        template,
        path.dirname(executablePath ?? "")
      );

      return [{ ...rule, preferredPath }];
    }
  );
};

export const getRecompilationCloudSaveGame = async (
  shop: GameShop,
  objectId: string
): Promise<Game | null> => {
  const port = parseRecompilationCloudSaveObjectId(shop, objectId);
  if (!port || !Object.hasOwn(SAVE_MAP, port.slug)) return null;

  const state = await getRecompilationInstallState(port);
  if (!state?.installed || !state.executablePath) return null;

  const baseGame = await gamesSublevel
    .get(levelKeys.game(shop, port.objectId))
    .catch(() => undefined);

  return {
    shop,
    objectId,
    title: baseGame?.title ?? port.slug,
    iconUrl: null,
    libraryHeroImageUrl: null,
    logoImageUrl: null,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    remoteId: null,
    isDeleted: false,
    executablePath: state.executablePath,
  } as Game;
};

export const getCloudSaveGameRecord = async (
  shop: GameShop,
  objectId: string
): Promise<Game | undefined> => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (game) return game;
  return (await getRecompilationCloudSaveGame(shop, objectId)) ?? undefined;
};
