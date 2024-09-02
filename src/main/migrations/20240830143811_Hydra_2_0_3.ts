import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const Hydra2_0_3: HydraMigration = {
  name: "Hydra_2_0_3",
  up: async (knex: Knex) => {
    const timestamp = new Date().getTime();

    await knex.schema.hasTable("migrations").then(async (exists) => {
      if (exists) {
        await knex.schema.dropTable("migrations");
      }
    });

    await knex.schema.hasTable("download_source").then(async (exists) => {
      if (!exists) {
        await knex.schema.createTable("download_source", (table) => {
          table.increments("id").primary();
          table
            .text("url")
            .unique({ indexName: "download_source_url_unique_" + timestamp });
          table.text("name").notNullable();
          table.text("etag");
          table.integer("downloadCount").notNullable().defaultTo(0);
          table.text("status").notNullable().defaultTo(0);
          table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
          table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
        });
      }
    });

    await knex.schema.hasTable("repack").then(async (exists) => {
      if (!exists) {
        await knex.schema.createTable("repack", (table) => {
          table.increments("id").primary();
          table
            .text("title")
            .notNullable()
            .unique({ indexName: "repack_title_unique_" + timestamp });
          table
            .text("magnet")
            .notNullable()
            .unique({ indexName: "repack_magnet_unique_" + timestamp });
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
      }
    });

    await knex.schema.hasTable("game").then(async (exists) => {
      if (!exists) {
        await knex.schema.createTable("game", (table) => {
          table.increments("id").primary();
          table
            .text("objectID")
            .notNullable()
            .unique({ indexName: "game_objectID_unique_" + timestamp });
          table
            .text("remoteId")
            .unique({ indexName: "game_remoteId_unique_" + timestamp });
          table.text("title").notNullable();
          table.text("iconUrl");
          table.text("folderName");
          table.text("downloadPath");
          table.text("executablePath");
          table.integer("playTimeInMilliseconds").notNullable().defaultTo(0);
          table.text("shop").notNullable();
          table.text("status");
          table.integer("downloader").notNullable().defaultTo(1);
          table.float("progress").notNullable().defaultTo(0);
          table.integer("bytesDownloaded").notNullable().defaultTo(0);
          table.datetime("lastTimePlayed");
          table.float("fileSize").notNullable().defaultTo(0);
          table.text("uri");
          table.boolean("isDeleted").notNullable().defaultTo(0);
          table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
          table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
          table
            .integer("repackId")
            .references("repack.id")
            .unique("repack_repackId_unique_" + timestamp);
        });
      }
    });

    await knex.schema.hasTable("user_preferences").then(async (exists) => {
      if (!exists) {
        await knex.schema.createTable("user_preferences", (table) => {
          table.increments("id").primary();
          table.text("downloadsPath");
          table.text("language").notNullable().defaultTo("en");
          table.text("realDebridApiToken");
          table
            .boolean("downloadNotificationsEnabled")
            .notNullable()
            .defaultTo(0);
          table
            .boolean("repackUpdatesNotificationsEnabled")
            .notNullable()
            .defaultTo(0);
          table.boolean("preferQuitInsteadOfHiding").notNullable().defaultTo(0);
          table.boolean("runAtStartup").notNullable().defaultTo(0);
          table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
          table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
        });
      }
    });

    await knex.schema.hasTable("game_shop_cache").then(async (exists) => {
      if (!exists) {
        await knex.schema.createTable("game_shop_cache", (table) => {
          table.text("objectID").primary().notNullable();
          table.text("shop").notNullable();
          table.text("serializedData");
          table.text("howLongToBeatSerializedData");
          table.text("language");
          table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
          table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
        });
      }
    });

    await knex.schema.hasTable("download_queue").then(async (exists) => {
      if (!exists) {
        await knex.schema.createTable("download_queue", (table) => {
          table.increments("id").primary();
          table
            .integer("gameId")
            .references("game.id")
            .unique("download_queue_gameId_unique_" + timestamp);
          table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
          table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
        });
      }
    });

    await knex.schema.hasTable("user_auth").then(async (exists) => {
      if (!exists) {
        await knex.schema.createTable("user_auth", (table) => {
          table.increments("id").primary();
          table.text("userId").notNullable().defaultTo("");
          table.text("displayName").notNullable().defaultTo("");
          table.text("profileImageUrl");
          table.text("accessToken").notNullable().defaultTo("");
          table.text("refreshToken").notNullable().defaultTo("");
          table.integer("tokenExpirationTimestamp").notNullable().defaultTo(0);
          table.datetime("createdAt").notNullable().defaultTo(knex.fn.now());
          table.datetime("updatedAt").notNullable().defaultTo(knex.fn.now());
        });
      }
    });
  },

  down: async (knex: Knex) => {
    await knex.schema.dropTableIfExists("game");
    await knex.schema.dropTableIfExists("repack");
    await knex.schema.dropTableIfExists("download_queue");
    await knex.schema.dropTableIfExists("user_auth");
    await knex.schema.dropTableIfExists("game_shop_cache");
    await knex.schema.dropTableIfExists("user_preferences");
    await knex.schema.dropTableIfExists("download_source");
  },
};
