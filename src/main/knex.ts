import knex, { Knex } from "knex";
import { databasePath } from "./constants";
import path from "node:path";

export const knexClient = knex({
  client: "better-sqlite3",
  connection: {
    filename: databasePath,
  },
});

export const migrationConfig: Knex.MigratorConfig = {
  directory: path.resolve(__dirname, "migrations"),
};
