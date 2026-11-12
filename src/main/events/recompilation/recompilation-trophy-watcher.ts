import { promises as fs } from "node:fs";
import path from "node:path";

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
import { getRecompilationChosenTitleId } from "./recompilation-rom";
import {
  getTrophySourcePath,
  keepCatalogueTrophies,
  parseTrophyBitmask,
  parseTrophyEarnedJson,
  parseTrophyIdTimeLines,
  parseTrophyJsonLines,
  parseTrophyLogLines,
  removeTrophiesFromBitmask,
  removeTrophiesFromEarnedJson,
  removeTrophiesFromIdLines,
  removeTrophiesFromIdTimeLines,
  removeTrophiesFromJsonLines,
  stripTrophyLogLines,
  withHydraPlatinum,
  type RecompilationTrophySource,
} from "./recompilation-trophies";

const TROPHY_SOURCES = recompilationMeta as Record<
  string,
  | {
      trophies?: RecompilationTrophySource;
      rom?: { titleIds?: string[] } | null;
    }
  | undefined
>;

export const getTrophySource = (slug: string) =>
  (Object.hasOwn(TROPHY_SOURCES, slug)
    ? TROPHY_SOURCES[slug]?.trophies
    : undefined) ?? null;

const TITLE_ID_TOKEN = "{titleId}";

const readText = (file: string) => fs.readFile(file, "utf8").catch(() => null);

/** Where the SotC log stood at a reset made while the port ran. */
interface LogResetMark {
  ino: number;
  offset: number;
}

/**
 * Takes the trophy lines written before the reset out of the log. A log the
 * port rotated since (another file) is left alone.
 */
const stripLogBeforeMark = async (file: string, mark: LogResetMark) => {
  const stats = await fs.stat(file).catch(() => null);
  if (!stats || stats.ino !== mark.ino || stats.size < mark.offset) return;
  const data = await fs.readFile(file);
  const head = data.subarray(0, mark.offset).toString("utf8");
  const stripped = stripTrophyLogLines(head);
  if (stripped !== head) {
    await fs.writeFile(
      file,
      Buffer.concat([Buffer.from(stripped), data.subarray(mark.offset)])
    );
  }
};

/** Trophy ids the log had before the reset mark, to ignore them later. */
const logTrophyIdsBeforeMark = async (
  file: string,
  mark: LogResetMark | null
) => {
  if (!mark) return [];
  const data = await fs.readFile(file).catch(() => null);
  if (!data) return [];
  return parseTrophyLogLines(
    data.subarray(0, mark.offset).toString("utf8")
  ).map(String);
};

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
  let resetMark: LogResetMark | null = null;

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
      resetMark = { ino: stats.ino, offset: stats.size };
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
    if (!resetMark) return;
    await stripLogBeforeMark(file, resetMark);
    resetMark = null;
  };

  return { read, forget, afterSession, getResetMark: () => resetMark };
};

