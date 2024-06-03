import { registerEvent } from "../register-event";
import { dataSource } from "@main/data-source";
import { DownloadSource } from "@main/entity";
import axios from "axios";
import { downloadSourceSchema } from "../helpers/validators";
import { repackRepository } from "@main/repository";
import { repacksWorker } from "@main/workers";
import { insertDownloadsFromSource } from "@main/helpers";

const addDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  const response = await axios.get(url);

  const source = downloadSourceSchema.parse(response.data);

  const downloadSource = await dataSource.transaction(
    async (transactionalEntityManager) => {
      const downloadSource = await transactionalEntityManager
        .getRepository(DownloadSource)
        .save({ url, name: source.name });

      await insertDownloadsFromSource(
        transactionalEntityManager,
        downloadSource,
        source.downloads
      );

      return downloadSource;
    }
  );

  repackRepository
    .find({
      order: {
        createdAt: "DESC",
      },
    })
    .then((repacks) => {
      repacksWorker.run(repacks, { name: "setRepacks" });
    });

  return downloadSource;
};

registerEvent("addDownloadSource", addDownloadSource);
