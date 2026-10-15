import { setEpicLibraryConnection } from "../library-sync/library-write-queue";
import { EpicSyncRuntime } from "./sync-runtime";
import { clearEpicImports, clearStaleEpicImports } from "./import-cleanup";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
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
import { downloadsSublevel, gamesSublevel, levelKeys } from "../../level";
import { updateGameRecord } from "../game-record-updater";
import { DownloadOrchestrator } from "../download-orchestrator";
import { DownloadManager } from "../download/download-manager";
import { getDiskUsage } from "../disk-usage";
import { isGameRunning } from "../game-running-state";
import { Downloader } from "../../../shared/constants";
import {
  LegendaryManagedRuntime,
  configureManagedEpicProcessSupervisor,
} from "./legendary-managed-runtime";
import { EpicInstallationService } from "./installation";
import { epicManagedInstallationSupport } from "./managed-platform";
import { EpicPlaytimeReporter } from "./playtime-reporter";
import { EpicCloudSaveSource } from "./cloud-save-source";
import { logger } from "../logger";
import { configureEpicTiming, withEpicTiming } from "./timing";
import { EpicDownloadService, setEpicDownloadService } from "./download";
import {
  configureEpicCloudSaves,
  type EpicCloudSaveService,
} from "./cloud-saves";
import {
  configureEpicLaunch,
  clearManagedEpicSessions,
  hasManagedEpicSession,
} from "./launch";
import type {
  EpicCloudSaveSettings,
  ResolveEpicCloudSaveConflictPayload,
  StartEpicGameDownloadPayload,
} from "../../../types/epic-managed.types";

configureEpicTiming((entry) => logger.info("[epic-timing]", entry));

const EPIC_CONNECTION_ENDPOINT = "/profile/integrations/epic";
let integration: EpicIntegrationCore | null = null;
let runtime: EpicSyncRuntime | null = null;
let lastPublicState: EpicConnectionState | null = null;
let firstLinkPending = false;
let unsubscribeAuth: (() => void) | null = null;
let temporaryCleanupFailed = false;
let stopping = false;
let closing = false;
let managedRuntime: LegendaryManagedRuntime | null = null;
let managedDownloads: EpicDownloadService | null = null;
let managedSaves: EpicCloudSaveService | null = null;
let managedPlaytime: EpicPlaytimeReporter | null = null;
let managedStop: Promise<void> | null = null;
let managedCleanupFailed = false;

function configureManagedEpic() {
  const binary = Legendary.getBinaryPath();
  if (binary && process.platform === "win32")
    configureManagedEpicProcessSupervisor(path.dirname(binary));
  managedRuntime = new LegendaryManagedRuntime({
    userData: app.getPath("userData"),
    binary: checkBinary,
    managedCommand: () => Legendary.getManagedCommand(),
    supervisorDirectory: binary ? path.dirname(binary) : undefined,
    session: runtime!.session,
    current: (target) =>
      !stopping &&
      !closing &&
      managedStop === null &&
      (target.localOnly
        ? runtime!.currentLocal(target)
        : runtime!.current(target)),
  });
  if (process.platform === "win32" || process.platform === "linux")
    runtime!.session.setRefreshOperation((auth, connection, bundle, signal) =>
      managedRuntime!.refreshSession(auth, connection, bundle, signal)
    );
  const installation = new EpicInstallationService({
    runtime: managedRuntime,
    capture: () => runtime!.capture(),
    captureLocal: () => runtime!.captureLocal(),
    current: (context) =>
      !stopping &&
      !closing &&
      managedStop === null &&
      runtime!.current(context),
    ownGame: (context, objectId, signal) =>
      runtime!.ownGame(context, objectId, signal),
    getGame: (objectId) => gamesSublevel.get(levelKeys.game("epic", objectId)),
    updateGame: (objectId, patch) =>
      updateGameRecord(levelKeys.game("epic", objectId), patch),
  });
  managedDownloads = new EpicDownloadService({
    runtime: managedRuntime,
    installation,
    getDownload: (id) => downloadsSublevel.get(id),
    putDownload: (id, download) => downloadsSublevel.put(id, download),
    startPreparedDownload: (download) =>
      DownloadOrchestrator.acceptPreparedEpicDownload(download),
    enqueuePreparedDownload: (download) =>
      DownloadOrchestrator.enqueuePreparedDownload(download),
    isGameRunning: (game) =>
      isGameRunning(game.objectId, game.shop) ||
      hasManagedEpicSession(levelKeys.game(game.shop, game.objectId)),
    getDiskUsage,
    afterGameUpdated: () =>
      WindowManager.sendToAppWindows("on-library-batch-complete"),
  });
  setEpicDownloadService(managedDownloads);
  const dependencies = {
    runtime: managedRuntime,
    installation,
    source: new EpicCloudSaveSource(runtime!.session),
    emit: (
      state: import("../../../types/epic-managed.types").EpicCloudSaveState
    ) =>
      WindowManager.sendToAppWindows("on-epic-cloud-save-state-changed", state),
  };
  managedSaves = configureEpicCloudSaves(dependencies);
  managedPlaytime = new EpicPlaytimeReporter({
    session: runtime!.session,
    current: (target) =>
      !stopping && managedStop === null && runtime!.current(target),
    confirmed: async (objectId, target) => {
      logger.info("Epic session playtime submission confirmed", { objectId });
      if (
        stopping ||
        closing ||
        managedStop !== null ||
        !runtime!.current(target)
      )
        return;
      runtime!.source.clearCache();
      await runtime!.syncGame(objectId, true);
    },
    error: (objectId, code) =>
      logger.warn("Epic session playtime was not reconciled", {
        objectId,
        code,
      }),
  });
  configureEpicLaunch({ ...dependencies, playtime: managedPlaytime });
}

