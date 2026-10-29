import type {
  AchievementSet,
  ComparedAchievements,
  UserAchievement,
} from "@types";

export interface AchievementSetGroup<T> {
  key: string;
  set: AchievementSet | null;
  achievements: T[];
}

const NO_SET_KEY = "none";

export const getAchievementSetKey = (achievement: {
  set?: AchievementSet | null;
}) => (achievement.set ? String(achievement.set.id) : NO_SET_KEY);

export const groupAchievementsBySet = <
  T extends { set?: AchievementSet | null },
>(
  achievements: T[]
): AchievementSetGroup<T>[] | null => {
  const groups = new Map<string, AchievementSetGroup<T>>();

  for (const achievement of achievements) {
    const key = getAchievementSetKey(achievement);
    const group = groups.get(key);
    if (group) {
      group.achievements.push(achievement);
    } else {
      groups.set(key, {
        key,
        set: achievement.set ?? null,
        achievements: [achievement],
      });
    }
  }

  const sets = [...groups.values()].filter((group) => group.set !== null);
  if (sets.length < 2) return null;

  sets.sort((a, b) => a.set!.order - b.set!.order || a.set!.id - b.set!.id);
  const withoutSet = groups.get(NO_SET_KEY);

  return withoutSet ? [...sets, withoutSet] : sets;
};

export interface VisibleAchievementSetGroup<T> {
  key: string;
  set: AchievementSet | null;
  totalCount: number;
  unlockedCount: number;
  achievements: T[];
}

export const getVisibleSetGroups = <
  T extends { set?: AchievementSet | null; unlocked: boolean },
>(
  setGroups: AchievementSetGroup<T>[],
  visible: T[]
): VisibleAchievementSetGroup<T>[] => {
  const visibleByKey = new Map<string, T[]>();
  for (const achievement of visible) {
    const key = getAchievementSetKey(achievement);
    const group = visibleByKey.get(key);
    if (group) {
      group.push(achievement);
    } else {
      visibleByKey.set(key, [achievement]);
    }
  }

  return setGroups
    .map((group) => ({
      key: group.key,
      set: group.set,
      totalCount: group.achievements.length,
      unlockedCount: group.achievements.filter(
        (achievement) => achievement.unlocked
      ).length,
      achievements: visibleByKey.get(group.key) ?? [],
    }))
    .filter((group) => group.achievements.length > 0);
};

export type AchievementListEntry<T> =
  | { type: "set"; group: VisibleAchievementSetGroup<T>; expanded: boolean }
  | { type: "achievement"; achievement: T };

export const buildAchievementListEntries = <T>(
  setGroups: VisibleAchievementSetGroup<T>[] | null,
  visible: T[],
  collapsedSetKeys: ReadonlySet<string>
): AchievementListEntry<T>[] => {
  if (!setGroups) {
    return visible.map((achievement) => ({ type: "achievement", achievement }));
  }

  return setGroups.flatMap((group): AchievementListEntry<T>[] => {
    const expanded = !collapsedSetKeys.has(group.key);
    const header: AchievementListEntry<T> = { type: "set", group, expanded };

    if (!expanded) return [header];

    return [
      header,
      ...group.achievements.map(
        (achievement): AchievementListEntry<T> => ({
          type: "achievement",
          achievement,
        })
      ),
    ];
  });
};

export const toggleSetKey = (current: ReadonlySet<string>, key: string) => {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
};

export const getAchievementKey = (
  achievement: Pick<UserAchievement, "name" | "canonicalAchievementId">
) => achievement.canonicalAchievementId ?? achievement.name;

export type AchievementSortOption =
  | "most_common"
  | "most_rare"
  | "recently_unlocked";

export type AchievementStatusFilter = "all" | "unlocked" | "locked";

type ListableAchievement = Pick<
  UserAchievement,
  | "name"
  | "displayName"
  | "description"
  | "hidden"
  | "unlocked"
  | "points"
  | "globalUnlockPercentage"
> &
  Partial<Pick<UserAchievement, "unlockTime">>;

export type AchievementComparisonFilter =
  | "all"
  | "both"
  | "neither"
  | "owner"
  | "target";

export interface AchievementComparisonUnlocks {
  ownerUnlocked: boolean;
  targetUnlocked: boolean;
}

export const matchesAchievementComparisonFilter = (
  { ownerUnlocked, targetUnlocked }: AchievementComparisonUnlocks,
  filter: AchievementComparisonFilter
) => {
  if (filter === "both") return ownerUnlocked && targetUnlocked;
  if (filter === "neither") return !ownerUnlocked && !targetUnlocked;
  if (filter === "owner") return ownerUnlocked;
  if (filter === "target") return targetUnlocked;
  return true;
};

const COMPARISON_FILTERS: AchievementComparisonFilter[] = [
  "all",
  "both",
  "neither",
  "owner",
  "target",
];

export const getAchievementComparisonCounts = (
  achievements: AchievementComparisonUnlocks[]
) =>
  Object.fromEntries(
    COMPARISON_FILTERS.map((filter) => [
      filter,
      achievements.filter((achievement) =>
        matchesAchievementComparisonFilter(achievement, filter)
      ).length,
    ])
  ) as Record<AchievementComparisonFilter, number>;

