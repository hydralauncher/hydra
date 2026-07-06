import { AchievementSort, ComparedAchievements, UserAchievement } from "@types";

type ComparedAchievement = ComparedAchievements["achievements"][number];

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
  let diff = 0;

  const getUnlockTime = (achievement: UserAchievement | ComparedAchievement) =>
    isUserAchievement(achievement)
      ? Number(achievement.unlockTime)
      : Number(achievement.targetStat.unlockTime);

  const getPoints = (achievement: UserAchievement | ComparedAchievement) =>
    isUserAchievement(achievement) ? Number(achievement.points) : 0;

  if (sort === "date") {
    diff = getUnlockTime(b) - getUnlockTime(a);
  } else if (sort === "points") {
    diff = getPoints(a) - getPoints(b);
  } else if (sort === "name") {
    diff = a.displayName.localeCompare(b.displayName);
  } else if (sort === "default") {
    return 0;
  }

  if (diff !== 0) return diff;

  return a.displayName.localeCompare(b.displayName);
}
