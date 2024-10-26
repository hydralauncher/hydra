import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const RepackUris: HydraMigration = {
  name: "RepackUris",
  up: async (knex: Knex) => {
    await knex.schema.alterTable("repack", (table) => {
      table.text("uris").notNullable().defaultTo("[]");
    });
  },

  down: async (knex: Knex) => {
    await knex.schema.alterTable("repack", (table) => {
      table.integer("page");
      table.dropColumn("uris");
    });
  },
};
