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
  // After a reset, what the log already has is skipped: the port may still be
  // writing to it, so the Hydra does not rewrite it.
  let skipExisting = false;
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

  const forget = () => {
    seen.clear();
    hasReadHistory = true;
    skipExisting = true;
  };

  const read = async (file: string): Promise<UnlockedAchievement[] | null> => {
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
      if (skipExisting) {
        skipExisting = false;
        offset = stats.size;
        resetOffset = stats.size;
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
  forget?: () => void;
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
    onForget: () => reader?.forget?.(),
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

  return {
    ...watcher,
    finish: async () => {
      await watcher.finish();
      if (files) {
        await reader
          ?.afterSession?.(files.file)
          .catch((error) =>
            achievementsLogger.error(
              `Failed to clean the ${ref.slug} log after a reset`,
              error
            )
          );
      }
    },
  };
};
