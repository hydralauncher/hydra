import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { ScreenshotService } from "@main/services/screenshot";
import { AchievementSouvenirStore } from "@main/services/achievements/achievement-souvenir-store";
import { achievementsLogger } from "@main/services/logger";

interface DeleteAchievementSouvenirPayload {
  gameId: string;
  achievementName: string;
  gameTitle: string | null;
  achievementDisplayName: string;
}

const deleteAchievementSouvenir = async (
  _event: Electron.IpcMainInvokeEvent,
  {
    gameId,
    achievementName,
    gameTitle,
    achievementDisplayName,
  }: DeleteAchievementSouvenirPayload
) => {
  await HydraApi.delete(
    `/profile/games/achievements/${gameId}/${encodeURIComponent(achievementName)}/image`
  );

  AchievementSouvenirStore.clear();

  if (!gameTitle) return;

  await ScreenshotService.deleteGameScreenshot(
    gameTitle,
    achievementDisplayName
  ).catch((error) => {
    achievementsLogger.error(
      "Failed to delete local achievement souvenir",
      gameTitle,
      achievementDisplayName,
      error
    );
  });
};

registerEvent("deleteAchievementSouvenir", deleteAchievementSouvenir);
