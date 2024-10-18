import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const CreateGameAchievement: HydraMigration = {
  name: "CreateGameAchievement",
  up: (knex: Knex) => {
    return knex.schema.createTable("game_achievement", (table) => {
      table.increments("id").primary();
      table.text("objectId").notNullable();
      table.text("shop").notNullable();
      table.text("achievements");
      table.text("unlockedAchievements");
      table.unique(["objectId", "shop"]);
    });
  },

  down: (knex: Knex) => {
    return knex.schema.dropTable("game_achievement");
  },
};
