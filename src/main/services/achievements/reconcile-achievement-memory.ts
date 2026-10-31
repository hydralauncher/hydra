import type { UpdatedUnlockedAchievements } from "@types";
import { WindowManager } from "../window-manager";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { mergeUnlockedAchievementLists } from "./merge-unlocked-achievements";
import { UnlockedAchievementsCache } from "./unlocked-achievements-cache";

export const reconcileAchievementMemory = async (
  response: UpdatedUnlockedAchievements,
  current: () => boolean
) => {
  if (!current()) return;
  const stored = AchievementMemoryStore.get(response.shop, response.objectId);
  AchievementMemoryStore.set(response.shop, response.objectId, {
    achievements: stored?.achievements ?? [],
    unlockedAchievements: mergeUnlockedAchievementLists(
      response.achievements,
      stored?.unlockedAchievements ?? []
    ),
    language: stored?.language,
    catalogueValidator: stored?.catalogueValidator,
  });
  const since = UnlockedAchievementsCache.invalidate(
    response.shop,
    response.objectId
  );

  const { getUnlockedAchievements } = await import(
    "@main/events/user/get-unlocked-achievements"
  );
  const achievements = await getUnlockedAchievements(
    response.objectId,
    response.shop,
    true,
    current
  ).catch(() => null);

  if (achievements && current()) {
    UnlockedAchievementsCache.set(
      response.shop,
      response.objectId,
      achievements,
      current,
      since
    );
    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${response.objectId}-${response.shop}`,
      achievements
    );
  }
};
