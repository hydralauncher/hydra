import { gameAchievementRepository } from "@main/repository";
import { UnlockedAchievement } from "./types";

export const mergeAchievements = async (
  objectId: string,
  shop: string,
  achievements: UnlockedAchievement[]
) => {
  const localGameAchievement = await gameAchievementRepository.findOne({
    where: {
      objectId,
      shop,
    },
  });

  const unlockedAchievements = JSON.parse(
    localGameAchievement?.unlockedAchievements || "[]"
  );

  console.log("file achievemets:", achievements);
  const newAchievements = achievements.filter((achievement) => {
    return !unlockedAchievements.some((localAchievement) => {
      return localAchievement.name === achievement.name;
    });
  });

  const mergedAchievements = unlockedAchievements.concat(newAchievements);

  console.log("merged achievemetns", mergedAchievements);
  gameAchievementRepository.upsert(
    {
      objectId,
      shop,
      unlockedAchievements: JSON.stringify(mergedAchievements),
    },
    ["objectId", "shop"]
  );

  // return HydraApi.get("/profile/games/achievements").then(async (response) => {
  //   console.log(response);
  // });

  // if (game.remoteId) {
  //   HydraApi.put("/profile/games/achievements", {
  //     id: game.remoteId,
  //     achievements: unlockedAchievements,
  //   }).catch(() => {
  //     console.log("erro");
  //   });
  // }
};
