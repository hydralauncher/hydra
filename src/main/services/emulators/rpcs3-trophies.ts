import { promises as fs } from "node:fs";
import path from "node:path";

import type { Game, SteamAchievement, UnlockedAchievement } from "@types";

import {
  resolveRpcs3ConfigRootStatus,
  validateRpcs3ConfigRoot,
} from "../cloud-save/rpcs3-config-root.js";
import { rpcs3TitleIdsForGame } from "../cloud-save/rpcs3-title-ids.js";
import { rpcs3ConfigRoots } from "./emulator-config.js";
import { listIsoPs3TrophyDirNames } from "./verified-ps3-iso-title-id.js";

const TROPUSR_MAGIC = 0x818f54ad;
const TROPUSR_HEADER_SIZE = 0x30;
const TROPUSR_TABLE_HEADER_SIZE = 0x20;
const TROPUSR_ENTRY_HEADER_SIZE = 0x10;
const TROPUSR_STATE_TABLE_TYPE = 6;
const TROPUSR_STATE_ENTRY_MIN_SIZE = 0x20;
const RTC_TICKS_PER_MS = 1000n;
const RTC_EPOCH_OFFSET_MS = 62_135_596_800_000n;
const NP_COMM_ID_RE = /^NPWR\d{5}_\d{2}$/i;
const NP_COMM_ID_PATH_SEGMENT_RE = /\/(NPWR\d{5}_\d{2})\//i;
const TROPHY_ICON_RE = /\/(NPWR\d{5}_\d{2})\/(\d+)(?:_lock)?\.\w+(?:[?#].*)?$/i;
const TROPHY_ID_RE = /^\d+$/;
const RPCS3_USER_ID_RE = /^\d{8}$/;
const TROPUSR_FILE = "TROPUSR.DAT";

const rtcTickToUnixMs = (tick: bigint): number | null => {
  const unixMs = tick / RTC_TICKS_PER_MS - RTC_EPOCH_OFFSET_MS;
  return unixMs > 0n ? Number(unixMs) : null;
};

export const parseRpcs3TropUsr = (
  data: Buffer,
  fallbackUnlockTime: number
): UnlockedAchievement[] | null => {
  if (data.length < TROPUSR_HEADER_SIZE) return null;
  if (data.readUInt32BE(0) !== TROPUSR_MAGIC) return null;

  const tableCount = data.readUInt32BE(8);
  const tablesEnd =
    TROPUSR_HEADER_SIZE + tableCount * TROPUSR_TABLE_HEADER_SIZE;
  if (data.length < tablesEnd) return null;

  for (let table = 0; table < tableCount; table++) {
    const header = TROPUSR_HEADER_SIZE + table * TROPUSR_TABLE_HEADER_SIZE;
    if (data.readUInt32BE(header) !== TROPUSR_STATE_TABLE_TYPE) continue;

    const entrySize = data.readUInt32BE(header + 4);
    const entryCount = data.readUInt32BE(header + 12);
    const offset = Number(data.readBigUInt64BE(header + 16));
    const stride = TROPUSR_ENTRY_HEADER_SIZE + entrySize;
    if (entrySize < TROPUSR_STATE_ENTRY_MIN_SIZE) return null;
    if (offset + entryCount * stride > data.length) return null;

    const unlocked: UnlockedAchievement[] = [];
    for (let entry = 0; entry < entryCount; entry++) {
      const contents = offset + entry * stride + TROPUSR_ENTRY_HEADER_SIZE;
      if (data.readUInt32BE(contents + 4) === 0) continue;

      unlocked.push({
        name: String(data.readUInt32BE(contents)),
        unlockTime:
          rtcTickToUnixMs(data.readBigUInt64BE(contents + 16)) ??
          fallbackUnlockTime,
      });
    }
    return unlocked;
  }

  return null;
};

export const resolveRpcs3HomeRoots = async (
  executablePath: string | null,
  selectedRoot: string | null | undefined
): Promise<string[]> => {
  const { location } = await resolveRpcs3ConfigRootStatus(
    executablePath,
    selectedRoot
  );
  if (location) return [location.homeRoot];
  if (selectedRoot) return [];

  const locations = await Promise.all(
    rpcs3ConfigRoots(executablePath).map((root) =>
      validateRpcs3ConfigRoot(root)
    )
  );
  return [
    ...new Set(
      locations.flatMap((candidate) => (candidate ? [candidate.homeRoot] : []))
    ),
  ];
};

const listDirectoryNames = async (directory: string): Promise<string[]> => {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map(({ name }) => name);
};

const listDiscTrophyDirNames = async (discPath: string): Promise<string[]> => {
  const stats = await fs.stat(discPath).catch(() => null);
  if (!stats) return [];

  if (stats.isFile() && discPath.toLowerCase().endsWith(".iso")) {
    return listIsoPs3TrophyDirNames(discPath);
  }

  const candidates = stats.isDirectory()
    ? [
        path.join(discPath, "PS3_GAME", "TROPDIR"),
        path.join(discPath, "TROPDIR"),
      ]
    : [path.join(path.dirname(path.dirname(discPath)), "TROPDIR")];

  return (await Promise.all(candidates.map(listDirectoryNames))).flat();
};

export const resolveRpcs3NpCommIds = async (
  game: Game,
  discPaths: string[],
  homeRoots: string[]
): Promise<string[]> => {
  const installedTropDirs = homeRoots.flatMap((homeRoot) =>
    rpcs3TitleIdsForGame(game).map((titleId) =>
      path.join(path.dirname(homeRoot), "game", titleId, "TROPDIR")
    )
  );

  const names = await Promise.all([
    ...discPaths.map(listDiscTrophyDirNames),
    ...installedTropDirs.map(listDirectoryNames),
  ]);

  return [
    ...new Set(
      names
        .flat()
        .filter((name) => NP_COMM_ID_RE.test(name))
        .map((name) => name.toUpperCase())
    ),
  ];
};

type CatalogueTrophy = Pick<
  SteamAchievement,
  "name" | "icon" | "icongray" | "externalSetId" | "externalId"
>;

const trophyKey = (npCommId: string, id: string) =>
  `${npCommId.toUpperCase()}/${Number(id)}`;

const catalogueTrophyKey = (trophy: CatalogueTrophy): string | null => {
  const { externalSetId, externalId } = trophy;
  if (
    externalSetId &&
    NP_COMM_ID_RE.test(externalSetId) &&
    externalId &&
    TROPHY_ID_RE.test(externalId)
  ) {
    return trophyKey(externalSetId, externalId);
  }

  for (const url of [trophy.icon, trophy.icongray]) {
    const match = url ? TROPHY_ICON_RE.exec(url) : null;
    if (match) return trophyKey(match[1], match[2]);
  }
  return null;
};

export const npCommIdsFromCatalogue = (
  catalogue: Pick<SteamAchievement, "icon" | "icongray" | "externalSetId">[]
): string[] => [
  ...new Set(
    catalogue.flatMap(({ icon, icongray, externalSetId }) => {
      if (externalSetId && NP_COMM_ID_RE.test(externalSetId)) {
        return [externalSetId.toUpperCase()];
      }
      return [icon, icongray].flatMap((url) => {
        const match = url ? NP_COMM_ID_PATH_SEGMENT_RE.exec(url) : null;
        return match ? [match[1].toUpperCase()] : [];
      });
    })
  ),
];

export const pickRpcs3TrophySets = (
  catalogueSetIds: string[],
  discSetIds: string[]
): Record<string, string> => {
  const identity = (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, id]));

  if (!catalogueSetIds.length) {
    return discSetIds.length === 1 ? identity(discSetIds) : {};
  }
  if (!discSetIds.length) return identity(catalogueSetIds);

  const shared = discSetIds.filter((id) => catalogueSetIds.includes(id));
  if (shared.length) return identity(shared);

  if (catalogueSetIds.length === 1 && discSetIds.length === 1) {
    return { [discSetIds[0]]: catalogueSetIds[0] };
  }
  return {};
};

