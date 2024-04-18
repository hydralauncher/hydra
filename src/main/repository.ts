import { dataSource } from "./data-source";
import {
  Game,
  GameShopCache,
  ImageCache,
  Repack,
  RepackerFriendlyName,
  UserPreferences,
  MigrationScript,
} from "@main/entity";

export const gameRepository = dataSource.getRepository(Game);

export const imageCacheRepository = dataSource.getRepository(ImageCache);

export const repackRepository = dataSource.getRepository(Repack);

export const repackerFriendlyNameRepository =
  dataSource.getRepository(RepackerFriendlyName);

export const userPreferencesRepository =
  dataSource.getRepository(UserPreferences);

export const gameShopCacheRepository = dataSource.getRepository(GameShopCache);

export const migrationScriptRepository =
  dataSource.getRepository(MigrationScript);
