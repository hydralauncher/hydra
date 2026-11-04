import type { Game, GameShop, RecompilationSaveRule } from "@types";
import { parseRecompilationCloudSaveObjectId } from "@shared";

import { gamesSublevel, levelKeys } from "@main/level";
import { getRecompilationInstallState } from "@main/events/recompilation/recompilation-installer";
import recompilationSaves from "@main/events/recompilation/recompilation-saves.json";

interface RecompilationSaveMapEntry {
  path: string;
  kind: string;
  tags: string[];
  when?: { os?: string; store?: string }[];
}

const SAVE_MAP = recompilationSaves as Record<
  string,
  { saves: RecompilationSaveMapEntry[] } | undefined
>;

export const getRecompilationSaveRules = (
  shop: GameShop,
  objectId: string
): RecompilationSaveRule[] | undefined => {
  const port = parseRecompilationCloudSaveObjectId(shop, objectId);
  if (!port || !Object.hasOwn(SAVE_MAP, port.slug)) return undefined;

  return SAVE_MAP[port.slug]?.saves.map((entry) => ({
    rawPath: entry.path,
    kind: entry.kind === "file" ? "file" : "dir",
    tags: entry.tags,
    when: entry.when ?? [],
  }));
};

export const getRecompilationCloudSaveGame = async (
  shop: GameShop,
  objectId: string
): Promise<Game | null> => {
  const port = parseRecompilationCloudSaveObjectId(shop, objectId);
  if (!port || !getRecompilationSaveRules(shop, objectId)) return null;

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
