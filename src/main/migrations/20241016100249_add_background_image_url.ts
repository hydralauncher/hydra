import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddBackgroundImageUrl: HydraMigration = {
  name: "AddBackgroundImageUrl",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_auth", (table) => {
      return table.text("backgroundImageUrl").nullable();
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("user_auth", (table) => {
      return table.dropColumn("backgroundImageUrl");
    });
  },
};
