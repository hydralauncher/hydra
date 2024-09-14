import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const UpdateUserLanguage: HydraMigration = {
  name: "UpdateUserLanguage",
  up: async (knex: Knex) => {
    await knex("user_preferences")
      .update("language", "pt-BR")
      .where("language", "pt");
  },

  down: async (_knex: Knex) => {},
};
