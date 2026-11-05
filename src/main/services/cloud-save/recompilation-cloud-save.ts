import type {
  CloudSavePathContext,
  Game,
  GameShop,
  RecompilationSaveRule,
} from "@types";
import { parseRecompilationCloudSaveObjectId } from "@shared";

import { gamesSublevel, levelKeys } from "@main/level";
import { getRecompilationInstallState } from "@main/events/recompilation/recompilation-installer";
import recompilationSaves from "@main/events/recompilation/recompilation-saves.json";

import { NativeAddon } from "../native-addon";

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

// Resolves this machine's folder with the same native resolver the other save
// rules use (known folders on Windows, XDG on Linux, <base> from the executable).
const resolveLocalFolder = (
  pathContext: CloudSavePathContext,
  rawPath: string,
  kind: string
) =>
  NativeAddon.resolveSaveRules({
    shop: pathContext.shop,
    objectId: pathContext.objectId,
    platform: pathContext.platform,
    homeDir: pathContext.homeDir,
    documentsDir: pathContext.documentsDir,
    appDataDir: pathContext.appDataDir,
    executablePath: pathContext.executablePath,
    winePrefixPath: pathContext.winePrefixPath,
    steamPath: pathContext.steamPath,
    rules: [
      { ruleId: rawPath, kind, rawPath, source: "recomp", tags: [], when: [] },
    ],
  })[0]?.resolvedPaths[0]?.path;

export const getRecompilationSaveRules = (
  pathContext: CloudSavePathContext
): RecompilationSaveRule[] | undefined => {
  const port = parseRecompilationCloudSaveObjectId(
    pathContext.shop,
    pathContext.objectId
  );
  if (!port || !Object.hasOwn(SAVE_MAP, port.slug)) return undefined;

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

      const template = entry.paths?.[pathContext.platform];
      const preferredPath =
        entry.id && template
          ? resolveLocalFolder(pathContext, template, kind)
          : undefined;
      if (!preferredPath) return [];

      return [
        {
          rawPath: `${LOGICAL_SAVE_ROOT}/${entry.id}${kind === "dir" ? "/" : ""}`,
          kind,
          tags: entry.tags,
          when: [],
          preferredPath,
        },
      ];
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
