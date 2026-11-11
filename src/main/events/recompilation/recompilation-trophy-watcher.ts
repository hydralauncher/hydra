import { promises as fs } from "node:fs";

import type { RecompilationRef, UnlockedAchievement } from "@types";

import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { achievementsLogger } from "@main/services/logger";
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
  removeTrophiesFromBitmask,
  removeTrophiesFromIdLines,
  removeTrophiesFromIdTimeLines,
  removeTrophiesFromJsonLines,
  stripTrophyLogLines,
  withHydraPlatinum,
  type RecompilationTrophySource,
} from "./recompilation-trophies";

const TROPHY_SOURCES = recompilationMeta as Record<
  string,
  { trophies?: RecompilationTrophySource } | undefined
>;

export const getTrophySource = (slug: string) =>
  (Object.hasOwn(TROPHY_SOURCES, slug)
    ? TROPHY_SOURCES[slug]?.trophies
    : undefined) ?? null;

const readText = (file: string) => fs.readFile(file, "utf8").catch(() => null);

const createLogReader = (history: string[]) => {
  const seen = new Map<string, number>();
  let identity: number | null = null;
  let offset = 0;
  let hasReadHistory = false;
  // Bumped by a reset, so a read that started before it remembers nothing.
  let generation = 0;
  // Where the log was when the reset happened; its trophy lines up to there
  // are taken out once the port closes, or the next session would read them
  // back from the rotated log.
  let resetOffset: number | null = null;

  const remember = (contents: string) => {
    const now = Date.now();
    for (const id of parseTrophyLogLines(contents)) {
      if (!seen.has(String(id))) seen.set(String(id), now);
    }
  };

  // The port may still be writing to the log, so the Hydra does not rewrite
  // it: it reads on from where the log stood at the reset.
  const forget = async (file: string | null) => {
    generation += 1;
    seen.clear();
    hasReadHistory = true;
    const stats = file ? await fs.stat(file).catch(() => null) : null;
    if (stats) {
      identity = stats.ino;
      offset = stats.size;
      resetOffset = stats.size;
    }
  };

  const read = async (file: string): Promise<UnlockedAchievement[] | null> => {
    const startedAt = generation;
    if (!hasReadHistory) {
      hasReadHistory = true;
      for (const rotated of history) {
        const contents = await readText(rotated);
        if (contents && generation === startedAt) remember(contents);
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

      const from = offset;
      const length = stats.size - from;
      if (length > 0) {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, from);
        if (generation !== startedAt) return null;
        const end = buffer.lastIndexOf("\n") + 1;
        remember(buffer.subarray(0, end).toString("utf8"));
        offset = from + end;
      }
    } finally {
      await handle.close();
    }

    return Array.from(seen, ([name, unlockTime]) => ({ name, unlockTime }));
  };

  const afterSession = async (file: string) => {
    if (resetOffset === null) return;
    const data = await fs.readFile(file).catch(() => null);
    if (!data) return;
    const head = data.subarray(0, resetOffset).toString("utf8");
    const stripped = stripTrophyLogLines(head);
    if (stripped !== head) {
      await fs.writeFile(
        file,
        Buffer.concat([Buffer.from(stripped), data.subarray(resetOffset)])
      );
    }
    resetOffset = null;
  };

  return { read, forget, afterSession };
};

interface TrophyReader {
  read: (file: string) => Promise<UnlockedAchievement[] | null>;
  forget?: (file: string | null) => Promise<void>;
  /** Runs once the port closed and the last read is done. */
  afterSession?: (file: string) => Promise<void>;
}

const createReader = (
  source: RecompilationTrophySource,
  resolvePath: (template: string) => string
): TrophyReader => {
  switch (source.kind) {
    case "bitmask":
      return {
        read: async (file) => {
          const data = await fs.readFile(file).catch(() => null);
          return data ? parseTrophyBitmask(data) : null;
        },
      };
    case "id-time-lines":
      return {
        read: async (file) => {
          const contents = await readText(file);
          return contents === null ? null : parseTrophyIdTimeLines(contents);
        },
      };
    case "jsonl":
      return {
        read: async (file) => {
          const contents = await readText(file);
          return contents === null ? null : parseTrophyJsonLines(contents);
        },
      };
    case "log":
      return createLogReader((source.history ?? []).map(resolvePath));
  }
};

