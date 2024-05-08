import { Achievement, CheckedAchievements, Cracker } from "../types";

export const checkUnlockedAchievements = (
  type: Cracker,
  unlockedAchievements: any,
  achievements: Achievement[]
): CheckedAchievements => {
  if (type === Cracker.onlineFix)
    return onlineFixMerge(unlockedAchievements, achievements);
  if (type === Cracker.goldberg)
    return goldbergUnlockedAchievements(unlockedAchievements, achievements);
  return defaultMerge(unlockedAchievements, achievements);
};

const onlineFixMerge = (
  unlockedAchievements: any,
  achievements: Achievement[]
): CheckedAchievements => {
  const newUnlockedAchievements: Achievement[] = [];

  for (const achievement of achievements) {
    if (achievement.achieved) continue;

    const unlockedAchievement = unlockedAchievements[achievement.id];

    if (!unlockedAchievement) continue;

    achievement.achieved = Boolean(
      unlockedAchievement?.achieved ?? achievement.achieved
    );

    achievement.unlockTime =
      unlockedAchievement?.timestamp ?? achievement.unlockTime;

    if (achievement.achieved) {
      newUnlockedAchievements.push(achievement);
    }
  }

  return { all: achievements, new: newUnlockedAchievements };
};

const goldbergUnlockedAchievements = (
  unlockedAchievements: any,
  achievements: Achievement[]
): CheckedAchievements => {
  const newUnlockedAchievements: Achievement[] = [];

  for (const achievement of achievements) {
    if (achievement.achieved) continue;

    const unlockedAchievement = unlockedAchievements[achievement.id];

    if (!unlockedAchievement) continue;

    achievement.achieved = Boolean(
      unlockedAchievement?.earned ?? achievement.achieved
    );

    achievement.unlockTime =
      unlockedAchievement?.earned_time ?? achievement.unlockTime;

    if (achievement.achieved) {
      newUnlockedAchievements.push(achievement);
    }
  }
  return { all: achievements, new: newUnlockedAchievements };
};

const defaultMerge = (
  unlockedAchievements: any,
  achievements: Achievement[]
): CheckedAchievements => {
  const newUnlockedAchievements: Achievement[] = [];
  console.log("checkUnlockedAchievements");
  for (const achievement of achievements) {
    if (achievement.achieved) continue;

    const unlockedAchievement = unlockedAchievements[achievement.id];

    if (!unlockedAchievement) continue;

    achievement.achieved = Boolean(
      unlockedAchievement?.Achieved ?? achievement.achieved
    );

    achievement.curProgress =
      unlockedAchievement?.CurProgress ?? achievement.curProgress;

    achievement.maxProgress =
      unlockedAchievement?.MaxProgress ?? achievement.maxProgress;

    achievement.unlockTime =
      unlockedAchievement?.UnlockTime ?? achievement.unlockTime;

    if (achievement.achieved) {
      newUnlockedAchievements.push(achievement);
    }
  }
  console.log("newUnlocked: ", newUnlockedAchievements);
  return { all: achievements, new: newUnlockedAchievements };
};
