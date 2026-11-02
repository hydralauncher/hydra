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
import { UnlockedAchievementsCache } from "@main/services/achievements/unlocked-achievements-cache";
import { CombinedAchievementsRequests } from "@main/services/achievements/combined-achievements-requests";
import { AchievementSouvenirStore } from "@main/services/achievements/achievement-souvenir-store";
import { fetchRemoteUserGameAchievements } from "@main/services/achievements/get-achievement-souvenirs";
import { mergeUnlockedAchievementLists } from "@main/services/achievements/merge-unlocked-achievements";
import {
  createCombinedDefinitionLookup,
  presentCombinedAchievements,
  type CombinedAchievements,
} from "@main/services/achievements/combined-achievement-presentation";

const COMBINED_ACHIEVEMENTS_TIMEOUT_MS = 5_000;

const indexByUpperCaseName = <T extends { name: string }>(items: T[]) => {
  const byName = new Map<string, T>();
  for (const item of items) {
    const key = item.name.toUpperCase();
    if (!byName.has(key)) byName.set(key, item);
  }
  return byName;
};

const captureAchievementView = (shop: GameShop, objectId: string) => {
  const context = HydraApi.getAuthContext();
  return achievementSyncCoordinator.captureCurrent(
    levelKeys.game(shop, objectId),
    () =>
      context
        ? HydraApi.isAuthContextCurrent(context)
        : HydraApi.getAuthContext() === null
  );
};

export const getUnlockedAchievements = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean,
  current?: () => boolean
): Promise<UserAchievement[]> => {
  const valid = current ?? captureAchievementView(shop, objectId);
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
    const language = userPreferences?.language ?? "en";
    const combined = await CombinedAchievementsRequests.fetch(
      HydraApi.getAuthContext(),
      shop,
      objectId,
      language,
      () =>
        HydraApi.get<CombinedAchievements>(
          "/profile/achievements/combined",
          { shop, objectId, language },
          { timeout: COMBINED_ACHIEVEMENTS_TIMEOUT_MS }
        )
    );
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
      UnlockedAchievementsCache.recordCombinedMembers(
        shop,
        objectId,
        combined.achievements.flatMap((achievement) => achievement.variants)
      );
      return presentCombinedAchievements(
        combined,
        (sourceShop, sourceObjectId) =>
          AchievementMemoryStore.get(sourceShop, sourceObjectId)
            ?.unlockedAchievements ?? [],
        createCombinedDefinitionLookup((sourceShop, sourceObjectId) =>
          sourceShop === shop && sourceObjectId === objectId
            ? achievementsData
            : (AchievementMemoryStore.get(sourceShop, sourceObjectId)
                ?.achievements ?? [])
        )
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
  const unlockedByName = indexByUpperCaseName(unlockedAchievements);
  const remoteByName = indexByUpperCaseName(remote.achievements);

  return catalogueAchievements
    .map((achievementData) => {
      const upperCaseName = achievementData.name.toUpperCase();
      const unlockedAchievementData = unlockedByName.get(upperCaseName);

      const icongray = achievementData.icongray.endsWith("/")
        ? achievementData.icon
        : achievementData.icongray;

      if (unlockedAchievementData) {
        const remoteAchievement = remoteByName.get(upperCaseName);

        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchievementData.unlockTime,
          source: remoteAchievement?.source,
          unlockedOn: remoteAchievement?.unlockedOn,
          imageUrl: souvenirs.get(upperCaseName) ?? null,
        };
      }

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icongray: icongray,
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

export const syncAndGetUnlockedAchievements = (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> =>
  UnlockedAchievementsCache.load(
    shop,
    objectId,
    captureAchievementView(shop, objectId),
    () => AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId),
    () => getUnlockedAchievements(objectId, shop, false)
  );

const getUnlockedAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  return syncAndGetUnlockedAchievements(objectId, shop);
};

registerEvent("getUnlockedAchievements", getUnlockedAchievementsEvent);