/** Where a port keeps its trophies on this machine, or null without a source. */
export const resolveRecompilationTrophyFiles = async (slug: string) => {
  const source = getTrophySource(slug);
  const template = source && getTrophySourcePath(source, process.platform);
  if (!source || !template) return null;

  const baseDirectory = await getRecompilationBaseDirectory(
    await getRecompilationInstallDirectory(slug)
  );
  const resolvePath = (value: string) =>
    resolveRecompilationPath(value, baseDirectory);
  const platform = process.platform as keyof NonNullable<
    RecompilationTrophySource["resetFiles"]
  >;

  return {
    source,
    file: resolvePath(template),
    history: (source.history ?? []).map(resolvePath),
    resetFiles: (source.resetFiles?.[platform] ?? []).map(resolvePath),
    resolvePath,
  };
};

type TrophyFiles = NonNullable<
  Awaited<ReturnType<typeof resolveRecompilationTrophyFiles>>
>;

const rewriteText = async (
  file: string,
  change: (contents: string) => string
) => {
  const contents = await readText(file);
  if (contents === null) return;
  const changed = change(contents);
  if (changed !== contents) await fs.writeFile(file, changed);
};

/**
 * Takes the trophies of a reset out of the port's files once the port closed,
 * keeping the ones earned after it. The log kind is handled by its reader.
 */
const removeResetTrophies = async (files: TrophyFiles, ids: string[]) => {
  switch (files.source.kind) {
    case "bitmask": {
      const data = await fs.readFile(files.file).catch(() => null);
      if (data) {
        await fs.writeFile(files.file, removeTrophiesFromBitmask(data, ids));
      }
      break;
    }
    case "id-time-lines":
      await rewriteText(files.file, (contents) =>
        removeTrophiesFromIdTimeLines(contents, ids)
      );
      break;
    case "jsonl":
      await rewriteText(files.file, (contents) =>
        removeTrophiesFromJsonLines(contents, ids)
      );
      break;
    case "log":
      break;
  }
  for (const file of files.resetFiles) {
    await rewriteText(file, (contents) =>
      removeTrophiesFromIdLines(contents, ids)
    );
  }
};

export const startRecompilationTrophyWatcher = (
  ref: RecompilationRef,
  gameKey: string
): TrophyFileWatcher | null => {
  const source = getTrophySource(ref.slug);
  if (!source || !getTrophySourcePath(source, process.platform)) return null;

  let files: Awaited<ReturnType<typeof resolveRecompilationTrophyFiles>> = null;
  let reader: TrophyReader | null = null;

  const watcher = startTrophyFileWatcher({
    gameKey,
    label: ref.slug,
    skipSouvenirCapture: true,
    resolveFile: async () => {
      files ??= await resolveRecompilationTrophyFiles(ref.slug);
      return files?.file ?? null;
    },
    readUnlocks: (file) => {
      if (!files) return Promise.resolve(null);
      reader ??= createReader(source, files.resolvePath);
      return reader.read(file);
    },
    onForget: async (file) => {
      if (files) reader ??= createReader(source, files.resolvePath);
      await reader?.forget?.(file);
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

  const resetIds = new Set<string>();

  return {
    forget: async () => {
      const ids = await watcher.forget();
      for (const id of ids) resetIds.add(id);
      return ids;
    },
    finish: async () => {
      await watcher.finish();
      const resolved = files;
      if (!resolved) return;
      const cleanUp = async () => {
        await reader?.afterSession?.(resolved.file);
        if (resetIds.size > 0) {
          await removeResetTrophies(resolved, [...resetIds]);
        }
      };
      await cleanUp().catch((error) =>
        achievementsLogger.error(
          `Failed to clean the ${ref.slug} trophies after a reset`,
          error
        )
      );
    },
  };
};
