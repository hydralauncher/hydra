import { DataSource } from "typeorm";
import {
  DownloadQueue,
  DownloadSource,
  Game,
  GameShopCache,
  Repack,
  UserPreferences,
  UserAuth,
  GameAchievement,
  UserSubscription,
  SeedList,
} from "@main/entity";

import { databasePath } from "./constants";

export const dataSource = new DataSource({
  type: "better-sqlite3",
  entities: [
    Game,
    Repack,
    UserAuth,
    UserPreferences,
    UserSubscription,
    GameShopCache,
    DownloadSource,
    DownloadQueue,
    GameAchievement,
    SeedList,
  ],
  synchronize: false,
  database: databasePath,
});
