import { DataSource } from "typeorm";
import { Game, GameShopCache, Repack, UserPreferences } from "@main/entity";
import type { BetterSqlite3ConnectionOptions } from "typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions";

import { databasePath } from "./constants";
import migrations from "./migrations";

export const createDataSource = (
  options: Partial<BetterSqlite3ConnectionOptions>
) =>
  new DataSource({
    type: "better-sqlite3",
    entities: [Game, Repack, UserPreferences, GameShopCache],
    synchronize: true,
    database: databasePath,
    ...options,
  });

export const dataSource = createDataSource({
  migrations,
});
