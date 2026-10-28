import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { AchievementSouvenirStore } from "@main/services/achievements/achievement-souvenir-store";
import { UnlockedAchievementsCache } from "@main/services/achievements/unlocked-achievements-cache";
import { achievementsLogger } from "@main/services/logger";
import { deleteLocalSouvenirAsset } from "@main/services/achievements/grouped-souvenir-worker";
import { buildProfileSouvenirDeletePath } from "@shared";

interface DeleteAchievementSouvenirPayload {
  souvenirId: string;
}

const deleteAchievementSouvenir = async (
  _event: Electron.IpcMainInvokeEvent,
  { souvenirId }: DeleteAchievementSouvenirPayload
) => {
  await HydraApi.delete(buildProfileSouvenirDeletePath(souvenirId));

  AchievementSouvenirStore.clear();
  UnlockedAchievementsCache.clear();

  await deleteLocalSouvenirAsset(souvenirId).catch((error) => {
    achievementsLogger.error(
      "Failed to delete local achievement souvenir",
      souvenirId,
      error
    );
  });
};

registerEvent("deleteAchievementSouvenir", deleteAchievementSouvenir);
