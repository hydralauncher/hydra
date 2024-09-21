import { registerEvent } from "../register-event";
import { dataSource } from "@main/data-source";
import { DownloadSource } from "@main/entity";
import axios from "axios";
import { downloadSourceSchema } from "../helpers/validators";
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
        .save({
          url,
          name: source.name,
          downloadCount: source.downloads.length,
        });

      await insertDownloadsFromSource(
        transactionalEntityManager,
        downloadSource,
        source.downloads
      );

      return downloadSource;
    }
  );

  return downloadSource;
};

registerEvent("addDownloadSource", addDownloadSource);
