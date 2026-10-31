import { HydraApi, logger } from "@main/services";
import { openSteamOpenIdWindow } from "@main/services/steam-integration/steam-store-session";
import { steamSyncOrchestrator } from "@main/services/steam-integration/steam-sync-orchestrator";
import { registerEvent } from "../register-event";

const STEAM_OAUTH_RETURN_TO = "hydralauncher://steam-connected";

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
    const { authorizationUrl } = await HydraApi.get<{
      authorizationUrl: string;
    }>("/profile/oauth/steam/start", {
      return_to: STEAM_OAUTH_RETURN_TO,
      lng,
    });

    logger.log("Opening Steam OpenID authorization window");
    openSteamOpenIdWindow(authorizationUrl, () =>
      steamSyncOrchestrator.clearReconnectRequired()
    );
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error("Failed to start Steam OAuth", error);
    throw new Error(message ?? "steam-oauth-start-failed");
  }
};

registerEvent("startSteamOAuth", startSteamOAuth);
