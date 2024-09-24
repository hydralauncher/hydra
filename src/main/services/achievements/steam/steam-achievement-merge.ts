import { Achievement, AchievementInfo, AchievementPercentage } from "../types";

export const steamAchievementMerge = (
  achievementPercentage: AchievementPercentage[],
  achievementInfo: AchievementInfo[]
): Achievement[] | undefined => {
  if (achievementPercentage.length > achievementInfo.length) return;

  const size = achievementPercentage.length;

  const achievements: Achievement[] = new Array(size);

  for (let i = 0; i < size; i++) {
    achievements[i] = {
      id: achievementPercentage[i].name,
      percent: achievementPercentage[i].percent,
      imageUrl: achievementInfo[i].imageUrl,
      title: achievementInfo[i].title,
      description: achievementInfo[i].description,
      achieved: false,
      curProgress: 0,
      maxProgress: 0,
      unlockTime: 0,
    };
  }

  return achievements;
};
