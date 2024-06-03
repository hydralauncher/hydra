import { registerEvent } from "../register-event";
import { chunk } from "lodash-es";
import { dataSource } from "@main/data-source";
import { DownloadSource, Repack } from "@main/entity";
import axios from "axios";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { downloadSourceSchema } from "../helpers/validators";
import { SearchEngine } from "@main/services";

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

      const repacks: QueryDeepPartialEntity<Repack>[] = source.downloads.map(
        (download) => ({
          title: download.title,
          magnet: download.uris[0],
          fileSize: download.fileSize,
          repacker: source.name,
          uploadDate: download.uploadDate,
          downloadSource: { id: downloadSource.id },
        })
      );

      const downloadsChunks = chunk(repacks, 800);

      for (const chunk of downloadsChunks) {
        await transactionalEntityManager
          .getRepository(Repack)
          .createQueryBuilder()
          .insert()
          .values(chunk)
          .updateEntity(false)
          .orIgnore()
          .execute();
      }

      return downloadSource;
    }
  );

  await SearchEngine.updateRepacks();

  return downloadSource;
};

registerEvent("addDownloadSource", addDownloadSource);
