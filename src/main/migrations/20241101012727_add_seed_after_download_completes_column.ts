import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddSeedAfterDownloadCompletesColumn: HydraMigration = {
  name: "AddSeedAfterDownloadCompletesColumn",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table
        .boolean("seedAfterDownloadCompletes")
        .notNullable()
        .defaultTo(1);
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.dropColumn("seedAfterDownloadCompletes");
    });
  },
};
