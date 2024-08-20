import { DataSource } from "typeorm";
import {
  DownloadQueue,
  DownloadSource,
  Game,
  GameShopCache,
  Repack,
  UserPreferences,
  UserAuth,
} from "@main/entity";
import type { BetterSqlite3ConnectionOptions } from "typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions";

import { databasePath } from "./constants";
import migrations from "./migrations";

export const createDataSource = (
  options: Partial<BetterSqlite3ConnectionOptions>
) =>
  new DataSource({
    type: "better-sqlite3",
    entities: [
      Game,
      Repack,
      UserPreferences,
      GameShopCache,
      DownloadSource,
      DownloadQueue,
      UserAuth,
    ],
    synchronize: true,
    database: databasePath,
    ...options,
  });

export const dataSource = createDataSource({
  migrations,
});
