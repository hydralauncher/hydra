import { DataSource } from "typeorm";
import {
  DownloadQueue,
  Game,
  GameShopCache,
  UserPreferences,
  UserAuth,
  GameAchievement,
  UserSubscription,
} from "@main/entity";

import { databasePath } from "./constants";

export const dataSource = new DataSource({
  type: "better-sqlite3",
  entities: [
    Game,
    UserAuth,
    UserPreferences,
    UserSubscription,
    GameShopCache,
    DownloadQueue,
    GameAchievement,
  ],
  synchronize: false,
  database: databasePath,
});
