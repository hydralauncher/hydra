import { logger } from "@main/services";
import { startSteamOpenIdLink } from "@main/services/steam-integration/steam-client-login";
import { registerEvent } from "../register-event";

const getErrorMessage = (error: unknown): string | null => {
  if (typeof error === "object" && error !== null) {
    const response = (error as { response?: { data?: { message?: unknown } } })
      .response;
    const responseMessage = response?.data?.message;

    if (typeof responseMessage === "string") {
      return responseMessage;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return null;
};

const startSteamOAuth = async (
  _event: Electron.IpcMainInvokeEvent,
  lng: string
) => {
  try {
    await startSteamOpenIdLink(lng);
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error("Failed to start Steam OAuth", error);
    throw new Error(message ?? "steam-oauth-start-failed");
  }
};

registerEvent("startSteamOAuth", startSteamOAuth);
