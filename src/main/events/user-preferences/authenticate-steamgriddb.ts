import { registerEvent } from "../register-event";
import { SteamGridDbClient } from "@main/services";

const authenticateSteamGridDb = async (
  _event: Electron.IpcMainInvokeEvent,
  apiKey: string
) => {
  if (!apiKey) {
    SteamGridDbClient.reset();
    return { success: true };
  }

  const isValid = await SteamGridDbClient.validateKey(apiKey);

  if (!isValid) {
    throw new Error("Invalid SteamGridDB API key");
  }

  SteamGridDbClient.authorize(apiKey);

  return { success: true };
};

registerEvent("authenticateSteamGridDb", authenticateSteamGridDb);
