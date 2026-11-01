import { createRequire } from "node:module";

import type {
  SteamIntegrationStatus,
  SteamLoginErrorCode,
  SteamLoginState,
} from "@types";

import { HydraApi } from "../hydra-api";
import { steamSyncLogger } from "../logger";
import { WindowManager } from "../window-manager";
import {
  acquireSteamClientSession,
  clearSteamClientSession,
  prepareSteamClientLogin,
  saveSteamClientRefreshToken,
} from "./steam-client-session";
import {
  notifySteamConnected,
  openSteamOpenIdWindow,
} from "./steam-store-session";
import { steamSyncOrchestrator } from "./steam-sync-orchestrator";

const require = createRequire(import.meta.url);

const { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType, EResult } =
  require("steam-session") as typeof import("steam-session");

type SteamLoginSession = InstanceType<typeof LoginSession>;

const INTEGRATION_ENDPOINT = "/profile/integrations/steam";
const STEAM_OAUTH_RETURN_TO = "hydralauncher://steam-connected";
const QR_SESSION_TIMEOUT_MS = 120_000;
const CREDENTIALS_SESSION_TIMEOUT_MS = 300_000;

let activeSession: SteamLoginSession | null = null;

const setState = (state: SteamLoginState) => {
  WindowManager.sendToSteamConnectionWindow("on-steam-login-state", state);
};

const loginErrorCode = (error: unknown): SteamLoginErrorCode => {
  const eresult = (error as { eresult?: number } | null)?.eresult;

  switch (eresult) {
    case EResult.InvalidPassword:
    case EResult.InvalidName:
    case EResult.AccessDenied:
      return "invalid-credentials";
    case EResult.RateLimitExceeded:
    case EResult.AccountLoginDeniedThrottle:
      return "rate-limited";
    case EResult.InvalidLoginAuthCode:
    case EResult.TwoFactorCodeMismatch:
    case EResult.ExpiredLoginAuthCode:
      return "invalid-code";
    default:
      return "generic";
  }
};

const discardActiveSession = () => {
  const current = activeSession;
  activeSession = null;
  current?.removeAllListeners();
  // A listener must stay attached: an unhandled "error" event would crash the app.
  current?.on("error", () => undefined);
  current?.cancelLoginAttempt();
};

export const startSteamOpenIdLink = async (lng: string) => {
  const { authorizationUrl } = await HydraApi.get<{
    authorizationUrl: string;
  }>("/profile/oauth/steam/start", {
    return_to: STEAM_OAUTH_RETURN_TO,
    lng,
  });

  steamSyncLogger.log("Opening Steam OpenID authorization window");
  openSteamOpenIdWindow(authorizationUrl, () =>
    steamSyncOrchestrator.clearReconnectRequired()
  );
};

const completeLogin = async (refreshToken: string, lng: string) => {
  setState({ status: "completing" });

  try {
    await prepareSteamClientLogin();
    await saveSteamClientRefreshToken(refreshToken);

    const { steamId64 } = await acquireSteamClientSession();
    const status =
      await HydraApi.get<SteamIntegrationStatus>(INTEGRATION_ENDPOINT);

    // The window was closed while the login finished: that is a cancel.
    if (!WindowManager.getSteamConnectionWindow()) {
      await clearSteamClientSession();
      return;
    }

    if (status.connected && status.steamId64 === steamId64) {
      steamSyncOrchestrator.clearReconnectRequired();
      notifySteamConnected();
      return;
    }

    await startSteamOpenIdLink(lng);
  } catch (error) {
    steamSyncLogger.error("Steam login could not be completed", error);
    await clearSteamClientSession().catch(() => undefined);
    setState({ status: "error", code: "generic" });
  }
};

const watchSession = (loginSession: SteamLoginSession, lng: string) => {
  loginSession.on("authenticated", () => {
    if (activeSession !== loginSession) return;

    const { refreshToken } = loginSession;
    activeSession = null;
    void completeLogin(refreshToken, lng);
  });

  loginSession.on("error", (error: unknown) => {
    if (activeSession !== loginSession) return;

    steamSyncLogger.error(
      "Steam login failed",
      (error as { eresult?: number } | null)?.eresult
    );
    activeSession = null;
    setState({ status: "error", code: loginErrorCode(error) });
  });
};

