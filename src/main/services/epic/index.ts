import { app, safeStorage } from "electron";
import { HydraApi } from "../hydra-api";
import { Legendary } from "../legendary";
import { WindowManager } from "../window-manager";
import { openEpicAuthWindow } from "./auth-window";
import {
  checkEpicBinary,
  getEpicBinaryAvailability,
} from "./binary-preparation";
import { EpicIntegrationCore } from "./integration-core";
import {
  cleanupEpicTemporarySessions,
  LegendaryAuthRunner,
} from "./legendary-auth";
import { EpicConnectionStore } from "./store";

const EPIC_CONNECTION_ENDPOINT = "/profile/integrations/epic";
let integration: EpicIntegrationCore | null = null;
let unsubscribeAuth: (() => void) | null = null;
let temporaryCleanupFailed = false;

function getIntegration() {
  if (integration) return integration;
  const store = new EpicConnectionStore({
    userDataPath: app.getPath("userData"),
    crypto: safeStorage,
  });
  integration = new EpicIntegrationCore({
    getAuthContext: () => HydraApi.getAuthContext(),
    isAuthContextCurrent: (context) => HydraApi.isAuthContextCurrent(context),
    store,
    availability: () => {
      if (process.platform !== "win32" && process.platform !== "darwin") {
        return { available: false, reason: "unsupported-platform" };
      }
      if (process.arch !== "x64" && process.arch !== "arm64") {
        return { available: false, reason: "unsupported-architecture" };
      }
      return getEpicBinaryAvailability(Legendary.getBinaryPath());
    },
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    checkBinary: () =>
      checkEpicBinary(Legendary.getBinaryPath(), {
        cleanup: temporaryCleanupFailed
          ? async () => {
              await cleanupEpicTemporarySessions(app.getPath("userData"));
              temporaryCleanupFailed = false;
            }
          : undefined,
      }),
    createRunner: (binaryPath, signal) =>
      LegendaryAuthRunner.create(binaryPath, app.getPath("userData"), signal),
    openWindow: openEpicAuthWindow,
    get: (options) =>
      HydraApi.get(EPIC_CONNECTION_ENDPOINT, undefined, {
        ...options,
        logResponseBody: false,
      }),
    post: (exchangeCode, options) =>
      HydraApi.post(
        EPIC_CONNECTION_ENDPOINT,
        { exchangeCode },
        { ...options, logResponseBody: false }
      ),
    delete: (connectionId, options) =>
      HydraApi.delete(
        `${EPIC_CONNECTION_ENDPOINT}?connectionId=${encodeURIComponent(connectionId)}`,
        { ...options, logResponseBody: false }
      ),
    emit: (state) => {
      const window = WindowManager.mainWindow;
      if (window && !window.isDestroyed())
        window.webContents.send("on-epic-connection-changed", state);
    },
  });
  return integration;
}

export async function initializeEpicIntegration() {
  // Crash recovery touches only our temporary directories. Never execute Legendary here.
  try {
    await cleanupEpicTemporarySessions(app.getPath("userData"));
  } catch {
    temporaryCleanupFailed = true;
  }
  if (!unsubscribeAuth) {
    unsubscribeAuth = HydraApi.onAuthContextChanged(() => {
      if (integration) void integration.authContextChanged();
    });
  }
}

export async function shutdownEpicIntegration() {
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  await integration?.shutdown();
}

export const getEpicConnection = () => getIntegration().getConnection();
export const startEpicAuth = () => getIntegration().startAuth();
export const cancelEpicAuth = (operationId: string) =>
  getIntegration().cancelAuth(operationId);
export const disconnectEpic = (connectionId: string) =>
  getIntegration().disconnect(connectionId);
