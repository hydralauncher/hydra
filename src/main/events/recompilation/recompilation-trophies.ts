import type { UnlockedAchievement } from "@types";

export type RecompilationTrophyKind =
  | "bitmask"
  | "earned-json"
  | "id-time-lines"
  | "jsonl"
  | "log";

type TrophyPlatform = "win32" | "linux";

export interface RecompilationTrophySource {
  kind: RecompilationTrophyKind;
  path: Partial<Record<TrophyPlatform, string>>;
  history?: string[];
  grantPlatinum?: boolean;
  /** Other files the port keeps its trophies in, cleared on a reset. */
  resetFiles?: Partial<Record<TrophyPlatform, string[]>>;
}

export const PLATINUM_TROPHY = "0";

const BITMASK_BYTES = 16;
const ID_TIME_LINE = /^\s*(\d+)\s+(\d+)\s*$/;
const LOG_LINE = /Runtime: trophy (\d+)(?: \(platinum\))? unlocked/;

export const getTrophySourcePath = (
  source: RecompilationTrophySource,
  platform: NodeJS.Platform
) => source.path[platform as TrophyPlatform] ?? null;

const keepEarliest = (
  unlocks: Map<string, number>,
  id: number,
  unlockTime: number
) => {
  const name = String(id);
  const known = unlocks.get(name);
  if (known === undefined || unlockTime < known) unlocks.set(name, unlockTime);
};

const toUnlockedAchievements = (unlocks: Map<string, number>) =>
  Array.from(unlocks, ([name, unlockTime]) => ({ name, unlockTime }));

export const parseTrophyBitmask = (
  data: Buffer,
  now = Date.now()
): UnlockedAchievement[] => {
  const unlocked: UnlockedAchievement[] = [];
  const bytes = data.subarray(0, BITMASK_BYTES);
  for (let id = 0; id < bytes.length * 8; id++) {
    if (bytes[id >> 3] & (1 << (id & 7))) {
      unlocked.push({ name: String(id), unlockTime: now });
    }
  }
  return unlocked;
};

export const parseTrophyIdTimeLines = (
  contents: string
): UnlockedAchievement[] => {
  const unlocks = new Map<string, number>();
  for (const line of contents.split("\n")) {
    const match = ID_TIME_LINE.exec(line);
    if (match) keepEarliest(unlocks, Number(match[1]), Number(match[2]) * 1000);
  }
  return toUnlockedAchievements(unlocks);
};

export const parseTrophyJsonLines = (
  contents: string
): UnlockedAchievement[] => {
  const unlocks = new Map<string, number>();
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        trophy_id?: unknown;
        unlocked_at?: unknown;
      };
      const unlockTime = Date.parse(String(event.unlocked_at));
      if (Number.isInteger(event.trophy_id) && !Number.isNaN(unlockTime)) {
        keepEarliest(unlocks, event.trophy_id as number, unlockTime);
      }
    } catch {
      continue;
    }
  }
  return toUnlockedAchievements(unlocks);
};

export const parseTrophyLogLines = (contents: string): number[] =>
  contents.split("\n").flatMap((line) => {
    const match = LOG_LINE.exec(line);
    return match ? [Number(match[1])] : [];
  });

/** A bitmask with no trophy unlocked. */
export const emptyTrophyBitmask = () => Buffer.alloc(BITMASK_BYTES);

/** The log without its trophy lines; every other line stays as it was. */
export const stripTrophyLogLines = (contents: string) =>
  contents
    .split("\n")
    .filter((line) => !LOG_LINE.test(line))
    .join("\n");

export const keepCatalogueTrophies = (
  unlocks: UnlockedAchievement[],
  catalogueNames: string[]
) => {
  const names = new Set(catalogueNames.map((name) => name.toUpperCase()));
  return unlocks.filter((unlock) => names.has(unlock.name.toUpperCase()));
};

