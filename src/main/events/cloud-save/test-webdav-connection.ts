import { WebDavBackup } from "@main/services";
import { registerEvent } from "../register-event";

const testWebDavConnection = async (
  _event: Electron.IpcMainInvokeEvent,
  host: string,
  username: string,
  password: string
) => {
  await WebDavBackup.testConnection(host, username, password);
};

registerEvent("testWebDavConnection", testWebDavConnection);
