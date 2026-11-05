import type { Game, GameShop, RecompilationSaveRule } from "@types";
import { parseRecompilationCloudSaveObjectId } from "@shared";

import { gamesSublevel, levelKeys } from "@main/level";
import { getRecompilationInstallState } from "@main/events/recompilation/recompilation-installer";
import {
  getRecompilationBaseDirectory,
  resolveRecompilationPath,
} from "@main/events/recompilation/recompilation-paths";
import recompilationSaves from "@main/events/recompilation/recompilation-saves.json";

type SaveOs = "windows" | "linux";

interface RecompilationSaveMapEntry {
  kind: string;
  tags: string[];
  // Same location on every OS.
  path?: string;
  when?: { os?: string; store?: string }[];
  // A location whose folder differs per OS: it syncs under one name and each
  // machine restores it into its own folder.
  id?: string;
  paths?: Partial<Record<SaveOs, string>>;
}

const SAVE_MAP = recompilationSaves as Record<
  string,
  { saves: RecompilationSaveMapEntry[] } | undefined
>;

const LOGICAL_SAVE_ROOT = "<recompilation>";

const currentSaveOs = (): SaveOs | null => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return null;
};

const getBaseDirectory = async (ref: { objectId: string; slug: string }) => {
  const state = await getRecompilationInstallState(ref);
  return state?.installPath
    ? getRecompilationBaseDirectory(state.installPath)
    : null;
};

export const getRecompilationSaveRules = async (
  shop: GameShop,
  objectId: string
): Promise<RecompilationSaveRule[] | undefined> => {
  const port = parseRecompilationCloudSaveObjectId(shop, objectId);
  if (!port || !Object.hasOwn(SAVE_MAP, port.slug)) return undefined;

  const saveOs = currentSaveOs();
  let baseDirectory: string | null | undefined;
  const rules: RecompilationSaveRule[] = [];

  for (const entry of SAVE_MAP[port.slug]?.saves ?? []) {
    const kind = entry.kind === "file" ? "file" : "dir";

    if (entry.path) {
      rules.push({
        rawPath: entry.path,
        kind,
        tags: entry.tags,
        when: entry.when ?? [],
      });
      continue;
    }

    const template = saveOs ? entry.paths?.[saveOs] : undefined;
    if (!entry.id || !template) continue;
    if (template.includes("<base>")) {
      baseDirectory ??= await getBaseDirectory(port);
      if (!baseDirectory) continue;
    }

    rules.push({
      rawPath: `${LOGICAL_SAVE_ROOT}/${entry.id}${kind === "dir" ? "/" : ""}`,
      kind,
      tags: entry.tags,
      when: [],
      preferredPath: resolveRecompilationPath(template, baseDirectory ?? ""),
    });
  }

  return rules;
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
