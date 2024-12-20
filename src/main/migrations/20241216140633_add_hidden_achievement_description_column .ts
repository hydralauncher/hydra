import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddHiddenAchievementDescriptionColumn: HydraMigration = {
  name: "AddHiddenAchievementDescriptionColumn",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table
        .boolean("showHiddenAchievementsDescription")
        .notNullable()
        .defaultTo(0);
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.dropColumn("showHiddenAchievementsDescription");
    });
  },
};
