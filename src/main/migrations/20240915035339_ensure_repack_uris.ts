import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const EnsureRepackUris: HydraMigration = {
  name: "EnsureRepackUris",
  up: async (knex: Knex) => {
    await knex.schema.hasColumn("repack", "uris").then(async (exists) => {
      if (!exists) {
        await knex.schema.table("repack", (table) => {
          table.text("uris").notNullable().defaultTo("[]");
        });
      }
    });
  },

  down: async (_knex: Knex) => {},
};
