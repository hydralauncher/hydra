import { logger } from "@main/services";
import { AchievementPercentage } from "../types";

interface GlobalAchievementPercentages {
  achievementpercentages: {
    achievements: Array<AchievementPercentage>;
  };
}

export const steamGlobalAchievementPercentages = async (
  objectId: string
): Promise<AchievementPercentage[] | undefined> => {
  const fetchUrl = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${objectId}`;

  const achievementPercentages: Array<AchievementPercentage> | undefined = (
    await fetch(fetchUrl, {
      method: "GET",
    })
      .then((res) => {
        if (res.status === 200) return res.json();
        return;
      })
      .then((data: GlobalAchievementPercentages) => data)
      .catch((err) => {
        logger.error(err, { method: "getSteamGameAchievements" });
        return;
      })
  )?.achievementpercentages.achievements;

  if (!achievementPercentages) return;

  return achievementPercentages;
};
