import knex, { Knex } from "knex";
import { databasePath } from "./constants";
import * as migrations from "./migrations";

type Migration = Knex.Migration & { name: string };

class MigrationSource implements Knex.MigrationSource<Migration> {
  getMigrations(): Promise<Migration[]> {
    return Promise.resolve(
      Object.values(migrations).sort((a, b) => a.name.localeCompare(b.name))
    );
  }
  getMigrationName(migration: Migration): string {
    return migration.name;
  }
  getMigration(migration: Migration): Promise<Migration> {
    return Promise.resolve(migration);
  }
}

export const knexClient = knex({
  client: "better-sqlite3",
  connection: {
    filename: databasePath,
  },
});

export const migrationConfig: Knex.MigratorConfig = {
  migrationSource: new MigrationSource(),
};
