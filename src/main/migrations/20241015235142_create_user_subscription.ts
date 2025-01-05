import type { HydraMigration } from "@main/knex-client";
import type { Knex } from "knex";

export const CreateUserSubscription: HydraMigration = {
  name: "CreateUserSubscription",
  up: async (knex: Knex) => {
    return knex.schema.createTable("user_subscription", (table) => {
      table.increments("id").primary();
      table.string("subscriptionId").defaultTo("");
      table
        .text("userId")
        .notNullable()
        .references("user_auth.id")
        .onDelete("CASCADE");
      table.string("status").defaultTo("");
      table.string("planId").defaultTo("");
      table.string("planName").defaultTo("");
      table.dateTime("expiresAt").nullable();
      table.dateTime("createdAt").defaultTo(knex.fn.now());
      table.dateTime("updatedAt").defaultTo(knex.fn.now());
    });
  },

  down: async (knex: Knex) => {
    return knex.schema.dropTable("user_subscription");
  },
};