export const getComparedTargetAchievements = (
  compared: Pick<ComparedAchievements, "achievements">
): UserAchievement[] =>
  compared.achievements.map((achievement, index) => ({
    name: String(index),
    displayName: achievement.displayName,
    description: achievement.description,
    icon: achievement.icon,
    icongray: achievement.icon,
    hidden: achievement.hidden,
    points: achievement.points,
    globalUnlockPercentage: achievement.globalUnlockPercentage,
    set: achievement.set ?? null,
    unlocked: achievement.targetStat.unlocked,
    unlockTime: achievement.targetStat.unlocked
      ? achievement.targetStat.unlockTime
      : null,
    hardcoreUnlockTime: achievement.targetStat.unlocked
      ? (achievement.targetStat.hardcoreUnlockTime ?? null)
      : null,
  }));

export const getComparedOwnerUnlockedNames = (
  compared: Pick<ComparedAchievements, "achievements">
): Set<string> =>
  new Set(
    compared.achievements.flatMap((achievement, index) =>
      achievement.ownerStat?.unlocked ? [String(index)] : []
    )
  );

export interface AchievementListOptions<
  T extends ListableAchievement = ListableAchievement,
> {
  search: string;
  status: AchievementStatusFilter;
  sort: AchievementSortOption;
  isConcealed: (achievement: T) => boolean;
}

export const isAchievementConcealed = (
  achievement: Pick<UserAchievement, "hidden" | "unlocked">,
  showHiddenAchievements: boolean
) => achievement.hidden && !achievement.unlocked && !showHiddenAchievements;

export const getAchievementRarityScore = (
  achievement: Pick<UserAchievement, "points" | "globalUnlockPercentage">
) => {
  if (typeof achievement.globalUnlockPercentage === "number") {
    return 100 - achievement.globalUnlockPercentage;
  }

  return null;
};

const getAchievementPointsScore = (
  achievement: Pick<UserAchievement, "points">
) => (typeof achievement.points === "number" ? achievement.points : null);

const MIN_DISPLAYED_UNLOCK_PERCENTAGE = 0.1;

export const formatAchievementUnlockPercentage = (
  percentage: number,
  locale?: string
) => {
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  });

  if (percentage > 0 && percentage < MIN_DISPLAYED_UNLOCK_PERCENTAGE) {
    return `<${formatter.format(MIN_DISPLAYED_UNLOCK_PERCENTAGE)}%`;
  }

  return `${formatter.format(percentage)}%`;
};

export const formatAchievementUnlockDateTime = (
  value: number | Date | string,
  language: string
) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  try {
    const day = new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const time = new Intl.DateTimeFormat(language, {
      timeStyle: "short",
    }).format(date);

    return `${day} · ${time}`;
  } catch {
    return "";
  }
};

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLowerCase();

const matchesSearch = (
  achievement: ListableAchievement,
  normalizedSearch: string,
  isConcealed: boolean
) => {
  if (!normalizedSearch) return true;
  if (isConcealed) return false;

  return [achievement.displayName, achievement.description ?? ""].some((text) =>
    normalizeSearchText(text).includes(normalizedSearch)
  );
};

const matchesStatus = (
  achievement: ListableAchievement,
  status: AchievementStatusFilter
) => {
  if (status === "unlocked") return achievement.unlocked;
  if (status === "locked") return !achievement.unlocked;
  return true;
};

type RarityScore = (achievement: ListableAchievement) => number | null;

const getAchievementRarityScorer = (
  achievements: Pick<UserAchievement, "globalUnlockPercentage">[]
): RarityScore =>
  achievements.some(
    (achievement) => typeof achievement.globalUnlockPercentage === "number"
  )
    ? getAchievementRarityScore
    : getAchievementPointsScore;

const compareScores = (
  aScore: number | null,
  bScore: number | null,
  sort: AchievementSortOption
) => {
  if (aScore === null && bScore === null) return 0;
  if (aScore === null) return 1;
  if (bScore === null) return -1;

  return sort === "most_rare" ? bScore - aScore : aScore - bScore;
};

const compareByRarity = (
  a: ListableAchievement,
  b: ListableAchievement,
  sort: AchievementSortOption,
  getScore: RarityScore
) =>
  compareScores(getScore(a), getScore(b), sort) ||
  compareScores(
    getAchievementPointsScore(a),
    getAchievementPointsScore(b),
    sort
  );

const compareByUnlockTime = (
  a: ListableAchievement,
  b: ListableAchievement,
  getScore: RarityScore
) => {
  if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
  if (!a.unlocked) return compareByRarity(a, b, "most_common", getScore);

  return (b.unlockTime ?? 0) - (a.unlockTime ?? 0);
};

export const getAchievementStatusCounts = (
  achievements: Pick<UserAchievement, "unlocked">[]
): Record<AchievementStatusFilter, number> => {
  const unlocked = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  return {
    all: achievements.length,
    unlocked,
    locked: achievements.length - unlocked,
  };
};

export const filterAndSortAchievements = <T extends ListableAchievement>(
  achievements: T[],
  { search, status, sort, isConcealed }: AchievementListOptions<T>
): T[] => {
  const normalizedSearch = normalizeSearchText(search.trim());
  const getScore = getAchievementRarityScorer(achievements);

  const visible = achievements.filter(
    (achievement) =>
      matchesStatus(achievement, status) &&
      matchesSearch(achievement, normalizedSearch, isConcealed(achievement))
  );
  visible.sort((a, b) =>
    sort === "recently_unlocked"
      ? compareByUnlockTime(a, b, getScore)
      : compareByRarity(a, b, sort, getScore)
  );

  return visible;
};
