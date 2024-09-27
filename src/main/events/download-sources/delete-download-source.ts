import { registerEvent } from "../register-event";
import { knexClient } from "@main/knex-client";

const deleteDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number
) => knexClient("download_source").where({ id }).delete();

registerEvent("deleteDownloadSource", deleteDownloadSource);
