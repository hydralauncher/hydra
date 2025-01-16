import { dataSource } from "./data-source";
import { DownloadQueue, Game, UserPreferences } from "@main/entity";

export const gameRepository = dataSource.getRepository(Game);

export const userPreferencesRepository =
  dataSource.getRepository(UserPreferences);

export const downloadQueueRepository = dataSource.getRepository(DownloadQueue);