/**
 * steam-session does not surface the replacement challenge Steam returns while
 * polling, and without it the QR on screen stops being scannable.
 */
const watchQrChallenge = (loginSession: SteamLoginSession) => {
  const handler = (
    loginSession as unknown as {
      _handler: {
        pollLoginStatus: (
          details: unknown
        ) => Promise<{ newChallengeUrl?: string | null }>;
      };
    }
  )._handler;
  const pollLoginStatus = handler.pollLoginStatus.bind(handler);

  handler.pollLoginStatus = async (details) => {
    const response = await pollLoginStatus(details);
    if (response.newChallengeUrl && activeSession === loginSession) {
      setState({ status: "qr", challengeUrl: response.newChallengeUrl });
    }
    return response;
  };
};

export const startSteamQrLogin = async (lng: string) => {
  discardActiveSession();

  const loginSession = new LoginSession(EAuthTokenPlatformType.SteamClient);
  loginSession.loginTimeout = QR_SESSION_TIMEOUT_MS;
  activeSession = loginSession;
  watchSession(loginSession, lng);
  watchQrChallenge(loginSession);

  loginSession.on("timeout", () => {
    if (activeSession === loginSession) {
      void startSteamQrLogin(lng);
    }
  });

  try {
    const { qrChallengeUrl } = await loginSession.startWithQR();
    if (activeSession === loginSession && qrChallengeUrl) {
      setState({ status: "qr", challengeUrl: qrChallengeUrl });
    }
  } catch (error) {
    steamSyncLogger.error("Steam QR login could not start", error);
    if (activeSession === loginSession) {
      activeSession = null;
      setState({ status: "error", code: "generic" });
    }
  }
};

export const startSteamCredentialsLogin = async (
  accountName: string,
  password: string,
  lng: string
) => {
  discardActiveSession();
  setState({ status: "submitting" });

  const loginSession = new LoginSession(EAuthTokenPlatformType.SteamClient);
  loginSession.loginTimeout = CREDENTIALS_SESSION_TIMEOUT_MS;
  activeSession = loginSession;
  watchSession(loginSession, lng);

  loginSession.on("timeout", () => {
    if (activeSession === loginSession) {
      activeSession = null;
      setState({ status: "error", code: "generic" });
    }
  });

  try {
    const { actionRequired, validActions } =
      await loginSession.startWithCredentials({ accountName, password });
    if (activeSession !== loginSession || !actionRequired) return;

    const actions = validActions?.map((action) => action.type) ?? [];
    if (actions.includes(EAuthSessionGuardType.EmailCode)) {
      setState({ status: "guard", kind: "email" });
    } else if (actions.includes(EAuthSessionGuardType.DeviceCode)) {
      setState({ status: "guard", kind: "device" });
    } else {
      setState({ status: "guard", kind: "confirmation" });
    }
  } catch (error) {
    if (activeSession !== loginSession) return;

    steamSyncLogger.error(
      "Steam credentials login failed",
      (error as { eresult?: number } | null)?.eresult
    );
    activeSession = null;
    setState({ status: "error", code: loginErrorCode(error) });
  }
};

export const submitSteamLoginGuardCode = async (code: string) => {
  const loginSession = activeSession;
  if (!loginSession) return;

  setState({ status: "submitting" });

  try {
    await loginSession.submitSteamGuardCode(code.trim());
  } catch (error) {
    if (activeSession !== loginSession) return;

    steamSyncLogger.error(
      "Steam Guard code rejected",
      (error as { eresult?: number } | null)?.eresult
    );
    activeSession = null;
    setState({ status: "error", code: loginErrorCode(error) });
  }
};

export const cancelSteamLogin = () => {
  discardActiveSession();
  setState({ status: "idle" });
};
