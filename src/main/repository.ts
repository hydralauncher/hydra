import { dataSource } from "./data-source";
import {
  Game,
  GameShopCache,
  Repack,
  RepackerFriendlyName,
  UserPreferences,
  MigrationScript,
  SteamGame,
} from "@main/entity";

export const gameRepository = dataSource.getRepository(Game);

export const repackRepository = dataSource.getRepository(Repack);

export const repackerFriendlyNameRepository =
  dataSource.getRepository(RepackerFriendlyName);

export const userPreferencesRepository =
  dataSource.getRepository(UserPreferences);

export const gameShopCacheRepository = dataSource.getRepository(GameShopCache);

export const migrationScriptRepository =
  dataSource.getRepository(MigrationScript);

export const steamGameRepository = dataSource.getRepository(SteamGame);
