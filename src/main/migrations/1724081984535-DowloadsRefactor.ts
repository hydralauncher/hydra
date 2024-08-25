import { MigrationInterface, QueryRunner } from "typeorm";

export class DowloadsRefactor1724081984535 implements MigrationInterface {
    name = 'DowloadsRefactor1724081984535'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "temporary_repack" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "title" text NOT NULL, "magnet" text NOT NULL, "page" integer, "repacker" text NOT NULL, "fileSize" text NOT NULL, "uploadDate" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "downloadSourceId" integer, "uris" text NOT NULL DEFAULT ('[]'), CONSTRAINT "UQ_5e8d57798643e693bced32095d2" UNIQUE ("magnet"), CONSTRAINT "UQ_a46a68496754a4d429ddf9d48ec" UNIQUE ("title"), CONSTRAINT "FK_13f131029be1dd361fd3cd9c2a6" FOREIGN KEY ("downloadSourceId") REFERENCES "download_source" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_repack"("id", "title", "magnet", "page", "repacker", "fileSize", "uploadDate", "createdAt", "updatedAt", "downloadSourceId") SELECT "id", "title", "magnet", "page", "repacker", "fileSize", "uploadDate", "createdAt", "updatedAt", "downloadSourceId" FROM "repack"`);
        await queryRunner.query(`DROP TABLE "repack"`);
        await queryRunner.query(`ALTER TABLE "temporary_repack" RENAME TO "repack"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "repack" RENAME TO "temporary_repack"`);
        await queryRunner.query(`CREATE TABLE "repack" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "title" text NOT NULL, "magnet" text NOT NULL, "page" integer, "repacker" text NOT NULL, "fileSize" text NOT NULL, "uploadDate" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "downloadSourceId" integer, CONSTRAINT "UQ_5e8d57798643e693bced32095d2" UNIQUE ("magnet"), CONSTRAINT "UQ_a46a68496754a4d429ddf9d48ec" UNIQUE ("title"), CONSTRAINT "FK_13f131029be1dd361fd3cd9c2a6" FOREIGN KEY ("downloadSourceId") REFERENCES "download_source" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "repack"("id", "title", "magnet", "page", "repacker", "fileSize", "uploadDate", "createdAt", "updatedAt", "downloadSourceId") SELECT "id", "title", "magnet", "page", "repacker", "fileSize", "uploadDate", "createdAt", "updatedAt", "downloadSourceId" FROM "temporary_repack"`);
        await queryRunner.query(`DROP TABLE "temporary_repack"`);
    }

}
