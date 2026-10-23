import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { logger } from "../logger";
import { modsCachePath } from "./paths";
import type { ThunderstoreCommunity } from "../../../types/mods.types";

const ECOSYSTEM_URL =
  "https://thunderstore.io/api/experimental/schema/dev/latest/";
const COMMUNITY_LIST_URL =
  "https://thunderstore.io/api/experimental/community/";
const TTL_MS = 24 * 60 * 60 * 1000;
const UA = { "User-Agent": "HydraLauncher-ModManager" };

export interface EcosystemGame extends ThunderstoreCommunity {
  steamIds: string[];
  packageLoader: string | null;
}

let memory: { at: number; games: EcosystemGame[] } | null = null;
const cacheFile = path.join(modsCachePath, "ecosystem.json");

/**
 * The ecosystem schema is "experimental" on Thunderstore's side, so every
 * field is read defensively and unknown shapes are skipped, not thrown on.
 */
export const parseEcosystem = (raw: any): EcosystemGame[] => {
  const games = raw?.games;
  if (!games || typeof games !== "object") return [];

  return Object.entries<any>(games).map(([identifier, game]) => {
    const distributions: any[] = Array.isArray(game?.distributions)
      ? game.distributions
      : [];
    const steamIds = distributions
      .filter(
        (d) =>
          typeof d?.platform === "string" &&
          d.platform.toLowerCase().startsWith("steam") &&
          d.identifier
      )
      .map((d) => String(d.identifier));

    const r2 = Array.isArray(game?.r2modman) ? game.r2modman[0] : undefined;

    return {
      identifier,
      name: game?.meta?.displayName ?? game?.label ?? identifier,
      steamIds,
      packageLoader: r2?.packageLoader ?? null,
    };
  });
};

const readDisk = async (): Promise<typeof memory> => {
  try {
    const stat = await fs.promises.stat(cacheFile);
    const games = JSON.parse(await fs.promises.readFile(cacheFile, "utf8"));
    return { at: stat.mtimeMs, games };
  } catch {
    return null;
  }
};

const fallbackFromCommunityList = async (): Promise<EcosystemGame[]> => {
  const out: EcosystemGame[] = [];
  let url: string | null = COMMUNITY_LIST_URL;
  while (url && out.length < 2000) {
    const { data } = await axios.get(url, { headers: UA, timeout: 20_000 });
    for (const c of data?.results ?? []) {
      out.push({
        identifier: c.identifier,
        name: c.name ?? c.identifier,
        steamIds: [],
        packageLoader: null,
      });
    }
    url = data?.pagination?.next_link ?? null;
  }
  return out;
};

export const getEcosystem = async (force = false): Promise<EcosystemGame[]> => {
  if (!force && memory && Date.now() - memory.at < TTL_MS) return memory.games;

  if (!force) {
    const disk = await readDisk();
    if (disk && Date.now() - disk.at < TTL_MS) {
      memory = disk;
      return disk.games;
    }
  }

  try {
    const { data } = await axios.get(ECOSYSTEM_URL, {
      headers: UA,
      timeout: 30_000,
    });
    let games = parseEcosystem(data);
    if (games.length === 0) games = await fallbackFromCommunityList();

    memory = { at: Date.now(), games };
    await fs.promises.mkdir(modsCachePath, { recursive: true });
    await fs.promises.writeFile(cacheFile, JSON.stringify(games));
    return games;
  } catch (error) {
    logger.error("Failed to fetch Thunderstore ecosystem", error);
    const stale = memory ?? (await readDisk());
    if (stale) return stale.games;
    throw error;
  }
};

export const findGameBySteamId = async (
  steamId: string
): Promise<EcosystemGame | null> => {
  const games = await getEcosystem();
  return games.find((g) => g.steamIds.includes(String(steamId))) ?? null;
};

/** Fuzzy fallback for non-Steam games: exact normalised-title match only. */
export const findGameByTitle = async (
  title: string
): Promise<EcosystemGame | null> => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = norm(title);
  if (!wanted) return null;
  const games = await getEcosystem();
  return games.find((g) => norm(g.name) === wanted) ?? null;
};
