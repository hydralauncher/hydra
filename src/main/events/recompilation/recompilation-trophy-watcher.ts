import { promises as fs } from "node:fs";

import type { RecompilationRef, UnlockedAchievement } from "@types";

import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import {
  startTrophyFileWatcher,
  type TrophyFileWatcher,
} from "@main/services/emulators/trophy-file-watcher";
import {
  getRecompilationBaseDirectory,
  getRecompilationInstallDirectory,
  resolveRecompilationPath,
} from "./recompilation-paths";
import recompilationMeta from "./recompilation-meta.json";
import {
  getTrophySourcePath,
  keepCatalogueTrophies,
  parseTrophyBitmask,
  parseTrophyIdTimeLines,
  parseTrophyJsonLines,
  parseTrophyLogLines,
  withHydraPlatinum,
  type RecompilationTrophySource,
} from "./recompilation-trophies";

const TROPHY_SOURCES = recompilationMeta as Record<
  string,
  { trophies?: RecompilationTrophySource } | undefined
>;

const getTrophySource = (slug: string) =>
  (Object.hasOwn(TROPHY_SOURCES, slug)
    ? TROPHY_SOURCES[slug]?.trophies
    : undefined) ?? null;

const readText = (file: string) => fs.readFile(file, "utf8").catch(() => null);

const createLogReader = (history: string[]) => {
  const seen = new Map<string, number>();
  let identity: number | null = null;
  let offset = 0;
  let hasReadHistory = false;

  const remember = (contents: string) => {
    const now = Date.now();
    for (const id of parseTrophyLogLines(contents)) {
      if (!seen.has(String(id))) seen.set(String(id), now);
    }
  };

  return async (file: string): Promise<UnlockedAchievement[] | null> => {
    if (!hasReadHistory) {
      hasReadHistory = true;
      for (const rotated of history) {
        const contents = await readText(rotated);
        if (contents) remember(contents);
      }
    }

    const handle = await fs.open(file, "r").catch(() => null);
    if (!handle) return null;
    try {
      const stats = await handle.stat();
      if (stats.ino !== identity || stats.size < offset) {
        identity = stats.ino;
        offset = 0;
      }

      const length = stats.size - offset;
      if (length > 0) {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        const end = buffer.lastIndexOf("\n") + 1;
        remember(buffer.subarray(0, end).toString("utf8"));
        offset += end;
      }
    } finally {
      await handle.close();
    }

    return Array.from(seen, ([name, unlockTime]) => ({ name, unlockTime }));
  };
};

const createReader = (
  source: RecompilationTrophySource,
  resolvePath: (template: string) => string
) => {
  switch (source.kind) {
    case "bitmask":
      return async (file: string) => {
        const data = await fs.readFile(file).catch(() => null);
        return data ? parseTrophyBitmask(data) : null;
      };
    case "id-time-lines":
      return async (file: string) => {
        const contents = await readText(file);
        return contents === null ? null : parseTrophyIdTimeLines(contents);
      };
    case "jsonl":
      return async (file: string) => {
        const contents = await readText(file);
        return contents === null ? null : parseTrophyJsonLines(contents);
      };
    case "log":
      return createLogReader((source.history ?? []).map(resolvePath));
  }
};

export const startRecompilationTrophyWatcher = (
  ref: RecompilationRef,
  gameKey: string
): TrophyFileWatcher | null => {
  const source = getTrophySource(ref.slug);
  const template = source && getTrophySourcePath(source, process.platform);
  if (!source || !template) return null;

  let baseDirectory: string | null = null;
  const resolvePath = (value: string) =>
    resolveRecompilationPath(value, baseDirectory ?? "");

  let readUnlocks: ReturnType<typeof createReader> | null = null;

  return startTrophyFileWatcher({
    gameKey,
    label: ref.slug,
    skipSouvenirCapture: true,
    resolveFile: async () => {
      baseDirectory ??= await getRecompilationBaseDirectory(
        await getRecompilationInstallDirectory(ref.slug)
      );
      return resolvePath(template);
    },
    readUnlocks: (file) => {
      readUnlocks ??= createReader(source, resolvePath);
      return readUnlocks(file);
    },
    completeUnlocks: (unlocks, catalogue, game) => {
      const names = catalogue.map((achievement) => achievement.name);
      const known = keepCatalogueTrophies(unlocks, names);
      if (!source.grantPlatinum) return known;

      const alreadyUnlocked =
        AchievementMemoryStore.get(game.shop, game.objectId)
          ?.unlockedAchievements ?? [];
      return withHydraPlatinum(known, names, alreadyUnlocked);
    },
  });
};
