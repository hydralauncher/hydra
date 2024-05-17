import { DataSource } from "typeorm";
import {
  Game,
  GameShopCache,
  Repack,
  UserPreferences,
  SteamGame,
} from "@main/entity";
import type { SqliteConnectionOptions } from "typeorm/driver/sqlite/SqliteConnectionOptions";

import { databasePath } from "./constants";
import migrations from "./migrations";

export const createDataSource = (options: Partial<SqliteConnectionOptions>) =>
  new DataSource({
    type: "better-sqlite3",
    database: databasePath,
    entities: [Game, Repack, UserPreferences, GameShopCache, SteamGame],
    synchronize: true,
    ...options,
  });

export const dataSource = createDataSource({
  migrations: migrations,
});
