import knex, { Knex } from "knex";
import { databasePath } from "./constants";
import { Hydra2_0_3 } from "./migrations/20240830143811_Hydra_2_0_3";
import { RepackUris } from "./migrations/20240830143906_RepackUris";
import { UpdateUserLanguage } from "./migrations/20240913213944_update_user_language";
import { EnsureRepackUris } from "./migrations/20240915035339_ensure_repack_uris";
import { app } from "electron";
import { FixMissingColumns } from "./migrations/20240918001920_FixMissingColumns";
import { CreateGameAchievement } from "./migrations/20240919030940_create_game_achievement";
import { AddAchievementNotificationPreference } from "./migrations/20241013012900_add_achievement_notification_preference";
import { CreateUserSubscription } from "./migrations/20241015235142_create_user_subscription";
import { AddBackgroundImageUrl } from "./migrations/20241016100249_add_background_image_url";
import { AddWinePrefixToGame } from "./migrations/20241019081648_add_wine_prefix_to_game";
import { AddStartMinimizedColumn } from "./migrations/20241030171454_add_start_minimized_column";
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
      AddAchievementNotificationPreference,
      CreateUserSubscription,
      AddBackgroundImageUrl,
      AddWinePrefixToGame,
      AddStartMinimizedColumn,
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
