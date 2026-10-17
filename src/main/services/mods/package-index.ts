import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { logger } from "../logger";
import { modsCachePath } from "./paths";
import type {
  ModSearchOptions,
  ModSearchResult,
  ThunderstorePackage,
} from "../../../types/mods.types";

const REFRESH_AFTER_MS = 60 * 60 * 1000;
const UA = { "User-Agent": "HydraLauncher-ModManager" };

interface CacheEntry {
  community: string;
  fetchedAt: number;
  etag: string | null;
  lastModified: string | null;
  packages: ThunderstorePackage[];
}

const memory = new Map<
  string,
  CacheEntry & { map: Map<string, ThunderstorePackage> }
>();
const inflight = new Map<string, Promise<void>>();

const fileFor = (community: string) =>
  path.join(modsCachePath, `${community.replace(/[^a-z0-9_-]/gi, "_")}.json`);

const slim = (raw: any[]): ThunderstorePackage[] =>
  raw
    .filter((p) => Array.isArray(p?.versions) && p.versions.length > 0)
    .map((p) => {
      const latest = p.versions[0];
      return {
        fullName: p.full_name,
        owner: p.owner,
        name: p.name,
        description: latest.description ?? "",
        icon: latest.icon ?? "",
        rating: p.rating_score ?? 0,
        downloads: p.versions.reduce(
          (sum: number, v: any) => sum + (v.downloads ?? 0),
          0
        ),
        categories: p.categories ?? [],
        isDeprecated: !!p.is_deprecated,
        isNsfw: !!p.has_nsfw_content,
        dateUpdated: p.date_updated ?? latest.date_created ?? "",
        packageUrl: p.package_url ?? "",
        versions: p.versions.map((v: any) => ({
          version: v.version_number,
          dependencies: v.dependencies ?? [],
          downloadUrl: v.download_url,
          fileSize: v.file_size ?? 0,
        })),
      } satisfies ThunderstorePackage;
    });

const hydrate = (entry: CacheEntry) => {
  const map = new Map(entry.packages.map((p) => [p.fullName, p]));
  const full = { ...entry, map };
  memory.set(entry.community, full);
  return full;
};

const loadFromDisk = async (community: string) => {
  try {
    const entry: CacheEntry = JSON.parse(
      await fs.promises.readFile(fileFor(community), "utf8")
    );
    return hydrate(entry);
  } catch {
    return null;
  }
};

const refresh = async (community: string) => {
  const existing = memory.get(community);
  const headers: Record<string, string> = { ...UA };
  if (existing?.etag) headers["If-None-Match"] = existing.etag;
  if (existing?.lastModified)
    headers["If-Modified-Since"] = existing.lastModified;

  const response = await axios.get(
    `https://thunderstore.io/c/${encodeURIComponent(community)}/api/v1/package/`,
    {
      headers,
      timeout: 120_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
    }
  );

  if (response.status === 304 && existing) {
    existing.fetchedAt = Date.now();
    await persist(existing);
    return;
  }

  const entry: CacheEntry = {
    community,
    fetchedAt: Date.now(),
    etag: response.headers["etag"] ?? null,
    lastModified: response.headers["last-modified"] ?? null,
    packages: slim(Array.isArray(response.data) ? response.data : []),
  };
  hydrate(entry);
  await persist(entry);
};

const persist = async (entry: CacheEntry) => {
  const { packages, ...rest } = entry;
  await fs.promises.mkdir(modsCachePath, { recursive: true });
  await fs.promises.writeFile(
    fileFor(entry.community),
    JSON.stringify({ ...rest, packages })
  );
};

/** Returns the cached index, refreshing it in the background-safe way. */
export const getPackageIndex = async (community: string, force = false) => {
  let entry = memory.get(community) ?? (await loadFromDisk(community));
  const stale = !entry || Date.now() - entry.fetchedAt > REFRESH_AFTER_MS;

  if (force || stale) {
    let job = inflight.get(community);
    if (!job) {
      job = refresh(community).finally(() => inflight.delete(community));
      inflight.set(community, job);
    }
    try {
      await job;
    } catch (error) {
      logger.error(
        `Failed to refresh Thunderstore index (${community})`,
        error
      );
      if (!entry) throw error; // no cache to fall back to
    }
    entry = memory.get(community) ?? entry;
  }

  return entry!;
};

export const searchPackages = async (
  community: string,
  options: ModSearchOptions = {}
): Promise<ModSearchResult> => {
  const {
    query = "",
    sort = "downloads",
    page = 0,
    pageSize = 30,
    category,
    includeDeprecated = false,
    includeNsfw = false,
  } = options;

  const { packages } = await getPackageIndex(community);
  const q = query.trim().toLowerCase();

  const categories = new Set<string>();
  for (const p of packages) p.categories.forEach((c) => categories.add(c));

  let items = packages.filter((p) => {
    if (!includeDeprecated && p.isDeprecated) return false;
    if (!includeNsfw && p.isNsfw) return false;
    if (category && !p.categories.includes(category)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.owner.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  });

  const sorters: Record<
    string,
    (a: ThunderstorePackage, b: ThunderstorePackage) => number
  > = {
    downloads: (a, b) => b.downloads - a.downloads,
    rating: (a, b) => b.rating - a.rating,
    updated: (a, b) => b.dateUpdated.localeCompare(a.dateUpdated),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  items = [...items].sort(sorters[sort] ?? sorters.downloads);

  return {
    total: items.length,
    items: items.slice(page * pageSize, (page + 1) * pageSize),
    categories: [...categories].sort(),
  };
};
