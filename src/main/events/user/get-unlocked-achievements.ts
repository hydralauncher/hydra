import { HydraApi } from "@main/services/hydra-api";
import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
} from "@main/services/achievements/achievement-sync-coordinator";
import type { GameShop, UserAchievement, UserPreferences } from "@types";
import { registerEvent } from "../register-event";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { AchievementSouvenirStore } from "@main/services/achievements/achievement-souvenir-store";
import { fetchRemoteUserGameAchievements } from "@main/services/achievements/get-achievement-souvenirs";
import { mergeUnlockedAchievementLists } from "@main/services/achievements/merge-unlocked-achievements";
import {
  presentCombinedAchievements,
  type CombinedAchievements,
} from "@main/services/achievements/combined-achievement-presentation";

const COMBINED_ACHIEVEMENTS_TIMEOUT_MS = 5_000;

export const getUnlockedAchievements = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean,
  current?: () => boolean
): Promise<UserAchievement[]> => {
  const context = HydraApi.getAuthContext();
  const valid =
    current ??
    achievementSyncCoordinator.captureCurrent(
      levelKeys.game(shop, objectId),
      () =>
        context
          ? HydraApi.isAuthContextCurrent(context)
          : HydraApi.getAuthContext() === null
    );
  const assertCurrent = () => {
    if (!valid()) throw new AchievementSyncCancelledError();
  };

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  assertCurrent();

  const showHiddenAchievementsDescription =
    userPreferences?.showHiddenAchievementsDescription || false;

  const achievementsData = await getGameAchievementData(
    objectId,
    shop,
    useCachedData,
    valid
  );

  assertCurrent();

  if (!useCachedData) AchievementSouvenirStore.invalidate(shop, objectId);

  const remote = await fetchRemoteUserGameAchievements(
    objectId,
    shop,
    userPreferences?.language ?? "en"
  ).catch(() => ({
    unavailable: true,
    souvenirs: new Map<string, string>(),
    unlocked: [],
    achievements: [],
  }));

  assertCurrent();

  AchievementSouvenirStore.set(shop, objectId, remote.souvenirs);

  const unlockedAchievements =
    shop === "epic" && !("unavailable" in remote)
      ? remote.unlocked
      : mergeUnlockedAchievementLists(
          remote.unlocked,
          AchievementMemoryStore.get(shop, objectId)?.unlockedAchievements ?? []
        );

  const stored = AchievementMemoryStore.get(shop, objectId);
  if (stored) {
    AchievementMemoryStore.set(shop, objectId, {
      ...stored,
      unlockedAchievements,
    });
  }

  let catalogueAchievements =
    achievementsData.length > 0
      ? achievementsData
      : remote.achievements.map((achievement) => ({
          name: achievement.name,
          displayName: achievement.displayName || achievement.name,
          description: achievement.description,
          icon: achievement.icon || "",
          icongray: achievement.icongray || achievement.icon || "",
          hidden: Boolean(achievement.hidden),
        }));

  const souvenirs = remote.souvenirs;

  // Preserve the selected copy's catalogue/cache refresh and sync side effects.
  // The union is a display projection and must never replace that source state.
  if (shop === "steam" || shop === "epic") {
    const combined = await HydraApi.get<CombinedAchievements>(
      "/profile/achievements/combined",
      { shop, objectId, language: userPreferences?.language ?? "en" },
      { timeout: COMBINED_ACHIEVEMENTS_TIMEOUT_MS }
    ).catch(() => null);
    const includesRequestedCopy = combined?.achievements.some((achievement) =>
      achievement.variants.some(
        (variant) => variant.shop === shop && variant.objectId === objectId
      )
    );
    // An empty copy contributes no variants. Confirm its canonical membership
    // separately, without hiding any selected-source catalogue or local unlocks.
    const emptyCopyInGroup =
      !includesRequestedCopy &&
      combined?.canonicalId &&
      catalogueAchievements.length === 0 &&
      unlockedAchievements.length === 0 &&
      (
        await gamesSublevel
          .get(levelKeys.game(shop, objectId))
          .catch(() => undefined)
      )?.canonicalId === combined.canonicalId;
    assertCurrent();
    if (
      combined?.achievements.length &&
      (includesRequestedCopy || emptyCopyInGroup)
    ) {
      return presentCombinedAchievements(
        combined,
        (sourceShop, sourceObjectId) =>
          AchievementMemoryStore.get(sourceShop, sourceObjectId)
            ?.unlockedAchievements ?? [],
        showHiddenAchievementsDescription
      );
    }
  }

  // Catalogue definitions are display-only: never copy their unlocks, souvenirs or cache.
  if (shop === "epic" && achievementsData.length === 0) {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined);
    assertCurrent();
    const catalogue = game?.catalogueGame;
    if (catalogue?.shop === "steam") {
      const steamDefinitions = await getGameAchievementData(
        catalogue.objectId,
        catalogue.shop,
        true
      ).catch(() => []);
      assertCurrent();
      if (steamDefinitions.length > 0) catalogueAchievements = steamDefinitions;
    }
  }
  return catalogueAchievements
    .map((achievementData) => {
      const unlockedAchievementData = unlockedAchievements.find(
        (localAchievement) => {
          return (
            localAchievement.name.toUpperCase() ==
            achievementData.name.toUpperCase()
          );
        }
      );

      const icongray = achievementData.icongray.endsWith("/")
        ? achievementData.icon
        : achievementData.icongray;

      if (unlockedAchievementData) {
        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchievementData.unlockTime,
          source: remote.achievements.find(
            (item) =>
              item.name.toUpperCase() === achievementData.name.toUpperCase()
          )?.source,
          unlockedOn: remote.achievements.find(
            (item) =>
              item.name.toUpperCase() === achievementData.name.toUpperCase()
          )?.unlockedOn,
          imageUrl: souvenirs.get(achievementData.name.toUpperCase()) ?? null,
        };
      }

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icongray: icongray,
        description:
          !achievementData.hidden || showHiddenAchievementsDescription
            ? achievementData.description
            : undefined,
      };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      if (a.unlocked && b.unlocked) {
        return b.unlockTime! - a.unlockTime!;
      }
      return Number(a.hidden) - Number(b.hidden);
    });
};

export const syncAndGetUnlockedAchievements = async (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  await AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId);
  return getUnlockedAchievements(objectId, shop, false);
};

const getUnlockedAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  return syncAndGetUnlockedAchievements(objectId, shop);
};

registerEvent("getUnlockedAchievements", getUnlockedAchievementsEvent);
