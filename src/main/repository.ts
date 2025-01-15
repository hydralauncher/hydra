import { dataSource } from "./data-source";
import {
  DownloadQueue,
  Game,
  GameShopCache,
  UserPreferences,
  GameAchievement,
} from "@main/entity";

export const gameRepository = dataSource.getRepository(Game);

export const userPreferencesRepository =
  dataSource.getRepository(UserPreferences);

export const gameShopCacheRepository = dataSource.getRepository(GameShopCache);

export const downloadQueueRepository = dataSource.getRepository(DownloadQueue);

export const gameAchievementRepository =
  dataSource.getRepository(GameAchievement);
