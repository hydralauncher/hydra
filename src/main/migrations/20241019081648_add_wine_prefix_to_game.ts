import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddWinePrefixToGame: HydraMigration = {
  name: "AddWinePrefixToGame",
  up: (knex: Knex) => {
    return knex.schema.alterTable("game", (table) => {
      return table.text("winePrefixPath").nullable();
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("game", (table) => {
      return table.dropColumn("winePrefixPath");
    });
  },
};
