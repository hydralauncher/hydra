import { DataSource } from "typeorm";
import {
  Game,
  GameShopCache,
  ImageCache,
  Repack,
  RepackerFriendlyName,
  UserPreferences,
  MigrationScript,
  SteamGame,
} from "@main/entity";
import type { SqliteConnectionOptions } from "typeorm/driver/sqlite/SqliteConnectionOptions";

import { databasePath } from "./constants";

export const createDataSource = (options: Partial<SqliteConnectionOptions>) =>
  new DataSource({
    type: "better-sqlite3",
    database: databasePath,
    entities: [
      Game,
      ImageCache,
      Repack,
      RepackerFriendlyName,
      UserPreferences,
      GameShopCache,
      MigrationScript,
      SteamGame,
    ],
    ...options,
  });

export const dataSource = createDataSource({
  synchronize: true,
});
