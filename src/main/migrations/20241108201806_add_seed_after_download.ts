import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddSeedAfterDownloadColumn: HydraMigration = {
  name: "AddSeedAfterDownloadColumn",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table
        .boolean("seedAfterDownloadComplete")
        .notNullable()
        .defaultTo(true);
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.dropColumn("seedAfterDownloadComplete");
    });
  },
};
