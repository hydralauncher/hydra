import { AchievementSort, ComparedAchievements, UserAchievement } from "@types";

type ComparedAchievement = ComparedAchievements["achievements"][number];

const COMPARATOR_EQUAL = 0;
const DEFAULT_POINTS = 0;
const COMPARED_ACHIEVEMENT_POINTS = 0;

function isUserAchievement(
  achievement: UserAchievement | ComparedAchievement
): achievement is UserAchievement {
  return "unlockTime" in achievement;
}

export function sorter(
  a: UserAchievement | ComparedAchievement,
  b: UserAchievement | ComparedAchievement,
  sort?: AchievementSort
) {
  let diff = COMPARATOR_EQUAL;

  const getUnlockTime = (achievement: UserAchievement | ComparedAchievement) =>
    isUserAchievement(achievement)
      ? Number(achievement.unlockTime)
      : Number(
          achievement.ownerStat?.unlockTime ?? achievement.targetStat.unlockTime
        );

  const getPoints = (achievement: UserAchievement | ComparedAchievement) =>
    isUserAchievement(achievement)
      ? Number(achievement.points ?? DEFAULT_POINTS)
      : COMPARED_ACHIEVEMENT_POINTS;

  if (sort === "date") {
    diff = getUnlockTime(b) - getUnlockTime(a);
  } else if (sort === "easiest_first") {
    diff = getPoints(a) - getPoints(b);
  } else if (sort === "name") {
    diff = a.displayName.localeCompare(b.displayName);
  } else if (sort === "default") {
    return COMPARATOR_EQUAL;
  }

  if (diff !== COMPARATOR_EQUAL) return diff;

  return a.displayName.localeCompare(b.displayName);
}
