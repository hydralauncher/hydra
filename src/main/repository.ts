import { dataSource } from "./data-source";
import {
  DownloadQueue,
  DownloadSource,
  Game,
  GameShopCache,
  Repack,
  UserPreferences,
  UserAuth,
  client,
} from "@main/entity";

export const gameRepository = dataSource.getRepository(Game);

export const repackRepository = dataSource.getRepository(Repack);

export const userPreferencesClientRepository = dataSource.getRepository(client);

export const userPreferencesRepository =
  dataSource.getRepository(UserPreferences);

export const userClientPreferencesRepository =
  dataSource.getRepository(client);

export const gameShopCacheRepository = dataSource.getRepository(GameShopCache);

export const downloadSourceRepository =
  dataSource.getRepository(DownloadSource);

export const downloadQueueRepository = dataSource.getRepository(DownloadQueue);

export const userAuthRepository = dataSource.getRepository(UserAuth);
