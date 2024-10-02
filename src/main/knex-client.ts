import knex, { Knex } from "knex";
import { databasePath } from "./constants";
import { Hydra2_0_3 } from "./migrations/20240830143811_Hydra_2_0_3";
import { RepackUris } from "./migrations/20240830143906_RepackUris";
import { UpdateUserLanguage } from "./migrations/20240913213944_update_user_language";
import { EnsureRepackUris } from "./migrations/20240915035339_ensure_repack_uris";
import { app } from "electron";
import { FixMissingColumns } from "./migrations/20240918001920_FixMissingColumns";
import { CreateGameAchievement } from "./migrations/20240919030940_create_game_achievement";

export type HydraMigration = Knex.Migration & { name: string };

class MigrationSource implements Knex.MigrationSource<HydraMigration> {
  getMigrations(): Promise<HydraMigration[]> {
    return Promise.resolve([
      Hydra2_0_3,
      RepackUris,
      UpdateUserLanguage,
      EnsureRepackUris,
      FixMissingColumns,
      CreateGameAchievement,
    ]);
  }
  getMigrationName(migration: HydraMigration): string {
    return migration.name;
  }
  getMigration(migration: HydraMigration): Promise<Knex.Migration> {
    return Promise.resolve(migration);
  }
}

export const knexClient = knex({
  debug: !app.isPackaged,
  client: "better-sqlite3",
  connection: {
    filename: databasePath,
  },
});

export const migrationConfig: Knex.MigratorConfig = {
  migrationSource: new MigrationSource(),
};
