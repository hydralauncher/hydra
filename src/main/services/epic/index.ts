import { setEpicLibraryConnection } from "../library-sync/library-write-queue";
import { EpicSyncRuntime } from "./sync-runtime";
import { clearEpicImports, clearStaleEpicImports } from "./import-cleanup";
import { app } from "electron";
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
let runtime: EpicSyncRuntime | null = null;
let lastPublicState: EpicConnectionState | null = null;
let firstLinkPending = false;
let unsubscribeAuth: (() => void) | null = null;
let temporaryCleanupFailed = false;
let stopping = false;

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
    if (!fs.statSync(binary).isFile())
      return { available: false, reason: "legendary-missing" };
  } catch (error) {
    return { available: false, reason: binaryFailure(error) };
  }
  return { available: true };
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
  if (stopping) throw new EpicIntegrationError("operation-cancelled");
  const store = new EpicConnectionStore({
    userDataPath: app.getPath("userData"),
  });
  runtime = new EpicSyncRuntime(
    store,
    app.getPath("userData"),
    checkBinary,
    () => getIntegration().getConnection(),
    () => lastPublicState
  );
  integration = new EpicIntegrationCore({
    getAuthContext: () => HydraApi.getAuthContext(),
    isAuthContextCurrent: (context) => HydraApi.isAuthContextCurrent(context),
    store,
    availability,
    checkBinary,
    createRunner: async (binary, signal) => {
      const runner = await LegendaryAuthRunner.create(
        binary,
        app.getPath("userData"),
        signal
      );
      return {
        authenticate: (code) =>
          runtime!.session.serialize(() => runner.authenticate(code)),
        cleanup: () => runner.cleanup(),
      };
    },
    openWindow: openEpicAuthWindow,
    get: (options) =>
      HydraApi.get(EPIC_CONNECTION_ENDPOINT, undefined, {
        ...options,
        logResponseBody: false,
      }),
    post: (account, options) =>
      HydraApi.post(EPIC_CONNECTION_ENDPOINT, account, {
        ...options,
        logResponseBody: false,
      }),
    delete: (connectionId, options) =>
      HydraApi.delete(
        `${EPIC_CONNECTION_ENDPOINT}?connectionId=${encodeURIComponent(connectionId)}`,
        { ...options, logResponseBody: false }
      ),
    connectionChanged: async (context, previous, next) => {
      const current = () => HydraApi.isAuthContextCurrent(context);
      if (!current()) return;
      setEpicLibraryConnection(
        context,
        next.connected ? next.connectionId : null
      );
      const transitioned =
        (!!previous &&
          (!next.connected || previous.connectionId !== next.connectionId)) ||
        (lastPublicState?.hydraUserId === context.userId &&
          lastPublicState.connection?.connected === true &&
          (!next.connected ||
            lastPublicState.connection.connectionId !== next.connectionId));
      if (transitioned) {
        if (lastPublicState)
          lastPublicState = {
            ...lastPublicState,
            connection: next,
            verification: "confirmed",
          };
        runtime?.invalidate();
        if (previous)
          await clearEpicImports(
            context,
            previous.connectionId,
            false,
            current
          );
      }
      const cleaned = await clearStaleEpicImports(
        context,
        current,
        next.connected ? next.connectionId : null
      );
      if (transitioned || cleaned > 0) {
        await import("../library-sync/merge-with-remote-games").then(
          ({ mergeWithRemoteGames }) => mergeWithRemoteGames(undefined, context)
        );
        if (current())
          WindowManager.sendToAppWindows("on-library-batch-complete");
      }
    },
    emit: (state) => {
      const old = lastPublicState;
      lastPublicState = state;
      if (
        state.verification === "confirmed" &&
        state.connection?.connected &&
        old?.connection?.connected !== true &&
        state.operation?.status === "connecting"
      )
        firstLinkPending = true;
      if (
        state.verification === "confirmed" &&
        state.connection?.connected &&
        !state.operation &&
        (firstLinkPending ||
          old?.verification !== "confirmed" ||
          old.hydraUserId !== state.hydraUserId ||
          old.connection?.connected !== true ||
          old.connection.connectionId !== state.connection.connectionId ||
          !!old.operation)
      ) {
        const firstLink = firstLinkPending;
        const authenticated =
          old?.operation?.status === "connecting" &&
          state.sessionState === "ready";
        firstLinkPending = false;
        queueMicrotask(() => {
          if (authenticated) void runtime?.authenticated(firstLink);
          else void runtime?.startup(firstLink);
        });
      }
      const window = WindowManager.mainWindow;
      if (window && !window.isDestroyed())
        window.webContents.send("on-epic-connection-changed", state);
    },
  });
  return integration;
}

export async function initializeEpicIntegration() {
  if (stopping) return;
  if (unsubscribeAuth) {
    await getIntegration().initialize();
    return;
  }
  // Crash recovery touches only our temporary directories. Never execute Legendary here.
  try {
    await cleanupEpicTemporarySessions(app.getPath("userData"));
  } catch {
    temporaryCleanupFailed = true;
  }
  if (stopping) return;
  if (!unsubscribeAuth) {
    unsubscribeAuth = HydraApi.onAuthContextChanged(() => {
      runtime?.invalidate();
      firstLinkPending = false;
      if (integration)
        void integration.authContextChanged().catch(() => undefined);
    });
  }
  await getIntegration().initialize();
}

export async function shutdownEpicIntegration() {
  stopping = true;
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  await runtime?.stop();
  await integration?.shutdown();
}

export const getEpicConnection = () => getIntegration().getConnection();
export const startEpicAuth = async () => {
  getIntegration();
  await runtime?.stop();
  return getIntegration().startAuth();
};
export const cancelEpicAuth = (operationId: string) =>
  getIntegration().cancelAuth(operationId);
export const disconnectEpic = async (connectionId: string) => {
  getIntegration();
  await runtime?.stop();
  return getIntegration().disconnect(connectionId);
};
export const startEpicSync = (connectionId: string) => {
  getIntegration();
  return runtime!.start(connectionId);
};
export const getEpicSyncState = () => {
  getIntegration();
  const state = runtime!.orchestrator.getState();
  const context = HydraApi.getAuthContext();
  return state.hydraUserId === context?.userId
    ? state
    : { status: "idle" as const, hydraUserId: context?.userId ?? null };
};
export const cancelEpicSync = async (connectionId: string) => {
  getIntegration();
  try {
    await runtime!.orchestrator.cancel(connectionId);
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "sync-active" as const };
  }
};
export const syncEpicGameOnGamePage = async (objectId: string) => {
  getIntegration();
  try {
    return (await runtime!.syncGame(objectId)) !== null;
  } catch {
    return false;
  }
};
export const startEpicSyncOnStartup = () => {
  getIntegration();
  return runtime!.startup();
};
export const resolveEpicSessionPolicy = (
  game: import("@types").Game,
  matchedPath: string
) => {
  getIntegration();
  return runtime!.sessionPolicy(game, matchedPath);
};
export const cancelEpicGameExitSync = (objectId: string) =>
  runtime?.cancelExit(objectId);
export const scheduleEpicGameExitSync = (game: import("@types").Game) =>
  runtime?.scheduleExit(game);