/** Stop the process tree before releasing its queue slot or removing credentials. */
function stopManagedEpic(): Promise<void> {
  if (managedStop !== null) return managedStop;
  managedPlaytime?.invalidate();
  const operation = Promise.resolve()
    .then(async () => {
      const launchesStopped = clearManagedEpicSessions();
      const savesStopped = managedSaves?.invalidate();
      const processesStopped = managedRuntime?.stop();
      const stopped = await Promise.allSettled([
        savesStopped,
        launchesStopped,
        processesStopped,
        managedDownloads?.stop(),
        managedPlaytime?.idle(),
      ]);
      if (stopped.some((result) => result.status === "rejected"))
        throw new EpicIntegrationError("cleanup-failed");
      const activeId = DownloadManager.getActiveDownloadId();
      const active = activeId
        ? await downloadsSublevel.get(activeId)
        : undefined;
      if (active?.downloader === Downloader.Epic) {
        await DownloadManager.pauseDownload(activeId!);
        WindowManager.sendToAppWindows("on-download-progress", null);
      }
      for (const download of await downloadsSublevel.values().all()) {
        if (
          download.downloader !== Downloader.Epic ||
          (!download.queued && download.status !== "active")
        )
          continue;
        await downloadsSublevel.put(
          levelKeys.game(download.shop, download.objectId),
          {
            ...download,
            status: "paused",
            queued: false,
            pinnedToHero: false,
          }
        );
      }
      await managedRuntime?.cleanupCredentials();
      managedCleanupFailed = false;
      WindowManager.sendDownloadsUpdated();
    })
    .catch(() => {
      managedCleanupFailed = true;
      throw new EpicIntegrationError("cleanup-failed");
    })
    .finally(() => {
      if (managedStop === operation) managedStop = null;
    });
  managedStop = operation;
  return operation;
}

async function awaitManagedEpicReady() {
  getIntegration();
  await managedStop;
  if (managedCleanupFailed) await stopManagedEpic();
  if (stopping || closing)
    throw new EpicIntegrationError("operation-cancelled");
}

const binaryFailure = (error: unknown) =>
  isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
    ? "legendary-missing"
    : "legendary-unavailable";

function availability(): EpicConnectionState["availability"] {
  if (managedCleanupFailed)
    return { available: false, reason: "cleanup-failed" };
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
  if (managedCleanupFailed) throw new EpicIntegrationError("cleanup-failed");
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
        await stopManagedEpic();
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
    emit: (connectionState) => {
      const state = withManagedInstallation(connectionState);
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
      if (JSON.stringify(old) !== JSON.stringify(state))
        WindowManager.sendToAppWindows("on-epic-connection-changed", state);
    },
  });
  configureManagedEpic();
  return integration;
}

function subscribeEpicAuth() {
  if (unsubscribeAuth !== null) return;
  unsubscribeAuth = HydraApi.onAuthContextChanged(() => {
    runtime?.invalidate();
    lastPublicState = null;
    firstLinkPending = false;
    if (integration)
      void stopManagedEpic()
        .then(() => integration?.authContextChanged())
        .catch(() => undefined);
  });
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
  getIntegration();
  try {
    await managedRuntime?.cleanupCredentials();
  } catch {
    managedCleanupFailed = true;
  }
  subscribeEpicAuth();
  await getIntegration().initialize();
  if (process.platform === "linux") {
    const { reconcileEpicLinuxOwnershipTokens } = await import(
      "./ownership-token-reconciliation"
    );
    await reconcileEpicLinuxOwnershipTokens(await gamesSublevel.values().all());
  }
}

export async function shutdownEpicIntegration() {
  closing = true;
  try {
    // Flush only observations already captured; the actual game may keep running.
    await managedPlaytime?.drain();
    stopping = true;
    unsubscribeAuth?.();
    unsubscribeAuth = null;
    await stopManagedEpic();
    await runtime?.stop();
    await integration?.shutdown();
  } catch (error) {
    stopping = false;
    closing = false;
    managedPlaytime?.restoreAfterFailedShutdown();
    subscribeEpicAuth();
    runtime?.invalidate();
    lastPublicState = null;
    firstLinkPending = false;
    void integration?.authContextChanged().catch(() => undefined);
    throw error;
  }
}

