import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const AddStartMinimizedColumn: HydraMigration = {
  name: "AddStartMinimizedColumn",
  up: (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.boolean("startMinimized").notNullable().defaultTo(0);
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.alterTable("user_preferences", (table) => {
      return table.dropColumn("startMinimized");
    });
  },
};
