import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const CreateGameAchievement: HydraMigration = {
  name: "CreateGameAchievement",
  up: async (knex: Knex) => {
    await knex.schema.createTable("game_achievement", (table) => {
      table.increments("id").primary();
      table.integer("gameId").notNullable();
      table.text("achievements");
      table.foreign("gameId").references("game.id").onDelete("CASCADE");
    });
  },

  down: async (knex: Knex) => {
    await knex.schema.dropTable("game_achievement");
  },
};
