import { dataSource } from "./data-source";
import {
  DownloadQueue,
  DownloadSource,
  Game,
  GameShopCache,
  Repack,
  UserPreferences,
  UserAuth,
  GameAchievement,
  UserSubscription,
} from "@main/entity";

export const gameRepository = dataSource.getRepository(Game);

export const repackRepository = dataSource.getRepository(Repack);

export const userPreferencesRepository =
  dataSource.getRepository(UserPreferences);

export const gameShopCacheRepository = dataSource.getRepository(GameShopCache);

export const downloadSourceRepository =
  dataSource.getRepository(DownloadSource);

export const downloadQueueRepository = dataSource.getRepository(DownloadQueue);

export const userAuthRepository = dataSource.getRepository(UserAuth);

export const userSubscriptionRepository =
  dataSource.getRepository(UserSubscription);

export const gameAchievementRepository =
  dataSource.getRepository(GameAchievement);
