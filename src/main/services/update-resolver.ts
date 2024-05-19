import path from "node:path";
import { app } from "electron";

import { chunk } from "lodash-es";

import { createDataSource } from "@main/data-source";
import { Repack } from "@main/entity";
import { repackRepository } from "@main/repository";

export const resolveDatabaseUpdates = async () => {
  const updateDataSource = createDataSource({
    database: app.isPackaged
      ? path.join(process.resourcesPath, "hydra.db")
      : path.join(__dirname, "..", "..", "hydra.db"),
  });

  return updateDataSource.initialize().then(async () => {
    const updateRepackRepository = updateDataSource.getRepository(Repack);

    const updateRepacks = await updateRepackRepository.find();

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
