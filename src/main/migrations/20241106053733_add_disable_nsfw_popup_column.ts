import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddDisableNsfwPopupColumn: HydraMigration = {
  name: "AddDisableNsfwPopupColumn",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.boolean("disableNsfwPopup").notNullable().defaultTo(0);
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.dropColumn("disableNsfwPopup");
    });
  },
};
