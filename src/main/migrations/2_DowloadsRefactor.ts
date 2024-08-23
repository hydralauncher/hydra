import { Knex } from "knex";

export const up = async (knex: Knex) => {
  await knex.schema.createTableIfNotExists("temporary_repack", (table) => {
    table.increments("id").primary();
    table.text("title").notNullable().unique();
    table.text("magnet").notNullable().unique();
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
};

export const down = async (knex: Knex) => {
  await knex.schema.renameTable("repack", "temporary_repack");
  await knex.schema.createTableIfNotExists("repack", (table) => {
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
};
