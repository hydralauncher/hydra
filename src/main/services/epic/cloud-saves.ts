import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type {
  EpicCloudSaveState,
  EpicCloudSaveSettings,
  EpicInstallation,
  ResolveEpicCloudSaveConflictPayload,
} from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { updateGameRecord } from "../game-record-updater";
import { isGameRunning } from "../game-running-state";
import { Wine } from "../wine";
import { logger } from "../logger";
import {
  getEpicLinuxPrefixGeneration,
  resolveEpicLinuxPrefixPath,
  withEpicLinuxPrefixMutation,
} from "./linux-runtime";
import {
  linuxEpicSaveVariables,
  resolveLinuxEpicSavePath,
} from "./cloud-save-linux-path.js";
import type {
  LegendaryManagedRuntime,
  EpicManagedTarget,
} from "./legendary-managed-runtime";
import type {
  EpicInstallationService,
  EpicOwnedGame,
  EpicInstalledGame,
} from "./installation";
import { readManagedJson, writeManagedJson } from "./installation";
import {
  epicOwnerMatches,
  epicManagedErrorCode,
} from "./legendary-managed-runtime";
import { isRecord } from "./auth-protocol.js";
import {
  EPIC_SAVE_SYNC_TIMEOUT_MS,
  EPIC_SAVE_STABILITY_DELAY_MS,
  EPIC_SAVE_STABILITY_ATTEMPTS,
} from "./constants.js";
import {
  assertEpicSaveCommandSucceeded,
  decideEpicSaveSync,
  EpicSaveFailure,
  sameEpicRemoteSaveManifest,
  parseEpicSaveMetadata,
  resolveEpicSavePath,
  type EpicSaveMetadata,
  type EpicRemoteSaveManifest,
} from "./cloud-save-protocol.js";
import type { EpicCloudSaveSource } from "./cloud-save-source";
import {
  applyEpicSaveSnapshot,
  copyEpicSaveSnapshot,
  inspectEpicSaveFiles,
  getEpicSaveSnapshotModifiedAt,
  EpicSaveRollbackFailure,
  type EpicSaveSnapshot,
} from "./cloud-save-files.js";

export interface EpicCloudSaveDependencies {
  runtime: LegendaryManagedRuntime;
  installation: EpicInstallationService;
  source: Pick<EpicCloudSaveSource, "latest">;
  emit(state: EpicCloudSaveState): void;
}
export interface EpicSaveSession {
  objectId: string;
  target: EpicManagedTarget;
  installed: EpicInstalledGame;
  metadata: EpicSaveMetadata;
  savePath: string | null;
  automaticSync: boolean;
  generation: number;
  winePrefixPath?: string;
  prefixGeneration?: string | null;
  savePathSource?: "automatic" | "custom";
  /** The launch owns this lease until its post-exit save operation finishes. */
  linuxPrefixLeaseId?: string;
}
interface EpicPostExitTask {
  session: EpicSaveSession;
  controller: AbortController;
  commandStarted: boolean;
  promise: Promise<EpicCloudSaveState | undefined>;
}

// Legacy Hydra restores discover their own physical targets after Ludusavi runs.
// Serialize the short file operations across providers to cover overlapping paths.
let saveOperationTail: Promise<unknown> = Promise.resolve();
let saveOperationActive = false;
const saveOperationContext = new AsyncLocalStorage<boolean>();
const withSaveFileGate = <T>(task: () => Promise<T>) => {
  if (saveOperationContext.getStore()) return task();
  const result = saveOperationTail
    .catch(() => undefined)
    .then(async () => {
      saveOperationActive = true;
      try {
        return await saveOperationContext.run(true, task);
      } finally {
        saveOperationActive = false;
      }
    });
  saveOperationTail = result.catch(() => undefined);
  return result;
};
export const runWithHydraSaveGuard = <T>(task: () => Promise<T>) =>
  withSaveFileGate(task);
export const isEpicSaveFileOperationActive = () => saveOperationActive;

export class EpicCloudSaveService {
  private readonly states = new Map<string, EpicCloudSaveState>();
  private readonly operations = new Map<string, Promise<EpicCloudSaveState>>();
  private readonly postExits = new Map<string, EpicPostExitTask>();
  private readonly controllers = new Set<AbortController>();
  private readonly captures = new Set<Promise<EpicSaveSession>>();
  private readonly sessions = new Map<string, EpicSaveSession>();
  private readonly launching = new Set<string>();
  private generation = 0;
  constructor(private readonly dependencies: EpicCloudSaveDependencies) {}

