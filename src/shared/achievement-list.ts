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

  const ordered = sets.sort(
    (a, b) => a.set!.order - b.set!.order || a.set!.id - b.set!.id
  );
  const withoutSet = groups.get(NO_SET_KEY);

  return withoutSet ? [...ordered, withoutSet] : ordered;
};

export type AchievementSortOption = "most_common" | "most_rare";

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
>;

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

export interface AchievementListOptions {
  search: string;
  status: AchievementStatusFilter;
  sort: AchievementSortOption;
  isConcealed: (achievement: ListableAchievement) => boolean;
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

export const formatAchievementUnlockPercentage = (
  percentage: number,
  locale?: string
) => {
  if (percentage > 0 && percentage < 0.1) return "<0.1%";

  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(percentage)}%`;
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

const compareByRarity = (
  a: ListableAchievement,
  b: ListableAchievement,
  sort: AchievementSortOption
) => {
  const hasPercentages =
    getAchievementRarityScore(a) !== null &&
    getAchievementRarityScore(b) !== null;
  const getScore = hasPercentages
    ? getAchievementRarityScore
    : getAchievementPointsScore;
  const aScore = getScore(a);
  const bScore = getScore(b);

  if (aScore === null && bScore === null) return 0;
  if (aScore === null) return 1;
  if (bScore === null) return -1;

  return sort === "most_rare" ? bScore - aScore : aScore - bScore;
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
  { search, status, sort, isConcealed }: AchievementListOptions
): T[] => {
  const normalizedSearch = normalizeSearchText(search.trim());

  return achievements
    .filter(
      (achievement) =>
        matchesStatus(achievement, status) &&
        matchesSearch(achievement, normalizedSearch, isConcealed(achievement))
    )
    .sort((a, b) => compareByRarity(a, b, sort));
};
