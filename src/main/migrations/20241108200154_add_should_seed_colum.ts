import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddShouldSeedColumn: HydraMigration = {
  name: "AddShouldSeedColumn",
  up: (knex: Knex) => {
    return knex.schema.alterTable("game", (table) => {
      return table.boolean("shouldSeed").notNullable().defaultTo(false);
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("game", (table) => {
      return table.dropColumn("shouldSeed");
    });
  },
};
