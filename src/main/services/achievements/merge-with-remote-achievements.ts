import { HydraApi } from "../hydra-api";

export const mergeWithRemoteAchievements = async () => {
  return HydraApi.get("/profile/games/achievements").then(async (response) => {
    console.log(response);
  });
};
