import { downloadSourceRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const getDownloadSources = async (_event: Electron.IpcMainInvokeEvent) => {
  return downloadSourceRepository
    .createQueryBuilder("downloadSource")
    .leftJoin("downloadSource.repacks", "repacks")
    .orderBy("downloadSource.createdAt", "DESC")
    .loadRelationCountAndMap(
      "downloadSource.repackCount",
      "downloadSource.repacks"
    )
    .getMany();
};

registerEvent("getDownloadSources", getDownloadSources);
