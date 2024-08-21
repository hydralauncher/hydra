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

import { databasePath } from "./constants";
import * as migrations from "./migrations";

export const dataSource = new DataSource({
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
  synchronize: false,
  database: databasePath,
  migrations,
});
