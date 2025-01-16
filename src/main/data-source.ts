import { DataSource } from "typeorm";
import { DownloadQueue, Game, UserPreferences } from "@main/entity";

import { databasePath } from "./constants";

export const dataSource = new DataSource({
  type: "better-sqlite3",
  entities: [Game, UserPreferences, DownloadQueue],
  synchronize: false,
  database: databasePath,
});
