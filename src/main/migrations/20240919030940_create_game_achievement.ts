import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const CreateGameAchievement: HydraMigration = {
  name: "CreateGameAchievement",
  up: (knex: Knex) => {
    return knex.schema.createTable("game_achievement", (table) => {
      table.increments("id").primary();
      table.integer("gameId").notNullable().unique();
      table.text("achievements");
      table.text("unlockedAchievements");
      table.foreign("gameId").references("game.id").onDelete("CASCADE");
    });
  },

  down: (knex: Knex) => {
    return knex.schema.dropTable("game_achievement");
  },
};
