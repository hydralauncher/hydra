import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const EnsureRepackUris: HydraMigration = {
  name: "EnsureRepackUris",
  up: async (knex: Knex) => {
    await knex.schema.createTable("temporary_repack", (table) => {
      const timestamp = new Date().getTime();
      table.increments("id").primary();
      table
        .text("title")
        .notNullable()
        .unique({ indexName: "repack_title_unique_" + timestamp });
      table
        .text("magnet")
        .notNullable()
        .unique({ indexName: "repack_magnet_unique_" + timestamp });
      table.text("repacker").notNullable();
      table.text("fileSize").notNullable();
      table.datetime("uploadDate").notNullable();
      table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
      table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
      table
        .integer("downloadSourceId")
        .references("download_source.id")
        .onDelete("CASCADE");
      table.text("uris").notNullable().defaultTo("[]");
    });
    await knex.raw(
      `INSERT INTO "temporary_repack"("id", "title", "magnet", "repacker", "fileSize", "uploadDate", "createdAt", "updatedAt", "downloadSourceId") SELECT "id", "title", "magnet", "repacker", "fileSize", "uploadDate", "createdAt", "updatedAt", "downloadSourceId" FROM "repack"`
    );
    await knex.schema.dropTable("repack");
    await knex.schema.renameTable("temporary_repack", "repack");
  },

  down: async (knex: Knex) => {
    await knex.schema.renameTable("repack", "temporary_repack");
    await knex.schema.createTable("repack", (table) => {
      table.increments("id").primary();
      table.text("title").notNullable().unique();
      table.text("magnet").notNullable().unique();
      table.integer("page");
      table.text("repacker").notNullable();
      table.text("fileSize").notNullable();
      table.datetime("uploadDate").notNullable();
      table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
      table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
      table
        .integer("downloadSourceId")
        .references("download_source.id")
        .onDelete("CASCADE");
    });
    await knex.raw(
      `INSERT INTO "repack"("id", "title", "magnet", "repacker", "fileSize", "uploadDate", "createdAt", "updatedAt", "downloadSourceId") SELECT "id", "title", "magnet", "repacker", "fileSize", "uploadDate", "createdAt", "updatedAt", "downloadSourceId" FROM "temporary_repack"`
    );
    await knex.schema.dropTable("temporary_repack");
  },
};
