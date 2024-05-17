import { createDataSource } from "@main/data-source";
import { Repack } from "@main/entity";
import { app } from "electron";
import { chunk } from "lodash-es";
import path from "path";
import { In, MigrationInterface, QueryRunner, Table } from "typeorm";

export class FixRepackUploadDate1715900413313 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "repack_temp",
        columns: [
          { name: "title", type: "varchar" },
          { name: "old_id", type: "int" },
        ],
      }),
      true
    );

    await queryRunner.query(
      `INSERT INTO repack_temp (title, old_id) SELECT title, id FROM repack WHERE repacker IN ('onlinefix', 'Xatab');`
    );

    await queryRunner.query(`DELETE FROM repack WHERE repacker = 'onlinefix';`);

    const updateDataSource = createDataSource({
      database: app.isPackaged
        ? path.join(process.resourcesPath, "hydra.db")
        : path.join(__dirname, "..", "..", "hydra.db"),
    });

    await updateDataSource.initialize();

    const updateRepackRepository = updateDataSource.getRepository(Repack);

    const updatedRepacks = await updateRepackRepository.find({
      where: {
        repacker: In(["onlinefix", "Xatab"]),
      },
    });

    const chunks = chunk(
      updatedRepacks.map((repack) => {
        const { id: _, ...rest } = repack;
        return rest;
      }),
      500
    );

    for (const chunk of chunks) {
      await queryRunner.manager
        .createQueryBuilder(Repack, "repack")
        .insert()
        .values(chunk)
        .orIgnore()
        .execute();
    }

    await queryRunner.query(
      `UPDATE game 
      SET repackId = (
        SELECT id 
        from repack LEFT JOIN repack_temp ON repack_temp.title = repack.title
        WHERE repack_temp.old_id = game.repackId
      ) 
      WHERE EXISTS (select old_id from repack_temp WHERE old_id = game.repackId)`
    );

    await queryRunner.dropTable("repack_temp");
  }

  public async down(_: QueryRunner): Promise<void> {
    return;
  }
}