interface TrophyReader {
  read: (file: string) => Promise<UnlockedAchievement[] | null>;
  forget?: (file: string | null) => Promise<void>;
  /** Runs once the port closed and the last read is done. */
  afterSession?: (file: string) => Promise<void>;
  getResetMark?: () => LogResetMark | null;
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
    case "earned-json":
      return {
        read: async (file) => {
          const contents = await readText(file);
          return contents === null ? null : parseTrophyEarnedJson(contents);
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
export const resolveRecompilationTrophyFiles = async (
  ref: RecompilationRef,
  titleIdOverride?: string
) => {
  const source = getTrophySource(ref.slug);
  const template = source && getTrophySourcePath(source, process.platform);
  if (!source || !template) return null;

  const baseDirectory = await getRecompilationBaseDirectory(
    await getRecompilationInstallDirectory(ref.slug)
  );
  const needsTitleId = template.includes(TITLE_ID_TOKEN);
  const titleId = needsTitleId
    ? (titleIdOverride ?? (await getRecompilationChosenTitleId(ref)))
    : null;
  if (needsTitleId && !titleId) return null;
  const resolvePath = (value: string) =>
    resolveRecompilationPath(
      titleId ? value.replaceAll(TITLE_ID_TOKEN, titleId) : value,
      baseDirectory
    );
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

export const resolveAllRecompilationTrophyFiles = async (
  ref: RecompilationRef
) => {
  const source = getTrophySource(ref.slug);
  const template = source && getTrophySourcePath(source, process.platform);
  const titleIds = template?.includes(TITLE_ID_TOKEN)
    ? (TROPHY_SOURCES[ref.slug]?.rom?.titleIds ?? [])
    : [];
  if (!titleIds.length) {
    const files = await resolveRecompilationTrophyFiles(ref);
    return files ? [files] : [];
  }
  const all = await Promise.all(
    titleIds.map((titleId) => resolveRecompilationTrophyFiles(ref, titleId))
  );
  return all.filter((files) => files !== null);
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
    case "earned-json":
      for (const file of [files.file, `${files.file}.bak`]) {
        await rewriteText(file, (contents) =>
          removeTrophiesFromEarnedJson(contents, ids)
        );
      }
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

export interface RecompilationTrophyWatcher
  extends Omit<TrophyFileWatcher, "finish"> {
  /**
   * The last read. With the port still open (the Hydra quits first), the
   * clean-up after a reset is saved and runs before the next launch instead.
   */
  finish: (portClosed?: boolean) => Promise<void>;
}

const PENDING_RESET_FILE = ".hydra-trophy-reset.json";

interface PendingTrophyReset {
  ids: string[];
  log: LogResetMark | null;
  file?: string;
}

const pendingResetPath = async (slug: string) =>
  path.join(await getRecompilationInstallDirectory(slug), PENDING_RESET_FILE);

const savePendingTrophyReset = async (
  slug: string,
  pending: PendingTrophyReset
) => {
  const file = await pendingResetPath(slug);
  const saved = await readText(file);
  const previous: PendingTrophyReset | null = saved
    ? (JSON.parse(saved) as PendingTrophyReset)
    : null;
  await fs.writeFile(
    file,
    JSON.stringify({
      ids: [...new Set([...(previous?.ids ?? []), ...pending.ids])],
      log: pending.log ?? previous?.log ?? null,
      file: pending.file ?? previous?.file,
    })
  );
};

/** Drops a saved clean-up, after a reset of the closed port cleared all. */
export const clearPendingTrophyReset = async (slug: string) => {
  await fs.rm(await pendingResetPath(slug), { force: true });
};

/** Runs a clean-up saved when the Hydra quit with the port open. */
const readPendingTrophyReset = async (
  slug: string
): Promise<PendingTrophyReset | null> => {
  const contents = await readText(await pendingResetPath(slug));
  if (contents === null) return null;
  try {
    const pending = JSON.parse(contents) as PendingTrophyReset;
    return {
      ids: pending.ids ?? [],
      log: pending.log ?? null,
      file: pending.file,
    };
  } catch {
    await clearPendingTrophyReset(slug);
    return null;
  }
};

/**
 * Runs a clean-up saved when the Hydra quit with the port open. If it fails
 * (a file still locked), it stays saved: the next session ignores those
 * trophies and tries again when the port closes.
 */
export const applyPendingTrophyReset = async (ref: RecompilationRef) => {
  const pending = await readPendingTrophyReset(ref.slug);
  if (!pending) return;
  const resolved = await resolveRecompilationTrophyFiles(ref);
  const files =
    resolved && pending.file ? { ...resolved, file: pending.file } : resolved;
  if (files) {
    await removeResetTrophies(files, pending.ids);
    if (pending.log) await stripLogBeforeMark(files.file, pending.log);
  }
  await clearPendingTrophyReset(ref.slug);
};

export const startRecompilationTrophyWatcher = (
  ref: RecompilationRef,
  gameKey: string
): RecompilationTrophyWatcher | null => {
  const source = getTrophySource(ref.slug);
  if (!source || !getTrophySourcePath(source, process.platform)) return null;

  let files: Awaited<ReturnType<typeof resolveRecompilationTrophyFiles>> = null;
  let reader: TrophyReader | null = null;

  const watcher = startTrophyFileWatcher({
    gameKey,
    label: ref.slug,
    skipSouvenirCapture: true,
    resolveFile: async () => {
      files ??= await resolveRecompilationTrophyFiles(ref);
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
  // A clean-up that could not run before this launch: its trophies are not
  // imported, and the clean-up is tried again when the port closes.
  void readPendingTrophyReset(ref.slug).then((pending) => {
    if (!pending) return;
    for (const id of pending.ids) resetIds.add(id);
    watcher.ignore(pending.ids);
  });

  return {
    ignore: watcher.ignore,
    forget: async () => {
      const ids = await watcher.forget();
      for (const id of ids) resetIds.add(id);
      return ids;
    },
    finish: async (portClosed = true) => {
      await watcher.finish();
      const resolved = files;
      if (!resolved) return;
      const logMark = reader?.getResetMark?.() ?? null;
      if (resetIds.size === 0 && !logMark) return;

      const work = portClosed
        ? removeResetTrophies(resolved, [...resetIds])
            .then(() =>
              logMark ? stripLogBeforeMark(resolved.file, logMark) : undefined
            )
            .then(() => clearPendingTrophyReset(ref.slug))
        : logTrophyIdsBeforeMark(resolved.file, logMark).then((logIds) =>
            savePendingTrophyReset(ref.slug, {
              ids: [...new Set([...resetIds, ...logIds])],
              log: logMark,
              file: resolved.file,
            })
          );
      await work.catch((error) =>
        achievementsLogger.error(
          `Failed to clean the ${ref.slug} trophies after a reset`,
          error
        )
      );
    },
  };
};
