import { promises as fs } from "node:fs";

import type { Game, RecompilationRef } from "@types";

import { achievementsLogger } from "@main/services/logger";
import {
  emptyTrophyBitmask,
  stripTrophyLogLines,
} from "./recompilation-trophies";
import {
  clearPendingTrophyReset,
  resolveAllRecompilationTrophyFiles,
  resolveRecompilationTrophyFiles,
} from "./recompilation-trophy-watcher";

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false
  );

const stripLog = async (file: string) => {
  const contents = await fs.readFile(file, "utf8").catch(() => null);
  if (contents === null) return;
  const stripped = stripTrophyLogLines(contents);
  if (stripped !== contents) await fs.writeFile(file, stripped);
};

type TrophyFiles = NonNullable<
  Awaited<ReturnType<typeof resolveRecompilationTrophyFiles>>
>;

const clearTrophyFiles = async (files: TrophyFiles) => {
  switch (files.source.kind) {
    case "bitmask":
      // An empty bitmask instead of no file: it is a newer local change, so a
      // cloud save sync uploads it instead of bringing the old one back.
      if (await exists(files.file)) {
        await fs.writeFile(files.file, emptyTrophyBitmask());
      }
      break;
    case "id-time-lines":
    case "jsonl":
      await fs.rm(files.file, { force: true });
      break;
    case "earned-json":
      await fs.rm(files.file, { force: true });
      await fs.rm(`${files.file}.bak`, { force: true });
      break;
    case "log":
      await stripLog(files.file);
      for (const rotated of files.history) await stripLog(rotated);
      break;
  }

  for (const file of files.resetFiles) await fs.rm(file, { force: true });
};

const resetPortTrophies = async (ref: RecompilationRef, isRunning: boolean) => {
  // An open port keeps its trophies in memory and may hold its files, so they
  // are left alone: the watcher ignores what they have now, and takes those
  // trophies out once the port closes. Only rotated logs are not in use.
  if (isRunning) {
    const files = await resolveRecompilationTrophyFiles(ref);
    if (files?.source.kind === "log") {
      for (const rotated of files.history) await stripLog(rotated);
    }
    return;
  }

  for (const files of await resolveAllRecompilationTrophyFiles(ref)) {
    await clearTrophyFiles(files);
  }
};

/**
 * Clears the trophies the game's PS4 ports keep, so a reset is not undone
 * when the port opens and its trophies are read again.
 */
export const resetRecompilationTrophies = async (game: Game) => {
  // Ports belong to LaunchBox games; another shop can share the object id.
  if (game.shop !== "launchbox") return;

  const { forgetRunningRecompilationTrophies, listRunningRecompilationSlugs } =
    await import("./recompilation-session");
  const running = new Set(listRunningRecompilationSlugs(game.objectId));
  const slugs = new Set([
    ...(game.discs ?? []).flatMap((disc) =>
      disc.recompilationSlug ? [disc.recompilationSlug] : []
    ),
    ...running,
  ]);

  // First, while the files still hold the old trophies, the running port's
  // watcher marks them as reset.
  await forgetRunningRecompilationTrophies(game.objectId).catch((error) =>
    achievementsLogger.error(
      "Failed to reset the running port's trophies",
      error
    )
  );

  for (const slug of slugs) {
    try {
      const isRunning = running.has(slug);
      await resetPortTrophies({ objectId: game.objectId, slug }, isRunning);
      // A closed port is cleared completely, so a saved clean-up is moot.
      if (!isRunning) await clearPendingTrophyReset(slug);
    } catch (error) {
      achievementsLogger.error(`Failed to reset ${slug} trophies`, error);
    }
  }
};
