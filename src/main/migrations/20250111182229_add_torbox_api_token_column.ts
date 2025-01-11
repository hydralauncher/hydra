import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddTorBoxApiToken: HydraMigration = {
  name: "AddTorBoxApiToken",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.string("torBoxApiToken").nullable();
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.dropColumn("torBoxApiToken");
    });
  },
};
