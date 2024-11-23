import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const FixMissingColumns: HydraMigration = {
  name: "FixMissingColumns",
  up: async (knex: Knex) => {
    const timestamp = new Date().getTime();
    await knex.schema
      .hasColumn("repack", "downloadSourceId")
      .then(async (exists) => {
        if (!exists) {
          await knex.schema.table("repack", (table) => {
            table
              .integer("downloadSourceId")
              .references("download_source.id")
              .onDelete("CASCADE");
          });
        }
      });

    await knex.schema.hasColumn("game", "remoteId").then(async (exists) => {
      if (!exists) {
        await knex.schema.table("game", (table) => {
          table
            .text("remoteId")
            .unique({ indexName: "game_remoteId_unique_" + timestamp });
        });
      }
    });

    await knex.schema.hasColumn("game", "uri").then(async (exists) => {
      if (!exists) {
        await knex.schema.table("game", (table) => {
          table.text("uri");
        });
      }
    });
  },

  down: async (_knex: Knex) => {},
};