export const listRpcs3TropUsrFiles = async (
  homeRoots: string[],
  npCommIds: string[]
): Promise<string[]> => {
  const candidates = (
    await Promise.all(
      homeRoots.map(async (homeRoot) =>
        (await listDirectoryNames(homeRoot))
          .filter((userId) => RPCS3_USER_ID_RE.test(userId))
          .flatMap((userId) =>
            npCommIds.map((npCommId) =>
              path.join(homeRoot, userId, "trophy", npCommId, TROPUSR_FILE)
            )
          )
      )
    )
  ).flat();

  const existing = await Promise.all(
    candidates.map(async (file) =>
      (await fs.stat(file).catch(() => null))?.isFile() ? file : null
    )
  );
  return existing.filter((file): file is string => file !== null).sort();
};

export interface Rpcs3TrophyUnlock {
  npCommId: string;
  id: string;
  unlockTime: number;
}

const npCommIdOfTropUsr = (file: string) =>
  path.basename(path.dirname(file)).toUpperCase();

export const readRpcs3UnlockedTrophies = async (
  files: string[]
): Promise<Rpcs3TrophyUnlock[] | null> => {
  const unlockLists = await Promise.all(
    files.map(async (file) => {
      const [data, stats] = await Promise.all([
        fs.readFile(file).catch(() => null),
        fs.stat(file).catch(() => null),
      ]);
      const unlocked =
        data && stats ? parseRpcs3TropUsr(data, stats.mtimeMs) : null;
      return unlocked?.map(({ name, unlockTime }) => ({
        npCommId: npCommIdOfTropUsr(file),
        id: name,
        unlockTime,
      }));
    })
  );
  if (unlockLists.some((unlocked) => !unlocked)) return null;

  const earliest = new Map<string, Rpcs3TrophyUnlock>();
  for (const trophy of (unlockLists as Rpcs3TrophyUnlock[][]).flat()) {
    const key = trophyKey(trophy.npCommId, trophy.id);
    const known = earliest.get(key);
    if (!known || trophy.unlockTime < known.unlockTime) {
      earliest.set(key, trophy);
    }
  }
  return [...earliest.values()];
};

