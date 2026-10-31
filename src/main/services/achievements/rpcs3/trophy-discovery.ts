import { promises as fs } from "node:fs";
import path from "node:path";
import type { Game } from "@types";
import { extractTrophySetIdsFromIso } from "../../emulators/verified-ps3-iso-title-id.js";
import { RPCS3_TROPHY_SET_ID } from "./trophy-data.js";
import { mapWithConcurrency } from "../../cloud-save/map-with-concurrency.js";

const TROPHY_DISCOVERY_READ_CONCURRENCY = 2;

export const getGameTrophyMediaPaths = (
  game: Pick<Game, "discs" | "selectedDiscPath">
): string[] => [
  ...new Set(
    [
      game.selectedDiscPath,
      ...(game.discs ?? []).map((disc) => disc.path),
    ].filter((item): item is string => Boolean(item))
  ),
];

const getMediaRoot = (media: string, isDirectory: boolean): string | null => {
  if (isDirectory) return media;
  if (path.basename(media).toLowerCase() === "eboot.bin")
    return path.dirname(path.dirname(media));
  return null;
};

const readTrophyDirectory = async (directory: string): Promise<string[]> => {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      // Either layout can legitimately omit TROPDIR. Other read failures must
      // reach the provider so it retains the last valid snapshot.
      if (error.code === "ENOENT") return [];
      throw error;
    });
  return entries
    .filter(
      (entry) => entry.isDirectory() && RPCS3_TROPHY_SET_ID.test(entry.name)
    )
    .map((entry) => entry.name);
};

const findMediaTrophySetIds = async (media: string): Promise<string[]> => {
  const stat = await fs.stat(media);
  if (stat.isFile() && path.extname(media).toLowerCase() === ".iso")
    return extractTrophySetIdsFromIso(media);
  const root = getMediaRoot(media, stat.isDirectory());
  if (!root) return [];
  const sets = await mapWithConcurrency(
    [path.join(root, "TROPDIR"), path.join(root, "PS3_GAME", "TROPDIR")],
    TROPHY_DISCOVERY_READ_CONCURRENCY,
    readTrophyDirectory
  );
  // A directory disappearing during discovery is not an empty catalogue.
  await fs.stat(root);
  return sets.flat();
};

export const findGameTrophySetIds = async (
  game: Pick<Game, "discs" | "selectedDiscPath">
): Promise<string[]> => {
  const sets = await mapWithConcurrency(
    getGameTrophyMediaPaths(game),
    TROPHY_DISCOVERY_READ_CONCURRENCY,
    findMediaTrophySetIds
  );
  return [...new Set(sets.flat())].sort((left, right) =>
    left.localeCompare(right)
  );
};

const readActiveTrophyUser = (settings: string): string | null => {
  let section = "";
  for (const line of settings.split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]/.exec(line);
    if (heading) section = heading[1].toLowerCase();
    const match = /^\s*active_user\s*=\s*"?(\d{1,8})"?\s*$/.exec(line);
    if (section === "users" && match) return match[1].padStart(8, "0");
  }
  return null;
};

/** An explicit active user wins. Only fall back when there is exactly one local user. */
export const resolveTrophyUser = async (
  configRoot: string,
  homeRoot: string
): Promise<string | null> => {
  const settings = await fs
    .readFile(
      path.join(configRoot, "GuiConfigs", "persistent_settings.dat"),
      "utf8"
    )
    .catch(() => "");
  const activeUser = readActiveTrophyUser(settings);
  if (activeUser) {
    const directory = await fs
      .stat(path.join(homeRoot, activeUser))
      .catch(() => null);
    return directory?.isDirectory() ? activeUser : null;
  }
  const users = (
    await fs.readdir(homeRoot, { withFileTypes: true }).catch(() => [])
  ).filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name));
  return users.length === 1 ? users[0].name : null;
};
