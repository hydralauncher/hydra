import { registerEvent } from "../register-event";
import { knexClient } from "@main/knex-client";

const getRepacks = (_event: Electron.IpcMainInvokeEvent) =>
  knexClient.select("*").from("repack");

registerEvent("getRepacks", getRepacks);