export const matchRpcs3UnlocksToCatalogue = (
  unlocks: Rpcs3TrophyUnlock[],
  catalogue: CatalogueTrophy[],
  catalogueSetIds: Record<string, string>
): UnlockedAchievement[] => {
  const namesByKey = new Map<string, string>();
  const namesById = new Map<string, string>();
  for (const trophy of catalogue) {
    const key = catalogueTrophyKey(trophy);
    if (key) namesByKey.set(key, trophy.name);
    else if (TROPHY_ID_RE.test(trophy.name)) {
      namesById.set(String(Number(trophy.name)), trophy.name);
    }
  }
  const readSets = new Set(unlocks.map(({ npCommId }) => npCommId));

  const findName = ({ npCommId, id }: Rpcs3TrophyUnlock) => {
    const catalogueSetId = catalogueSetIds[npCommId];
    if (!catalogueSetId) return undefined;
    if (namesByKey.size) return namesByKey.get(trophyKey(catalogueSetId, id));
    return readSets.size === 1 ? namesById.get(String(Number(id))) : undefined;
  };

  const earliest = new Map<string, UnlockedAchievement>();
  for (const unlock of unlocks) {
    const name = findName(unlock);
    if (!name) continue;
    const known = earliest.get(name);
    if (!known || unlock.unlockTime < known.unlockTime) {
      earliest.set(name, { name, unlockTime: unlock.unlockTime });
    }
  }
  return [...earliest.values()];
};
