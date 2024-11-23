import { registerEvent } from "../register-event";
import { knexClient } from "@main/knex-client";

const getDownloadSources = async (_event: Electron.IpcMainInvokeEvent) =>
  knexClient.select("*").from("download_source");

registerEvent("getDownloadSources", getDownloadSources);
