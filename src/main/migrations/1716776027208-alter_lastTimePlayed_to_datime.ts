import { Game } from "@main/entity";
import { MigrationInterface, QueryRunner } from "typeorm";

export class AlterLastTimePlayedToDatime1716776027208
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 2024-05-27 02:08:17
    // Mon, 27 May 2024 02:08:17 GMT
    const updateLastTimePlayedValues = `
        UPDATE game SET lastTimePlayed = (SELECT 
            SUBSTR(lastTimePlayed, 13, 4) || '-' ||    -- Ano
            CASE SUBSTR(lastTimePlayed, 9, 3)
                WHEN 'Jan' THEN '01'
                WHEN 'Feb' THEN '02'
                WHEN 'Mar' THEN '03'
                WHEN 'Apr' THEN '04'
                WHEN 'May' THEN '05'
                WHEN 'Jun' THEN '06'
                WHEN 'Jul' THEN '07'
                WHEN 'Aug' THEN '08'
                WHEN 'Sep' THEN '09'
                WHEN 'Oct' THEN '10'
                WHEN 'Nov' THEN '11'
                WHEN 'Dec' THEN '12'
            END || '-' ||                          -- Mês
            SUBSTR(lastTimePlayed, 6, 2) || ' ' ||     -- Dia
            SUBSTR(lastTimePlayed, 18, 8)              -- Hora;
            FROM game)
            WHERE lastTimePlayed IS NOT NULL;
            `;

    await queryRunner.query(updateLastTimePlayedValues);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const queryBuilder = queryRunner.manager.createQueryBuilder(Game, "game");

    const result = await queryBuilder.getMany();

    for (const game of result) {
      if (!game.lastTimePlayed) continue;
      await queryRunner.query(
        `UPDATE game set lastTimePlayed = '${game.lastTimePlayed.toUTCString()}' WHERE id = ${game.id};`
      );
    }
  }
}
