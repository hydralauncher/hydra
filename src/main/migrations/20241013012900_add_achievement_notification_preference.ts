import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddAchievementNotificationPreference: HydraMigration = {
  name: "AddAchievementNotificationPreference",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.boolean("achievementNotificationsEnabled").defaultTo(true);
    });
  },

  down: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.dropColumn("achievementNotificationsEnabled");
    });
  },
};
