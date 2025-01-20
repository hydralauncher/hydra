import { DataSource } from "typeorm";
import { UserPreferences } from "@main/entity";

import { databasePath } from "./constants";

export const dataSource = new DataSource({
  type: "better-sqlite3",
  entities: [UserPreferences],
  synchronize: false,
  database: databasePath,
});