export const withHydraPlatinum = (
  unlocks: UnlockedAchievement[],
  catalogueNames: string[],
  alreadyUnlocked: UnlockedAchievement[]
): UnlockedAchievement[] => {
  if (!catalogueNames.includes(PLATINUM_TROPHY)) return unlocks;

  const unlocked = new Set(
    [...alreadyUnlocked, ...unlocks].map((unlock) => unlock.name)
  );
  if (unlocked.has(PLATINUM_TROPHY)) return unlocks;

  const others = catalogueNames.filter((name) => name !== PLATINUM_TROPHY);
  if (!others.length || !others.every((name) => unlocked.has(name))) {
    return unlocks;
  }

  const unlockTime = Math.max(
    ...[...alreadyUnlocked, ...unlocks].map((unlock) => unlock.unlockTime)
  );
  return [...unlocks, { name: PLATINUM_TROPHY, unlockTime }];
};

const toIdSet = (ids: Iterable<string>) =>
  new Set([...ids].map((id) => id.trim().toUpperCase()));

/** The bitmask with these trophies cleared; its length is kept. */
export const removeTrophiesFromBitmask = (
  data: Buffer,
  ids: Iterable<string>
) => {
  const output = Buffer.from(data);
  for (const id of toIdSet(ids)) {
    const bit = Number(id);
    if (!Number.isInteger(bit) || bit < 0 || bit >= BITMASK_BYTES * 8) {
      continue;
    }
    output[bit >> 3] &= ~(1 << (bit & 7));
  }
  return output;
};

/** "<id> <unix time>" lines without these trophies. */
export const removeTrophiesFromIdTimeLines = (
  contents: string,
  ids: Iterable<string>
) => {
  const remove = toIdSet(ids);
  return contents
    .split("\n")
    .filter((line) => {
      const match = ID_TIME_LINE.exec(line);
      return !match || !remove.has(match[1]);
    })
    .join("\n");
};

/** JSON lines without the events of these trophies. */
export const removeTrophiesFromJsonLines = (
  contents: string,
  ids: Iterable<string>
) => {
  const remove = toIdSet(ids);
  return contents
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return true;
      try {
        const event = JSON.parse(line) as { trophy_id?: unknown };
        return !remove.has(String(event.trophy_id).toUpperCase());
      } catch {
        return true;
      }
    })
    .join("\n");
};

/** One-id-per-line lists (bbport's unlocked.txt) without these trophies. */
export const removeTrophiesFromIdLines = (
  contents: string,
  ids: Iterable<string>
) => {
  const remove = toIdSet(ids);
  return contents
    .split("\n")
    .filter((line) => !remove.has(line.trim().toUpperCase()))
    .join("\n");
};

interface EarnedLedger {
  earned?: Array<{ id?: unknown; time?: unknown }>;
  [key: string]: unknown;
}

const parseEarnedLedger = (contents: string): EarnedLedger | null => {
  try {
    const ledger = JSON.parse(contents) as EarnedLedger;
    return ledger && typeof ledger === "object" && Array.isArray(ledger.earned)
      ? ledger
      : null;
  } catch {
    return null;
  }
};

export const parseTrophyEarnedJson = (
  contents: string
): UnlockedAchievement[] => {
  const unlocks = new Map<string, number>();
  for (const entry of parseEarnedLedger(contents)?.earned ?? []) {
    if (Number.isInteger(entry.id) && typeof entry.time === "number") {
      keepEarliest(unlocks, entry.id as number, entry.time * 1000);
    }
  }
  return toUnlockedAchievements(unlocks);
};

export const removeTrophiesFromEarnedJson = (
  contents: string,
  ids: Iterable<string>
) => {
  const ledger = parseEarnedLedger(contents);
  if (!ledger) return contents;
  const remove = toIdSet(ids);
  const earned = ledger.earned!.filter(
    (entry) => !remove.has(String(entry.id).toUpperCase())
  );
  if (earned.length === ledger.earned!.length) return contents;
  return `${JSON.stringify({ ...ledger, earned }, null, 2)}\n`;
};
