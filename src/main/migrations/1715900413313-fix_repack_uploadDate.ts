import { MigrationInterface, QueryRunner } from "typeorm";

export class FixRepackUploadDate1715900413313 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE repack SET uploadDate = createdAt WHERE uploadDate LIKE '%NaN%';`
    );
  }

  public async down(_: QueryRunner): Promise<void> {
    return;
  }
}
