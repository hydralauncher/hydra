import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddSeedListTable: HydraMigration = {
  name: "AddSeedListTable",
  up: (knex: Knex) => {
    return knex.schema.createTable("seed_list", async (table) => {
      table.increments("id").primary();
      table.text("downloadUri").notNullable();
      table.boolean("shouldSeed").defaultTo(false);
      table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
      table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.dropTable("seed_list");
  },
};
