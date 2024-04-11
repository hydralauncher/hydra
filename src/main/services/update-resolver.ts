import path from "node:path";
import { app } from "electron";

import chunk from "lodash/chunk";

import { createDataSource, dataSource } from "@main/data-source";
import { Repack, RepackerFriendlyName } from "@main/entity";
import {
  migrationScriptRepository,
  repackRepository,
  repackerFriendlyNameRepository,
} from "@main/repository";
import { MigrationScript } from "@main/entity/migration-script.entity";

export const resolveDatabaseUpdates = async () => {
  const updateDataSource = createDataSource({
    database: app.isPackaged
      ? path.join(process.resourcesPath, "hydra.db")
      : path.join(__dirname, "..", "..", "resources", "hydra.db"),
  });

  return updateDataSource.initialize().then(async () => {
    const updateRepackRepository = updateDataSource.getRepository(Repack);
    const updateRepackerFriendlyNameRepository =
      updateDataSource.getRepository(RepackerFriendlyName);

    const [updateRepacks, updateRepackerFriendlyNames] = await Promise.all([
      updateRepackRepository.find(),
      updateRepackerFriendlyNameRepository.find(),
    ]);

    /*
      0.0.6 -> 0.0.7
      Xatab repacks were previously created with an incorrect upload date.
      This migration script will update the upload date of all Xatab repacks.
    */
    const migrationScript = await migrationScriptRepository.findOne({
      where: {
        version: "0.0.7",
      },
    });

    if (!migrationScript) {
      const xatabRepacks = updateRepacks.filter(
        (repack) => repack.repacker === "Xatab"
      );

      await dataSource.transaction(async (transactionalEntityManager) => {
        await Promise.all(
          xatabRepacks.map((repack) =>
            transactionalEntityManager.getRepository(Repack).update(
              {
                title: repack.title,
                repacker: repack.repacker,
              },
              {
                uploadDate: repack.uploadDate,
              }
            )
          )
        );

        await transactionalEntityManager.getRepository(MigrationScript).insert({
          version: "0.0.7",
        });
      });
    }

    await repackerFriendlyNameRepository
      .createQueryBuilder()
      .insert()
      .values(updateRepackerFriendlyNames)
      .orIgnore()
      .execute();

    const updateRepacksChunks = chunk(updateRepacks, 800);

    for (const chunk of updateRepacksChunks) {
      await repackRepository
        .createQueryBuilder()
        .insert()
        .values(chunk)
        .orIgnore()
        .execute();
    }
  });
};