const withManagedInstallation = (
  state: EpicConnectionState
): EpicConnectionState => {
  const support = epicManagedInstallationSupport();
  return {
    ...state,
    managedInstallation: support.available ? state.availability : support,
  };
};

export const getEpicConnection = () =>
  getIntegration().getConnection().then(withManagedInstallation);

export const getGameLinuxCompatibility = async (
  shop: string,
  objectId: string
) => {
  if (process.platform !== "linux" || shop !== "epic") return null;
  const game = await gamesSublevel.get(levelKeys.game("epic", objectId));
  const auth = HydraApi.getAuthContext();
  if (
    !game ||
    game.isDeleted ||
    !auth ||
    game.epicImportScope?.environment !== auth.environment ||
    game.epicImportScope?.userId !== auth.userId
  )
    return null;
  const { getEpicLinuxCompatibility } = await import("./linux-runtime");
  return getEpicLinuxCompatibility(game);
};
export const startEpicAuth = async () => {
  if (closing) throw new EpicIntegrationError("operation-cancelled");
  getIntegration();
  await stopManagedEpic();
  await runtime?.stop();
  return getIntegration().startAuth();
};
export const cancelEpicAuth = (operationId: string) =>
  getIntegration().cancelAuth(operationId);
export const disconnectEpic = async (connectionId: string) => {
  getIntegration();
  await stopManagedEpic();
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
export const suspendEpicPlaytime = () => managedPlaytime?.suspend();
export const resumeEpicPlaytime = () => managedPlaytime?.resume();

export const getEpicGameInstallOptions = async (
  objectId: string,
  signal?: AbortSignal
) =>
  withEpicTiming("request.install-options", async () => {
    if (signal?.aborted)
      return { options: [], error: "operation-cancelled" as const };
    await withEpicTiming("integration.ready", () => awaitManagedEpicReady());
    if (signal?.aborted)
      return { options: [], error: "operation-cancelled" as const };
    return managedDownloads!.getOptions(objectId, signal);
  });
export const openManagedEpicWinetricks = async (
  objectId: string
): Promise<boolean> => {
  if (process.platform !== "linux") return false;
  await awaitManagedEpicReady();
  const game = await gamesSublevel.get(levelKeys.game("epic", objectId));
  if (
    !game ||
    game.isDeleted ||
    !game.epicInstallation ||
    hasManagedEpicSession(levelKeys.game("epic", objectId))
  )
    return false;
  const session = await managedSaves!.capture(
    objectId,
    new AbortController().signal,
    undefined,
    true
  );
  const runtime = await import("./linux-runtime");
  const context = await runtime.prepareEpicLinuxRuntime(game, session.target, {
    signal: new AbortController().signal,
    offline: true,
    buildVersion: session.installed.version,
    installPath: session.installed.installPath,
  });
  const lease = await runtime.acquireEpicLinuxPrefixSession(context);
  try {
    managedSaves!.assertSessionCurrent(session);
    const handle = await runtime.openEpicLinuxWinetricks(context);
    void handle
      .waitForTreeExit()
      .catch(async () => {
        await handle.terminate();
      })
      .then(() => lease.release())
      .catch(() => {
        logger.warn("Epic compatibility tool cleanup remains pending", {
          objectId,
        });
      });
    return true;
  } catch (error) {
    lease.release();
    throw error;
  }
};
export const startEpicGameDownload = async (
  payload: StartEpicGameDownloadPayload
) =>
  withEpicTiming("request.start-download", async () => {
    await withEpicTiming("integration.ready", () => awaitManagedEpicReady());
    return managedDownloads!.start(payload);
  });
export const getEpicCloudSaveState = async (objectId: string) => {
  await awaitManagedEpicReady();
  return managedSaves!.getState(objectId);
};
export const setEpicCloudSaveSettings = async (
  objectId: string,
  settings: EpicCloudSaveSettings
) => {
  await awaitManagedEpicReady();
  if (!settings.automaticSync)
    return managedSaves!.setSettings(objectId, settings);
  // Epic and Hydra automatic save sync are mutually exclusive.
  const { setCloudSaveAutomaticSyncEnabled, withAutomaticSaveProviderLock } =
    await import("../cloud-save/automatic-sync-settings");
  return withAutomaticSaveProviderLock(objectId, async () => {
    const result = await managedSaves!.setSettings(objectId, settings);
    await setCloudSaveAutomaticSyncEnabled(objectId, "epic", false);
    return result;
  });
};
export const syncEpicCloudSaves = async (objectId: string) => {
  await awaitManagedEpicReady();
  return managedSaves!.sync(objectId);
};
export const resolveEpicCloudSaveConflict = async (
  payload: ResolveEpicCloudSaveConflictPayload
) => {
  await awaitManagedEpicReady();
  return managedSaves!.resolveConflict(payload);
};
