import { promises as fs } from "node:fs";
import path from "node:path";
import type { Game } from "@types";
import { extractTrophySetIdsFromIso } from "../../emulators/verified-ps3-iso-title-id.js";
import { RPCS3_TROPHY_SET_ID } from "./trophy-data.js";

export const findGameTrophySetIds = async (
  game: Pick<Game, "discs" | "selectedDiscPath">
): Promise<string[]> => {
  const paths = [
    ...new Set(
      [
        game.selectedDiscPath,
        ...(game.discs ?? []).map((disc) => disc.path),
      ].filter((item): item is string => Boolean(item))
    ),
  ];
  const ids = new Set<string>();
  for (const media of paths) {
    const stat = await fs.stat(media).catch(() => null);
    if (!stat) continue;
    if (stat.isFile() && path.extname(media).toLowerCase() === ".iso") {
      for (const id of await extractTrophySetIdsFromIso(media).catch(() => []))
        ids.add(id);
      continue;
    }
    const root = stat.isDirectory()
      ? media
      : path.basename(media).toLowerCase() === "eboot.bin"
        ? path.dirname(path.dirname(media))
        : null;
    if (!root) continue;
    for (const trophyDirectory of [
      path.join(root, "TROPDIR"),
      path.join(root, "PS3_GAME", "TROPDIR"),
    ]) {
      const entries = await fs
        .readdir(trophyDirectory, { withFileTypes: true })
        .catch(() => []);
      for (const entry of entries)
        if (entry.isDirectory() && RPCS3_TROPHY_SET_ID.test(entry.name))
          ids.add(entry.name);
    }
  }
  return [...ids].sort();
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
  let section = "";
  for (const line of settings.split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]/.exec(line);
    if (heading) section = heading[1].toLowerCase();
    const match = /^\s*active_user\s*=\s*"?(\d{1,8})"?\s*$/.exec(line);
    if (section === "users" && match) {
      const user = match[1].padStart(8, "0");
      return (
        await fs.stat(path.join(homeRoot, user)).catch(() => null)
      )?.isDirectory()
        ? user
        : null;
    }
  }
  const users = (
    await fs.readdir(homeRoot, { withFileTypes: true }).catch(() => [])
  ).filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name));
  return users.length === 1 ? users[0].name : null;
};
