import { gameAchievementRepository, gameRepository } from "@main/repository";
import { UnlockedAchievement } from "./types";
import { publishNewAchievementNotification } from "../notifications";
import { GameShop } from "@types";

export const mergeAchievements = async (
  objectId: string,
  shop: string,
  achievements: UnlockedAchievement[]
) => {
  const game = await gameRepository.findOne({
    where: { objectID: objectId, shop: shop as GameShop },
  });

  const localGameAchievement = await gameAchievementRepository.findOne({
    where: {
      objectId,
      shop,
    },
  });

  const unlockedAchievements = JSON.parse(
    localGameAchievement?.unlockedAchievements || "[]"
  );

  const newAchievements = achievements.filter((achievement) => {
    return !unlockedAchievements.some((localAchievement) => {
      return localAchievement.name === achievement.name;
    });
  });

  for (const achievement of newAchievements) {
    const completeAchievement = JSON.parse(
      localGameAchievement?.achievements || "[]"
    ).find((steamAchievement) => {
      return achievement.name === steamAchievement.name;
    });

    if (completeAchievement) {
      publishNewAchievementNotification(
        game?.title || " ",
        completeAchievement.displayName,
        completeAchievement.icon
      );
    }
  }

  const mergedAchievements = unlockedAchievements.concat(newAchievements);

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