  private assertCurrent(session: EpicSaveSession, signal?: AbortSignal) {
    if (session.generation !== this.generation)
      throw new EpicSaveFailure("operation-cancelled");
    this.dependencies.runtime.assertCurrent(session.target, signal);
  }
  assertSessionCurrent(session: EpicSaveSession) {
    this.assertCurrent(session);
  }
  private async assertStopped(session: EpicSaveSession) {
    this.assertCurrent(session);
    await this.assertPrefixCurrent(session);
    const games = await gamesSublevel.values().all();
    const selected = games.find(
      (game) => game.shop === "epic" && game.objectId === session.objectId
    );
    if (
      games.some(
        (game) =>
          !game.isDeleted &&
          (isGameRunning(game.objectId, game.shop) ||
            (game.shop === "epic" && this.sessions.has(game.objectId))) &&
          ((game.shop === "epic" && game.objectId === session.objectId) ||
            (selected?.canonicalId &&
              game.canonicalId === selected.canonicalId))
      )
    )
      throw new EpicSaveFailure("game-running");
  }
  private async assertPrefixCurrent(session: EpicSaveSession) {
    if (!session.winePrefixPath) return;
    const game = await gamesSublevel.get(
      levelKeys.game("epic", session.objectId)
    );
    if (
      !game ||
      !session.prefixGeneration ||
      (await getEpicLinuxPrefixGeneration(session.winePrefixPath)) !==
        session.prefixGeneration ||
      (await resolveEpicLinuxPrefixPath(
        game,
        session.target.owner,
        session.target.artifactId
      )) !== session.winePrefixPath
    )
      throw new EpicSaveFailure("compatibility-prefix-invalid");
    this.assertCurrent(session);
  }
  private publish(
    session: EpicSaveSession,
    patch: Partial<EpicCloudSaveState>
  ) {
    this.assertCurrent(session);
    const previous = this.states.get(session.objectId);
    const state: EpicCloudSaveState = {
      epicObjectId: session.objectId,
      status: "idle",
      pendingUpload: false,
      remoteManifest: null,
      canRunOffline: session.installed.can_run_offline === true,
      ...previous,
      supportsCloudSaves: !!session.metadata.folder,
      automaticSync: session.automaticSync,
      savePath: session.savePath,
      ...patch,
    };
    this.states.set(session.objectId, state);
    this.dependencies.emit(state);
    return state;
  }
  private async persist(
    session: EpicSaveSession,
    patch: Partial<EpicInstallation>,
    signal?: AbortSignal
  ) {
    this.assertCurrent(session, signal);
    await updateGameRecord(levelKeys.game("epic", session.objectId), (game) => {
      this.assertCurrent(session, signal);
      if (
        !game.epicInstallation ||
        !epicOwnerMatches(game.epicInstallation.owner, session.target.owner) ||
        game.epicInstallation.artifactId !== session.target.artifactId
      )
        throw new EpicSaveFailure("operation-cancelled");
      return {
        ...game,
        epicInstallation: { ...game.epicInstallation, ...patch },
      };
    });
  }
  private async variables(
    owned: EpicOwnedGame,
    installed: EpicInstalledGame,
    winePrefixPath?: string | null
  ) {
    if (process.platform === "linux") {
      const profile =
        winePrefixPath && Wine.isPrefixReadyForRestore(winePrefixPath)
          ? Wine.getPrefixUserProfile(winePrefixPath)
          : null;
      return {
        "{installdir}": installed.installPath,
        "{epicid}": owned.owner.epicAccountId,
        ...(profile && winePrefixPath
          ? await linuxEpicSaveVariables(winePrefixPath, profile)
          : {}),
      };
    }
    const profile = app.getPath("home");
    const variables: Record<string, string> = {
      "{installdir}": installed.installPath,
      "{epicid}": owned.owner.epicAccountId,
      "{userprofile}": profile ?? "",
      "{userdir}": app.getPath("documents"),
      "{usersavedgames}": profile ? path.join(profile, "Saved Games") : "",
    };
    if (process.platform === "win32")
      variables["{appdata}"] = process.env.LOCALAPPDATA ?? "";
    else if (process.platform === "darwin") {
      variables["{appdata}"] = path.join(
        app.getPath("home"),
        "Library",
        "Application Support"
      );
      variables["{userlibrary}"] = path.join(app.getPath("home"), "Library");
    }
    return variables;
  }
  capture(
    objectId: string,
    signal: AbortSignal,
    winePrefixPath?: string | null,
    localOnly = false
  ): Promise<EpicSaveSession> {
    const generation = this.generation;
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    this.controllers.add(controller);
    const promise = this.captureCurrent(
      objectId,
      controller.signal,
      generation,
      winePrefixPath,
      localOnly
    );
    this.captures.add(promise);
    void promise
      .finally(() => {
        this.captures.delete(promise);
        this.controllers.delete(controller);
        signal.removeEventListener("abort", cancel);
      })
      .catch(() => undefined);
    return promise;
  }
  private async captureCurrent(
    objectId: string,
    signal: AbortSignal,
    generation: number,
    winePrefixPath?: string | null,
    localOnly = false
  ): Promise<EpicSaveSession> {
    const assertCaptureCurrent = () => {
      if (signal.aborted || generation !== this.generation)
        throw new EpicSaveFailure("operation-cancelled");
    };
    assertCaptureCurrent();
    const owned = localOnly
      ? await this.dependencies.installation.captureLocal(objectId, signal)
      : await this.dependencies.installation.capture(objectId, signal);
    assertCaptureCurrent();
    const installation = owned.game.epicInstallation;
    if (!installation || !epicOwnerMatches(installation.owner, owned.owner))
      throw new EpicSaveFailure("installation-missing");
    const target: EpicManagedTarget = {
      auth: owned.auth,
      connection: owned.connection,
      owner: owned.owner,
      artifactId: installation.artifactId,
      platform: installation.platform,
      ...(localOnly ? { localOnly: true } : {}),
    };
    this.dependencies.installation.assertPlatform(target.platform);
    return this.dependencies.runtime.serializeWorkspace(
      target,
      async (workspace) => {
        assertCaptureCurrent();
        const installed = await this.dependencies.installation.readInstalled(
          target,
          objectId
        );
        if (!installed) throw new EpicSaveFailure("installation-missing");
        const metadata = parseEpicSaveMetadata(
          await this.dependencies.installation.metadata(target),
          installation.platform
        );
        let effectivePrefix: string | undefined;
        let prefixGeneration: string | null | undefined;
        if (process.platform === "linux") {
          effectivePrefix = await resolveEpicLinuxPrefixPath(
            owned.game,
            owned.owner,
            installation.artifactId
          );
          if (
            winePrefixPath &&
            (await Wine.resolvePrefixPath(winePrefixPath)) !== effectivePrefix
          )
            throw new EpicSaveFailure("compatibility-prefix-invalid");
          prefixGeneration =
            await getEpicLinuxPrefixGeneration(effectivePrefix);
        }
        const variables = await this.variables(
          owned,
          installed,
          effectivePrefix
        );
        const interruptedTransfer =
          typeof installed.save_path === "string" &&
          /^save-transfer-[^\\/]+(?:[\\/]|$)/.test(
            path.relative(workspace, installed.save_path)
          );
        const configured =
          installation.savePath ??
          (interruptedTransfer ? undefined : installed.save_path);
        const automatic = resolveEpicSavePath(
          metadata.folder?.replace(/\\/g, "/") ?? null,
          variables
        );
        let source = installation.savePathSource;
        let resolved =
          source === "automatic" || !configured
            ? automatic
            : resolveEpicSavePath(configured, variables);
        let clearAnchor = false;
        let needsPathChoice = false;
        if (process.platform === "linux") {
          if (!prefixGeneration || !variables["{userprofile}"]) resolved = null;
          else {
            const automaticPath = automatic
              ? await resolveLinuxEpicSavePath(automatic)
              : null;
            const configuredPath = resolved
              ? await Wine.resolvePrefixPath(resolved)
              : null;
            if (!source && (!configured || configuredPath === automaticPath))
              source = "automatic";
            const changedGeneration =
              installation.savePathPrefixGeneration !== prefixGeneration;
            // A legacy absolute path has no proven provenance. It may belong to an
            // older prefix even when no generation was ever recorded.
            needsPathChoice =
              !source &&
              Boolean(configured) &&
              configuredPath !== automaticPath;
            clearAnchor =
              changedGeneration ||
              (source === "automatic" &&
                installation.savePath !== automaticPath);
            if (needsPathChoice) resolved = null;
            else
              resolved =
                source === "automatic" ? automaticPath : configuredPath;
          }
        }
        const home = path.resolve(app.getPath("home"));
        const savePath =
          resolved && path.resolve(resolved) !== home ? resolved : null;
        const session: EpicSaveSession = {
          objectId,
          target,
          installed,
          metadata,
          savePath,
          automaticSync:
            installation.automaticSaveSync !== false && !!metadata.folder,
          generation,
          ...(effectivePrefix
            ? { winePrefixPath: effectivePrefix, prefixGeneration }
            : {}),
          ...(source ? { savePathSource: source } : {}),
        };
        this.assertCurrent(session, signal);
        if (
          process.platform === "linux" &&
          prefixGeneration &&
          (clearAnchor ||
            source !== installation.savePathSource ||
            (!needsPathChoice &&
              installation.savePathPrefixGeneration !== prefixGeneration))
        ) {
          await this.persist(
            session,
            {
              ...(source ? { savePathSource: source } : {}),
              ...(!needsPathChoice
                ? { savePathPrefixGeneration: prefixGeneration }
                : {}),
              ...(source === "automatic" ? { savePath } : {}),
              ...(clearAnchor ? { saveAnchor: undefined } : {}),
            },
            signal
          );
          this.assertCurrent(session, signal);
          this.states.delete(objectId);
        }
        if (interruptedTransfer) {
          // An unresolved Linux prefix or legacy path still requires an explicit choice.
          if (process.platform !== "linux" || savePath !== null)
            await this.persist(session, { savePath }, signal);
          this.assertCurrent(session, signal);
          await this.restoreRealSavePath(
            session,
            path.join(workspace, "installed.json")
          );
          installed.save_path = savePath;
        }
        this.assertCurrent(session, signal);
        return session;
      },
      signal
    );
  }
  async getState(objectId: string): Promise<EpicCloudSaveState> {
    const retained = this.states.get(objectId);
    if (retained && process.platform !== "linux") return retained;
    const generation = this.generation;
    const controller = new AbortController();
    try {
      const session = await this.capture(
        objectId,
        controller.signal,
        undefined,
        process.platform === "linux" && Boolean(retained)
      );
      const game = await gamesSublevel.get(levelKeys.game("epic", objectId));
      const error = !session.metadata.folder
        ? "saves-unsupported"
        : !session.savePath
          ? "save-path-required"
          : undefined;
      const currentState = this.states.get(objectId);
      if (!error && currentState && currentState.savePath === session.savePath)
        return this.publish(session, {
          ...currentState,
          automaticSync: session.automaticSync,
        });
      return this.publish(session, {
        status: error
          ? "unavailable"
          : game?.epicInstallation?.pendingSaveUpload
            ? "pending-upload"
            : "idle",
        pendingUpload: game?.epicInstallation?.pendingSaveUpload === true,
        remoteManifest:
          game?.epicInstallation?.saveAnchor?.remoteManifest ?? null,
        remoteModifiedAt:
          game?.epicInstallation?.saveAnchor?.remoteModifiedAt ?? null,
        error,
      });
    } catch (error) {
      if (generation !== this.generation) controller.abort();
      // A previously verified installed game can advertise its offline capability
      // without performing a remote save operation or trusting a new identity.
      try {
        const local = await this.capture(
          objectId,
          controller.signal,
          undefined,
          true
        );
        const game = await gamesSublevel.get(levelKeys.game("epic", objectId));
        return this.publish(local, {
          status: "unavailable",
          pendingUpload: game?.epicInstallation?.pendingSaveUpload === true,
          remoteManifest:
            game?.epicInstallation?.saveAnchor?.remoteManifest ?? null,
          remoteModifiedAt:
            game?.epicInstallation?.saveAnchor?.remoteModifiedAt ?? null,
          error: this.errorCode(error),
        });
      } catch {
        return {
          epicObjectId: objectId,
          status: "unavailable",
          supportsCloudSaves: false,
          automaticSync: false,
          savePath: null,
          pendingUpload: false,
          remoteManifest: null,
          error: this.errorCode(error),
        };
      }
    }
  }
  async setSettings(objectId: string, settings: EpicCloudSaveSettings) {
    const controller = new AbortController();
    const session = await this.capture(
      objectId,
      controller.signal,
      undefined,
      true
    );
    await this.assertStopped(session);
    if (
      this.operations.has(objectId) ||
      this.postExits.has(objectId) ||
      this.launching.has(objectId)
    )
      throw new EpicSaveFailure("save-operation-active");
    if (
      settings.savePath !== undefined &&
      settings.savePath !== null &&
      !resolveEpicSavePath(settings.savePath, {})
    )
      throw new EpicSaveFailure("invalid-path");
    const saveSettings = () =>
      this.persist(session, {
        automaticSaveSync: settings.automaticSync,
        ...(settings.savePath !== undefined
          ? {
              savePath: settings.savePath,
              savePathSource:
                settings.savePath === null ? "automatic" : "custom",
              savePathPrefixGeneration: session.prefixGeneration ?? undefined,
              saveAnchor: undefined,
            }
          : {}),
      });
    await withSaveFileGate(() =>
      session.winePrefixPath
        ? withEpicLinuxPrefixMutation(
            session.winePrefixPath,
            saveSettings,
            session.linuxPrefixLeaseId
          )
        : saveSettings()
    );
    this.states.delete(objectId);
    // Settings may change from Hydra's cloud save toggle; refresh open views.
    void this.getState(objectId)
      .then((state) => this.dependencies.emit(state))
      .catch(() => undefined);
    return { ok: true as const };
  }
  private async listRemote(session: EpicSaveSession, signal: AbortSignal) {
    const manifest = await this.dependencies.source.latest(
      session.target,
      signal
    );
    this.assertCurrent(session, signal);
    this.publish(session, {
      remoteManifest: manifest?.name ?? null,
      remoteModifiedAt: manifest?.lastModified ?? null,
    });
    return manifest;
  }
  private async transfer(
    session: EpicSaveSession,
    signal: AbortSignal,
    directory: string,
    direction: "upload" | "download"
  ) {
    const workspace = this.dependencies.runtime.workspace(session.target);
    const installedFile = path.join(workspace, "installed.json");
    // This durable path survives a crash before the CLI's staging path is restored.
    await this.persist(session, { savePath: session.savePath });
    try {
      const result = await this.dependencies.runtime.runRawUnlocked(
        session.target,
        [
          "-y",
          "sync-saves",
          session.target.artifactId,
          direction === "upload" ? "--skip-download" : "--skip-upload",
          direction === "upload" ? "--force-upload" : "--force-download",
          "--save-path",
          directory,
        ],
        { signal, timeout: EPIC_SAVE_SYNC_TIMEOUT_MS }
      );
      assertEpicSaveCommandSucceeded(result, direction);
      this.assertCurrent(session, signal);
    } finally {
      // The CLI persists --save-path. Never leave a staging directory as the real save folder.
      await this.restoreRealSavePath(session, installedFile);
    }
  }
  private async restoreRealSavePath(
    session: EpicSaveSession,
    installedFile: string
  ) {
    const input = await readManagedJson(installedFile);
    const entry = isRecord(input) ? input[session.target.artifactId] : null;
    if (!isRecord(entry)) throw new EpicSaveFailure("installation-incomplete");
    entry.save_path = session.savePath;
    await writeManagedJson(installedFile, input);
  }
  private async commitAnchor(
    session: EpicSaveSession,
    snapshot: EpicSaveSnapshot,
    remote: EpicRemoteSaveManifest | null
  ) {
    await this.assertPrefixCurrent(session);
    await this.persist(session, {
      savePath: session.savePath,
      ...(session.savePathSource
        ? { savePathSource: session.savePathSource }
        : {}),
      ...(session.prefixGeneration
        ? { savePathPrefixGeneration: session.prefixGeneration }
        : {}),
      saveAnchor: {
        remoteManifest: remote?.name ?? null,
        remoteModifiedAt: remote?.lastModified ?? null,
        localDigest: snapshot.digest,
      },
      pendingSaveUpload: false,
    });
    return this.publish(session, {
      status: "up-to-date",
      localModifiedAt: getEpicSaveSnapshotModifiedAt(snapshot),
      phase: undefined,
      pendingUpload: false,
      remoteManifest: remote?.name ?? null,
      remoteModifiedAt: remote?.lastModified ?? null,
      error: undefined,
    });
  }
  // Identical content is not a conflict: EGS and Hydra installs share save folders,
  // and an upload whose verification failed already left the local content remote.
  private async remoteMatchesLocal(
    session: EpicSaveSession,
    signal: AbortSignal,
    workspace: string,
    remote: EpicRemoteSaveManifest,
    localDigest: string
  ) {
    const temporary = await fs.mkdtemp(path.join(workspace, "save-transfer-"));
    try {
      const staging = path.join(temporary, "staging");
      await fs.mkdir(staging, { mode: 0o700 });
      await this.assertStopped(session);
      this.publish(session, { phase: "downloading" });
      await this.transfer(session, signal, staging, "download");
      const incoming = await inspectEpicSaveFiles(
        staging,
        session.metadata,
        signal
      );
      if (incoming.digest !== localDigest) return false;
      if (
        !sameEpicRemoteSaveManifest(
          await this.listRemote(session, signal),
          remote
        )
      )
        return false;
      const local = await inspectEpicSaveFiles(
        session.savePath!,
        session.metadata,
        signal
      );
      if (local.digest !== localDigest) return false;
      await this.assertStopped(session);
      return true;
    } catch (error) {
      this.assertCurrent(session, signal);
      if (
        error instanceof EpicSaveFailure &&
        (error.code === "operation-cancelled" ||
          error.code === "game-running" ||
          error.code === "installation-incomplete")
      )
        throw error;
      // A failed comparison falls back to asking the user.
      logger.warn("Epic save comparison failed; reporting a conflict", error);
      return false;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  private async synchronize(
    session: EpicSaveSession,
    signal: AbortSignal,
    choice?: {
      remoteManifest: string | null;
      remoteModifiedAt: string | null;
      value: "local" | "remote";
    },
    postExit?: EpicPostExitTask
  ): Promise<EpicCloudSaveState> {
    if (!session.metadata.folder)
      return this.publish(session, {
        status: "unavailable",
        error: "saves-unsupported",
      });
    if (!session.savePath)
      return this.publish(session, {
        status: "unavailable",
        error: "save-path-required",
      });
    await this.assertStopped(session);
    return withSaveFileGate(() => {
      const synchronizeFiles = () =>
        this.dependencies.runtime.serializeWorkspace(
          session.target,
          async (workspace) => {
            await this.assertStopped(session);
            this.publish(session, {
              status: "syncing",
              phase: "checking",
              error: undefined,
              localModifiedAt: null,
              remoteModifiedAt: null,
            });
            const before = await inspectEpicSaveFiles(
              session.savePath!,
              session.metadata,
              signal
            );
            this.assertCurrent(session, signal);
            this.publish(session, {
              localModifiedAt: getEpicSaveSnapshotModifiedAt(before),
            });
            // Reopening can cancel inspection until the first cloud command starts.
            // Once a command is requested, its captured task must finish before launch.
            if (postExit) postExit.commandStarted = true;
            const remote = await this.listRemote(session, signal);
            const game = await gamesSublevel.get(
              levelKeys.game("epic", session.objectId)
            );
            this.assertCurrent(session, signal);
            if (
              choice &&
              (choice.remoteManifest !== (remote?.name ?? null) ||
                choice.remoteModifiedAt !== (remote?.lastModified ?? null))
            )
              return this.publish(session, {
                status: "conflict",
                phase: undefined,
                remoteManifest: remote?.name ?? null,
                error: "save-conflict",
              });
            const action = choice
              ? choice.value === "local"
                ? "upload"
                : "download"
              : decideEpicSaveSync(
                  game?.epicInstallation?.saveAnchor,
                  before.digest,
                  before.files.length,
                  remote,
                  game?.epicInstallation?.pendingSaveUpload === true
                );
            if (action === "conflict") {
              if (
                remote &&
                before.files.length &&
                (await this.remoteMatchesLocal(
                  session,
                  signal,
                  workspace,
                  remote,
                  before.digest
                ))
              )
                return this.commitAnchor(session, before, remote);
              return this.publish(session, {
                status: "conflict",
                phase: undefined,
                remoteManifest: remote?.name ?? null,
                error: "save-conflict",
              });
            }
            if (action === "same")
              return this.commitAnchor(session, before, remote);
            const temporary = await fs.mkdtemp(
              path.join(workspace, "save-transfer-")
            );
            let preserveRecovery = false;
            try {
              const staging = path.join(temporary, "staging");
              await fs.mkdir(staging, { mode: 0o700 });
              if (action === "download") {
                if (!remote)
                  return this.publish(session, {
                    status: "conflict",
                    phase: undefined,
                    remoteManifest: null,
                    error: "save-conflict",
                  });
                this.publish(session, { phase: "downloading" });
                await this.transfer(session, signal, staging, "download");
                if (
                  !sameEpicRemoteSaveManifest(
                    await this.listRemote(session, signal),
                    remote
                  )
                )
                  throw new EpicSaveFailure("save-conflict");
                await this.assertStopped(session);
                this.publish(session, { phase: "restoring" });
                await this.persist(session, { pendingSaveUpload: true });
                const restored = await applyEpicSaveSnapshot(
                  staging,
                  session.savePath!,
                  path.join(temporary, "backup"),
                  session.metadata,
                  before.digest,
                  () => this.assertCurrent(session, signal)
                );
                return this.commitAnchor(session, restored, remote);
              }
              // An upload always starts from a stable private copy, never from live save files.
              await this.persist(session, { pendingSaveUpload: true });
              await copyEpicSaveSnapshot(session.savePath!, staging, before);
              const stable = await inspectEpicSaveFiles(
                staging,
                session.metadata,
                signal
              );
              if (
                stable.digest !== before.digest ||
                (
                  await inspectEpicSaveFiles(
                    session.savePath!,
                    session.metadata,
                    signal
                  )
                ).digest !== before.digest
              )
                throw new EpicSaveFailure("save-operation-active");
              if (!stable.files.length)
                throw new EpicSaveFailure("save-verification-failed");
              if (
                !sameEpicRemoteSaveManifest(
                  await this.listRemote(session, signal),
                  remote
                )
              )
                throw new EpicSaveFailure("save-conflict");
              await this.assertStopped(session);
              this.publish(session, {
                phase: "uploading",
                pendingUpload: true,
              });
              await this.transfer(session, signal, staging, "upload");
              const uploadedManifest = await this.listRemote(session, signal);
              if (!uploadedManifest)
                throw new EpicSaveFailure("save-verification-failed");
              this.publish(session, { phase: "verifying" });
              const verification = path.join(temporary, "verification");
              await fs.mkdir(verification);
              await this.transfer(session, signal, verification, "download");
              const readback = await inspectEpicSaveFiles(
                verification,
                session.metadata,
                signal
              );
              if (
                readback.digest !== stable.digest ||
                !sameEpicRemoteSaveManifest(
                  await this.listRemote(session, signal),
                  uploadedManifest
                )
              )
                throw new EpicSaveFailure("save-verification-failed");
              // The anchor records what was uploaded, so an external local edit remains detectable.
              return this.commitAnchor(session, stable, uploadedManifest);
            } catch (error) {
              preserveRecovery = error instanceof EpicSaveRollbackFailure;
              throw error;
            } finally {
              if (!preserveRecovery)
                await fs.rm(temporary, { recursive: true, force: true });
            }
          },
          signal
        );
      return session.winePrefixPath
        ? withEpicLinuxPrefixMutation(
            session.winePrefixPath,
            synchronizeFiles,
            session.linuxPrefixLeaseId
          )
        : synchronizeFiles();
    });
  }
  private errorCode(
    error: unknown
  ): import("../../../types/epic-managed.types").EpicSaveError {
    if (error instanceof EpicSaveFailure) return error.code;
    const code = epicManagedErrorCode(error);
    return code === "process-failed" ? "save-sync-failed" : code;
  }
  private operation(
    session: EpicSaveSession,
    choice?: {
      remoteManifest: string | null;
      remoteModifiedAt: string | null;
      value: "local" | "remote";
    },
    postExit?: EpicPostExitTask
  ) {
    if (
      this.launching.has(session.objectId) &&
      !saveOperationContext.getStore()
    )
      throw new EpicSaveFailure("save-operation-active");
    const existing = this.operations.get(session.objectId);
    if (existing !== undefined) return existing;
    const controller = new AbortController();
    const cancelPostExit = () => controller.abort();
    postExit?.controller.signal.addEventListener("abort", cancelPostExit, {
      once: true,
    });
    if (postExit?.controller.signal.aborted) cancelPostExit();
    const timeout = setTimeout(
      () => controller.abort(),
      EPIC_SAVE_SYNC_TIMEOUT_MS
    );
    this.controllers.add(controller);
    const promise = this.synchronize(
      session,
      controller.signal,
      choice,
      postExit
    )
      .catch(async (error: unknown) => {
        this.assertCurrent(session);
        const game = await gamesSublevel.get(
          levelKeys.game("epic", session.objectId)
        );
        return this.publish(session, {
          status:
            error instanceof EpicSaveFailure && error.code === "save-conflict"
              ? "conflict"
              : game?.epicInstallation?.pendingSaveUpload
                ? "pending-upload"
                : "unavailable",
          phase: undefined,
          pendingUpload: game?.epicInstallation?.pendingSaveUpload === true,
          error:
            postExit?.controller.signal.aborted && !postExit.commandStarted
              ? undefined
              : this.errorCode(error),
        });
      })
      .finally(() => {
        clearTimeout(timeout);
        this.controllers.delete(controller);
        postExit?.controller.signal.removeEventListener(
          "abort",
          cancelPostExit
        );
        if (this.operations.get(session.objectId) === promise)
          this.operations.delete(session.objectId);
      });
    this.operations.set(session.objectId, promise);
    return promise;
  }
  async sync(objectId: string) {
    await this.postExits.get(objectId)?.promise;
    return this.operation(
      await this.capture(objectId, new AbortController().signal)
    );
  }
  async resolveConflict(payload: ResolveEpicCloudSaveConflictPayload) {
    const session = await this.capture(
      payload.epicObjectId,
      new AbortController().signal
    );
    if (this.states.get(payload.epicObjectId)?.status !== "conflict")
      throw new EpicSaveFailure("save-conflict");
    return this.operation(session, {
      remoteManifest: payload.expectedRemoteManifest,
      remoteModifiedAt: payload.expectedRemoteModifiedAt,
      value: payload.choice,
    });
  }
  async beforeLaunch(session: EpicSaveSession, localOnce = false) {
    this.assertCurrent(session);
    if (!session.metadata.folder || !session.automaticSync) return;
    if (localOnce) {
      await this.persist(session, { pendingSaveUpload: true });
      this.publish(session, { status: "pending-upload", pendingUpload: true });
      session.automaticSync = false;
      return;
    }
    const state = await this.operation(session);
    if (state.status !== "up-to-date")
      throw new EpicSaveFailure(state.error ?? "save-sync-failed");
  }
  async runLaunchGate<T>(objectId: string, task: () => Promise<T>): Promise<T> {
    for (;;) {
      const postExit = this.postExits.get(objectId);
      if (postExit && !postExit.commandStarted) postExit.controller.abort();
      await postExit?.promise;
      await this.operations.get(objectId);
      const result = await withSaveFileGate(async () => {
        // An operation can start while this launch waits for another provider.
        // Release the file gate before waiting for it, then acquire again.
        if (this.postExits.has(objectId) || this.operations.has(objectId))
          return { retry: true } as const;
        this.launching.add(objectId);
        try {
          return { retry: false, value: await task() } as const;
        } finally {
          this.launching.delete(objectId);
        }
      });
      if (!result.retry) return result.value;
    }
  }
  async markSessionStarted(session: EpicSaveSession) {
    this.assertCurrent(session);
    await this.assertPrefixCurrent(session);
    if (session.metadata.folder && session.automaticSync)
      await this.persist(session, { pendingSaveUpload: true });
    this.assertCurrent(session);
    this.sessions.set(session.objectId, session);
  }
  endSession(session: EpicSaveSession) {
    if (this.sessions.get(session.objectId) === session)
      this.sessions.delete(session.objectId);
  }
  afterClose(session: EpicSaveSession) {
    this.endSession(session);
    const existing = this.postExits.get(session.objectId);
    if (existing) return existing.promise;
    const task: EpicPostExitTask = {
      session,
      controller: new AbortController(),
      commandStarted: false,
      promise: Promise.resolve(undefined),
    };
    const promise = this.afterCloseStable(session, task)
      .catch(async (error: unknown) => {
        // A stale captured session cannot publish into the replacement account.
        this.assertCurrent(session);
        await this.persist(session, { pendingSaveUpload: true });
        return this.publish(session, {
          status: "pending-upload",
          phase: undefined,
          pendingUpload: true,
          error:
            task.controller.signal.aborted && !task.commandStarted
              ? undefined
              : this.errorCode(error),
        });
      })
      .finally(() => {
        if (this.postExits.get(session.objectId) === task)
          this.postExits.delete(session.objectId);
      });
    task.promise = promise;
    this.postExits.set(session.objectId, task);
    return promise;
  }
  private async afterCloseStable(
    session: EpicSaveSession,
    task: EpicPostExitTask
  ) {
    const signal = task.controller.signal;
    this.assertCurrent(session, signal);
    await this.assertPrefixCurrent(session);
    if (!session.metadata.folder || !session.automaticSync) return;
    if (session.savePath) {
      let previous = await inspectEpicSaveFiles(
        session.savePath,
        session.metadata,
        signal
      );
      let stable = false;
      for (let attempt = 0; attempt < EPIC_SAVE_STABILITY_ATTEMPTS; attempt++) {
        await delay(EPIC_SAVE_STABILITY_DELAY_MS, undefined, { signal });
        this.assertCurrent(session, signal);
        const next = await inspectEpicSaveFiles(
          session.savePath,
          session.metadata,
          signal
        );
        if (next.digest === previous.digest) {
          stable = true;
          break;
        }
        previous = next;
      }
      if (!stable) {
        await this.persist(session, { pendingSaveUpload: true });
        return this.publish(session, {
          status: "pending-upload",
          pendingUpload: true,
          error: "save-operation-active",
        });
      }
    }
    this.assertCurrent(session, signal);
    return this.operation(session, undefined, task);
  }
  async invalidate() {
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    for (const task of this.postExits.values()) task.controller.abort();
    await Promise.allSettled([
      ...this.captures,
      ...this.operations.values(),
      ...[...this.postExits.values()].map((task) => task.promise),
    ]);
    this.states.clear();
    this.sessions.clear();
    this.launching.clear();
  }
}

let service: EpicCloudSaveService | null = null;
export const configureEpicCloudSaves = (
  dependencies: EpicCloudSaveDependencies
) => (service = new EpicCloudSaveService(dependencies));
export const getEpicCloudSaveService = () => {
  if (!service) throw new EpicSaveFailure("legendary-unavailable");
  return service;
};
