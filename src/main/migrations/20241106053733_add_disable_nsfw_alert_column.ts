import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddDisableNsfwAlertColumn: HydraMigration = {
  name: "AddDisableNsfwAlertColumn",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.boolean("disableNsfwAlert").notNullable().defaultTo(0);
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.dropColumn("disableNsfwAlert");
    });
  },
};
