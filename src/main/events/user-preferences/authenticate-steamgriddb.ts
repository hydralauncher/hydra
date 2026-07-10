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

  SteamGridDbClient.authorize(apiKey);

  const isValid = await SteamGridDbClient.validate();

  if (!isValid) {
    SteamGridDbClient.reset();
    throw new Error("Invalid SteamGridDB API key");
  }

  return { success: true };
};

registerEvent("authenticateSteamGridDb", authenticateSteamGridDb);
