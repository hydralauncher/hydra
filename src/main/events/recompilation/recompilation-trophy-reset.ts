import { promises as fs } from "node:fs";

import type { Game } from "@types";

import { achievementsLogger } from "@main/services/logger";
import {
  findRunningRecompilation,
  forgetRunningRecompilationTrophies,
} from "./recompilation-session";
import {
  emptyTrophyBitmask,
  stripTrophyLogLines,
} from "./recompilation-trophies";
import { resolveRecompilationTrophyFiles } from "./recompilation-trophy-watcher";

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

const resetPortTrophies = async (slug: string, isRunning: boolean) => {
  const files = await resolveRecompilationTrophyFiles(slug);
  if (!files) return;

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
    case "log":
      // The port writes to its current log while it runs; the watcher skips
      // what is there instead.
      if (!isRunning) await stripLog(files.file);
      for (const rotated of files.history) await stripLog(rotated);
      break;
  }

  for (const file of files.resetFiles) await fs.rm(file, { force: true });
};

/**
 * Clears the trophies the game's PS4 ports keep, so a reset is not undone
 * when the port opens and its trophies are read again.
 */
export const resetRecompilationTrophies = async (game: Game) => {
  const running = findRunningRecompilation(game.objectId);
  const slugs = new Set(
    (game.discs ?? []).flatMap((disc) =>
      disc.recompilationSlug ? [disc.recompilationSlug] : []
    )
  );
  if (running) slugs.add(running.slug);

  for (const slug of slugs) {
    try {
      await resetPortTrophies(slug, running?.slug === slug);
    } catch (error) {
      achievementsLogger.error(`Failed to reset ${slug} trophies`, error);
    }
  }

  forgetRunningRecompilationTrophies(game.objectId);
};
