import { DataSource } from "typeorm";
import {
  DownloadQueue,
  Game,
  GameShopCache,
  UserPreferences,
  GameAchievement,
} from "@main/entity";

import { databasePath } from "./constants";

export const dataSource = new DataSource({
  type: "better-sqlite3",
  entities: [
    Game,
    UserPreferences,
    GameShopCache,
    DownloadQueue,
    GameAchievement,
  ],
  synchronize: false,
  database: databasePath,
});
