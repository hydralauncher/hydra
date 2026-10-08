import { app, safeStorage } from "electron";
import fs from "node:fs";
import type { EpicConnectionState } from "../../../types/epic-integration.types";
import { HydraApi } from "../hydra-api";
import { Legendary } from "../legendary";
import { WindowManager } from "../window-manager";
import { openEpicAuthWindow } from "./auth-window";
import { EpicIntegrationError, isRecord } from "./auth-protocol";
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

function isEncryptionAvailable() {
  try {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
          safeStorage.getSelectedStorageBackend()
        ))
    );
  } catch {
    return false;
  }
}

const binaryFailure = (error: unknown) =>
  isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
    ? "legendary-missing"
    : "legendary-unavailable";

function availability(): EpicConnectionState["availability"] {
  if (!["linux", "win32", "darwin"].includes(process.platform))
    return { available: false, reason: "unsupported-platform" };
  if (process.arch !== "x64" && process.arch !== "arm64")
    return { available: false, reason: "unsupported-architecture" };
  const binary = Legendary.getBinaryPath();
  if (!binary) return { available: false, reason: "legendary-missing" };
  try {
    return fs.statSync(binary).isFile()
      ? { available: true }
      : { available: false, reason: "legendary-missing" };
  } catch (error) {
    return { available: false, reason: binaryFailure(error) };
  }
}

async function checkBinary() {
  if (temporaryCleanupFailed) {
    try {
      await cleanupEpicTemporarySessions(app.getPath("userData"));
      temporaryCleanupFailed = false;
    } catch {
      throw new EpicIntegrationError("cleanup-failed");
    }
  }
  const binary = Legendary.getBinaryPath();
  if (!binary) throw new EpicIntegrationError("legendary-missing");
  try {
    if (!(await fs.promises.stat(binary)).isFile())
      throw new EpicIntegrationError("legendary-missing");
  } catch (error) {
    if (error instanceof EpicIntegrationError) throw error;
    throw new EpicIntegrationError(binaryFailure(error));
  }
  return binary;
}

function getIntegration() {
  if (integration) return integration;
  const store = new EpicConnectionStore({
    userDataPath: app.getPath("userData"),
    crypto: {
      isEncryptionAvailable,
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    },
  });
  integration = new EpicIntegrationCore({
    getAuthContext: () => HydraApi.getAuthContext(),
    isAuthContextCurrent: (context) => HydraApi.isAuthContextCurrent(context),
    store,
    availability,
    isEncryptionAvailable,
    checkBinary,
    createRunner: (binary, signal) =>
      LegendaryAuthRunner.create(binary, app.getPath("userData"), signal),
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
