import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddLaunchOptionsColumnToGame: HydraMigration = {
  name: "AddLaunchOptionsColumnToGame",
  up: (knex: Knex) => {
    return knex.schema.alterTable("game", (table) => {
      return table.string("launchOptions").nullable();
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("game", (table) => {
      return table.dropColumn("launchOptions");
    });
  },
};
