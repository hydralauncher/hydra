import knex from "knex";
import { databasePath } from "./constants";
import { app } from "electron";

export const knexClient = knex({
  debug: !app.isPackaged,
  client: "better-sqlite3",
  connection: {
    filename: databasePath,
  },
});
