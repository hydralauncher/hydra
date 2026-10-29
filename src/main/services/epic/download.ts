import fs from "node:fs/promises";
import path from "node:path";
import stringArgv from "string-argv";
import { runElevatedEpicPrerequisite } from "./prerequisite-runtime.js";
import type { Download, Game } from "../../../types/level.types";
import type { DownloadProgress } from "../../../types/download.types";
import type {
  StartEpicGameDownloadPayload,
  StartEpicGameUpdatePayload,
  EpicInstallSelection,
  EpicManagedOperationResult,
} from "../../../types/epic-managed.types";
import {
  Downloader,
  MINIMUM_FREE_DISK_SPACE_BYTES,
} from "../../../shared/constants.js";
import { isRecord } from "./auth-protocol.js";
import {
  EPIC_INSTALL_OPTIONS_TIMEOUT_MS,
  EPIC_PREREQUISITE_TIMEOUT_MS,
} from "./constants.js";
import { markEpicTiming, withEpicTiming } from "./timing.js";
import {
  EpicManagedError,
  EpicManagedSpawnError,
  epicManagedErrorCode,
  executeManagedLegendary,
  epicOwnerMatches,
  type EpicManagedTarget,
  type LegendaryManagedRuntime,
} from "./legendary-managed-runtime.js";
import {
  epicManagedTarget,
  forgetEpicInstalledEntries,
  isPathContained,
  readManagedJson,
  writeManagedJson,
  type EpicInstallationService,
  type EpicInstalledGame,
  type EpicOwnedGame,
  type EpicPreparedDlc,
  type EpicPreparedInstallation,
  EPIC_MAX_INSTALL_TAGS,
  isEpicInstallTag,
  isEpicSelectionId,
  isSafeEpicArtifact,
} from "./installation.js";

const MIB_BYTES = 1024 * 1024;
const SECONDS_TO_MILLISECONDS = 1_000;
const WINDOWS_REBOOT_REQUIRED_EXIT_CODE = 3010;
const WINDOWS_REBOOT_INITIATED_EXIT_CODE = 1641;

export interface EpicDownloadTelemetry {
  progress: number;
  bytesDownloaded: number;
  fileSize: number;
  downloadSpeed: number;
  timeRemaining: number;
  preparing: boolean;
  failed: boolean;
}

/** Legendary 0.21.1 progress is current-run chunks; resumed bytes are carried separately. */
export class EpicDownloadProgressParser {
  private reusedBytes = 0;
  readonly state: EpicDownloadTelemetry;
  constructor(fileSize: number, previousBytes = 0, previousProgress = 0) {
    const persistedProgress = Number.isFinite(previousProgress)
      ? Math.min(1, Math.max(0, previousProgress))
      : 0;
    this.state = {
      fileSize,
      bytesDownloaded: Math.max(0, previousBytes),
      // Chunk completion and compressed byte completion need not be proportional.
      // Preserve the last displayed percentage independently from transferred bytes.
      progress: Math.max(
        persistedProgress,
        fileSize > 0 ? Math.min(previousBytes / fileSize, 1) : 0
      ),
      downloadSpeed: 0,
      timeRemaining: -1,
      preparing: true,
      failed: false,
    };
  }
  line(line: string) {
    if (
      /Installation failed|\[cli\] (?:ERROR|CRITICAL):|\[DLManager\] CRITICAL:/i.test(
        line
      )
    )
      this.state.failed = true;
    const downloadSize = /Download size:\s*([\d.]+)\s*MiB/i.exec(line);
    if (downloadSize) {
      const remaining = Number(downloadSize[1]) * MIB_BYTES;
      const updateDeltaPending = this.state.fileSize <= 0;
      if (Number.isFinite(remaining) && updateDeltaPending)
        this.state.fileSize = Math.round(remaining);
      if (Number.isFinite(remaining))
        this.reusedBytes = Math.max(0, this.state.fileSize - remaining);
      this.state.bytesDownloaded = Math.max(
        this.state.bytesDownloaded,
        this.reusedBytes
      );
      this.state.preparing = false;
    } else if (/Download size is 0\b/.test(line)) this.state.preparing = false;
    const downloaded = /Downloaded:\s*([\d.]+)\s*MiB/i.exec(line);
    if (downloaded) {
      const value = this.reusedBytes + Number(downloaded[1]) * MIB_BYTES;
      if (Number.isFinite(value))
        this.state.bytesDownloaded = Math.min(
          this.state.fileSize,
          Math.max(this.state.bytesDownloaded, value)
        );
    }
    const progress = /Progress:\s*([\d.]+)%/i.exec(line);
    if (progress) {
      const partial = Math.min(1, Math.max(0, Number(progress[1]) / 100));
      const full =
        this.state.fileSize > 0
          ? (this.reusedBytes +
              partial * (this.state.fileSize - this.reusedBytes)) /
            this.state.fileSize
          : partial;
      if (Number.isFinite(full))
        this.state.progress = Math.max(this.state.progress, full);
      const eta = /ETA:\s*(\d+):(\d+):(\d+)/.exec(line);
      if (eta) {
        const seconds =
          Number(eta[1]) * 3600 + Number(eta[2]) * 60 + Number(eta[3]);
        this.state.timeRemaining =
          seconds > 0 || full === 1 ? seconds * SECONDS_TO_MILLISECONDS : -1;
      }
    }
    const speed = /\+ Download\s*-\s*([\d.]+)\s*MiB\/s\s*\(raw\)/i.exec(line);
    if (speed) this.state.downloadSpeed = Number(speed[1]) * MIB_BYTES;
  }
}

interface DownloadServiceOptions {
  platform?: NodeJS.Platform;
  runtime: LegendaryManagedRuntime;
  installation: EpicInstallationService;
  getDownload: (id: string) => Promise<Download | undefined>;
  putDownload: (id: string, value: Download) => Promise<unknown>;
  startPreparedDownload: (download: Download) => Promise<unknown>;
  enqueuePreparedDownload: (download: Download) => Promise<unknown>;
  isGameRunning: (game: Game) => boolean;
  getDiskUsage: (directory: string) => Promise<{ free: number } | null>;
  afterGameUpdated?: () => void;
  runPrerequisite?: (
    executable: string,
    args: string[],
    signal: AbortSignal
  ) => Promise<boolean>;
}
interface ActiveEpicDownload {
  prepared: EpicPreparedInstallation;
  id: string;
  controller: AbortController;
  target: EpicManagedTarget;
  download: Download;
  currentRunParser: EpicDownloadProgressParser;
  finishedRunsBytes: number;
  plannedTotalBytes: number | null;
  selection: ResolvedEpicSelection;
  done: Promise<void>;
  completed: boolean;
  version: string;
  isCurrent: () => boolean;
}

export async function getReusableEpicDiskBytes(
  directory: string
): Promise<number> {
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new EpicManagedError("invalid-path");
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let size = 0;
  for (const entry of await fs.readdir(directory))
    size += await getReusableEpicDiskBytes(path.join(directory, entry));
  return size;
}

export { quoteWindowsEpicArgument } from "./prerequisite-runtime.js";

export interface ResolvedEpicSelection {
  selection: EpicInstallSelection;
  dlcs: EpicPreparedDlc[];
  gameDownloadSizeInBytes: number;
  downloadSizeInBytes: number;
  diskSizeInBytes: number;
}

const hasDuplicateIds = (values: string[] | undefined) =>
  values !== undefined && new Set(values).size !== values.length;

export function installedEpicComponents(
  prepared: EpicPreparedInstallation,
  installTags: string[]
): string[] | undefined {
  const selective = prepared.selective;
  if (!selective || !installTags.length) return undefined;
  const tags = new Set(installTags);
  return selective.packs
    .filter((pack) => pack.tags.every((tag) => tags.has(tag)))
    .map((pack) => pack.id);
}

export function withoutInstalledEpicGame(
  resolved: ResolvedEpicSelection
): ResolvedEpicSelection {
  return {
    ...resolved,
    selection: { ...resolved.selection, gameAlreadyInstalled: true },
    gameDownloadSizeInBytes: 0,
    downloadSizeInBytes:
      resolved.downloadSizeInBytes - resolved.gameDownloadSizeInBytes,
  };
}

export function withInstalledEpicDlcs(
  prepared: EpicPreparedInstallation,
  requested: string[] | undefined,
  installed: ReadonlyMap<string, string>
): string[] | undefined {
  const extra = (prepared.dlcs ?? [])
    .filter(
      (dlc) =>
        installed.has(dlc.artifactId) &&
        installed.get(dlc.artifactId) !== dlc.version &&
        !requested?.includes(dlc.artifactId)
    )
    .map((dlc) => dlc.artifactId);
  if (!extra.length) return requested;
  return [...(requested ?? []), ...extra];
}

export function resolveEpicSelection(
  prepared: EpicPreparedInstallation,
  request: { components?: string[]; dlcs?: string[] }
): ResolvedEpicSelection {
  if (hasDuplicateIds(request.components) || hasDuplicateIds(request.dlcs))
    throw new EpicManagedError("invalid-selection");
  const selective = prepared.selective;
  const packs = (request.components ?? []).map((id) => {
    const pack = selective?.packs.find((candidate) => candidate.id === id);
    if (!pack) throw new EpicManagedError("invalid-selection");
    return pack;
  });
  const dlcs = (request.dlcs ?? []).map((artifactId) => {
    const dlc = prepared.dlcs?.find(
      (candidate) => candidate.artifactId === artifactId
    );
    if (!dlc) throw new EpicManagedError("invalid-selection");
    return dlc;
  });
  const skipsSomePack =
    !!selective &&
    request.components !== undefined &&
    packs.length < selective.packs.length;
  const installTags = skipsSomePack
    ? [
        ...new Set([
          "",
          ...selective.requiredTags,
          ...packs.flatMap((pack) => pack.tags),
        ]),
      ]
    : [];
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const gameDownloadSizeInBytes = skipsSomePack
    ? selective.downloadSizeInBytes +
      sum(packs.map((pack) => pack.downloadSizeInBytes))
    : prepared.downloadSizeInBytes;
  const gameDiskSizeInBytes = skipsSomePack
    ? selective.diskSizeInBytes + sum(packs.map((pack) => pack.diskSizeInBytes))
    : prepared.diskSizeInBytes;
  return {
    selection: {
      ...(request.components !== undefined
        ? { components: [...request.components] }
        : {}),
      installTags,
      dlcs: dlcs.map((dlc) => dlc.artifactId),
    },
    dlcs,
    gameDownloadSizeInBytes,
    downloadSizeInBytes:
      gameDownloadSizeInBytes + sum(dlcs.map((dlc) => dlc.downloadSizeInBytes)),
    diskSizeInBytes:
      gameDiskSizeInBytes + sum(dlcs.map((dlc) => dlc.diskSizeInBytes)),
  };
}

export function epicInstallTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.length > EPIC_MAX_INSTALL_TAGS ||
    !value.every(isEpicInstallTag)
  )
    throw new EpicManagedError("installation-incomplete");
  return [...new Set(value)];
}

export function epicInstallArgs(options: {
  artifactId: string;
  platform: string;
  basePath: string;
  folderName: string;
  installTags?: string[];
}) {
  return [
    "-y",
    "install",
    options.artifactId,
    "--platform",
    options.platform,
    "--base-path",
    options.basePath,
    "--game-folder",
    options.folderName,
    "--skip-dlcs",
    "--skip-sdl",
    ...(options.installTags ?? []).map((tag) => `--install-tag=${tag}`),
  ];
}

async function runDirectEpicPrerequisite(
  executable: string,
  args: string[],
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted) throw new EpicManagedError("operation-cancelled");
  await executeManagedLegendary(executable, args, path.dirname(executable), {
    signal,
    timeout: EPIC_PREREQUISITE_TIMEOUT_MS,
    successExitCodes: [
      0,
      WINDOWS_REBOOT_REQUIRED_EXIT_CODE,
      WINDOWS_REBOOT_INITIATED_EXIT_CODE,
    ],
  });
  return true;
}

export async function runEpicPrerequisite(
  executable: string,
  args: string[],
  signal: AbortSignal
): Promise<boolean> {
  try {
    return await runDirectEpicPrerequisite(executable, args, signal);
  } catch (error) {
    if (error instanceof EpicManagedError && error.code === "cleanup-failed")
      throw error;
    if (signal.aborted) throw new EpicManagedError("operation-cancelled");
    const code =
      error instanceof EpicManagedSpawnError ? error.nativeCode : undefined;
    if (
      process.platform === "win32" &&
      ["EACCES", "EPERM", "UNKNOWN"].includes(code ?? "")
    )
      return runElevatedEpicPrerequisite(executable, args, signal);
    if (error instanceof EpicManagedError) throw error;
    throw new EpicManagedError("prerequisites-required");
  }
}

export class EpicDownloadService {
  private active: ActiveEpicDownload | null = null;
  private readonly removals = new Set<string>();
  private preparing: {
    id: string;
    controller: AbortController;
    done: Promise<void>;
  } | null = null;
  private readonly enqueues = new Map<
    string,
    { controller: AbortController; done: Promise<EpicManagedOperationResult> }
  >();
  constructor(private readonly options: DownloadServiceOptions) {}
  getOptions(objectId: string, signal?: AbortSignal) {
    return this.options.installation.getOptions(objectId, signal);
  }
  invalidateOptions(objectId: string) {
    this.options.installation.invalidateOptions(objectId);
  }
  private id(objectId: string) {
    return `epic:${objectId}`;
  }
  /** Adopts an Epic Games Store install as a completed Hydra download. */
  async importStoreInstallation(
    objectId: string,
    store: { artifactId: string; installLocation: string },
    signal: AbortSignal
  ) {
    const id = this.id(objectId);
    if (this.enqueues.has(id) || this.removals.has(id))
      throw new EpicManagedError("operation-in-progress");
    if (await this.options.getDownload(id))
      throw new EpicManagedError("operation-in-progress");
    const { owned, target, installed } =
      await this.options.installation.importExisting(objectId, store, signal);
    // Removing files later deletes downloadPath/folderName, like any Hydra install.
    await this.options.putDownload(id, {
      shop: "epic",
      objectId,
      uri: "",
      folderName: path.basename(installed.installPath),
      downloadPath: path.dirname(installed.installPath),
      downloader: Downloader.Epic,
      progress: 1,
      bytesDownloaded: installed.install_size,
      fileSize: installed.install_size,
      shouldSeed: false,
      status: "complete",
      queued: false,
      timestamp: Date.now(),
      extracting: false,
      automaticallyExtract: false,
      automaticallyDeleteArchiveFiles: false,
      epic: {
        owner: owned.owner,
        connectionId: owned.connection.connectionId,
        artifactId: target.artifactId,
        platform: target.platform,
        diskSizeInBytes: installed.install_size,
        phase: "finalizing",
      },
    });
    this.options.afterGameUpdated?.();
  }
  private isWindows() {
    return (this.options.platform ?? process.platform) === "win32";
  }
  async start(
    payload: StartEpicGameDownloadPayload
  ): Promise<EpicManagedOperationResult> {
    const id = this.id(payload.epicObjectId);
    if (this.enqueues.has(id) || this.removals.has(id))
      return { ok: false, error: "operation-in-progress" };
    const controller = new AbortController();
    const done = withEpicTiming("download.enqueue", () =>
      this.enqueue(payload, controller)
    );
    const operation = { controller, done };
    this.enqueues.set(id, operation);
    try {
      return await done;
    } finally {
      controller.abort();
      if (this.enqueues.get(id) === operation) this.enqueues.delete(id);
    }
  }
  async startUpdate(
    payload: StartEpicGameUpdatePayload
  ): Promise<EpicManagedOperationResult> {
    try {
      const owned = await this.options.installation.captureLocal(
        payload.epicObjectId,
        AbortSignal.timeout(EPIC_INSTALL_OPTIONS_TIMEOUT_MS)
      );
      const installation = owned.game.epicInstallation;
      if (!installation) throw new EpicManagedError("installation-missing");
      if (
        installation.artifactId !== payload.artifactId ||
        installation.platform !== payload.platform
      )
        throw new EpicManagedError("invalid-artifact");
      const installed = await this.options.installation.readInstalledForRepair(
        epicManagedTarget(owned, payload.artifactId, payload.platform),
        payload.epicObjectId
      );
      if (!installed) throw new EpicManagedError("installation-missing");
      return await this.start({
        ...payload,
        downloadPath: path.dirname(installed.installPath),
      });
    } catch (error) {
      return { ok: false, error: epicManagedErrorCode(error) };
    }
  }
  private async enqueue(
    payload: StartEpicGameDownloadPayload,
    controller: AbortController
  ): Promise<EpicManagedOperationResult> {
    const id = this.id(payload.epicObjectId);
    try {
      const { owned, prepared } = await withEpicTiming(
        "download.enqueue-preparation",
        () =>
          this.options.installation.resolvePreparation(
            payload,
            controller.signal
          )
      );
      if (owned.connection.connectionId !== payload.connectionId)
        throw new EpicManagedError("stale-connection");
      if (this.options.isGameRunning(owned.game))
        throw new EpicManagedError("game-running");
      const existing = await this.options.getDownload(id);
      if (existing && (existing.status === "active" || existing.queued))
        throw new EpicManagedError("operation-in-progress");
      const downloadPath = await withEpicTiming("download.base-path", () =>
        this.validateBasePath(payload.downloadPath)
      );
      const installed = await this.options.installation.readInstalledForRepair(
        prepared.target,
        payload.epicObjectId
      );
      const folderName = installed
        ? path.basename(installed.installPath)
        : this.options.installation.folderNameFromMetadata(
            prepared.metadata,
            prepared.target
          );
      if (
        installed &&
        path.relative(downloadPath, path.dirname(installed.installPath)) !== ""
      )
        throw new EpicManagedError("invalid-path");
      this.options.runtime.assertCurrent(prepared.target, controller.signal);
      const update =
        installed && installed.version !== prepared.version
          ? {
              fromVersion: installed.version,
              toVersion: prepared.version,
              ...(existing?.epic?.update?.filesChanged
                ? { filesChanged: true }
                : {}),
            }
          : undefined;
      const installedDlcs = installed
        ? await this.options.installation.readInstalledDlcs(
            prepared.target,
            installed.installPath
          )
        : new Map<string, string>();
      const selection = resolveEpicSelection(prepared, {
        components: installed
          ? installedEpicComponents(
              prepared,
              epicInstallTags(installed.raw.install_tags)
            )
          : payload.components,
        dlcs: withInstalledEpicDlcs(prepared, payload.dlcs, installedDlcs),
      });
      const resolved =
        installed && !update ? withoutInstalledEpicGame(selection) : selection;
      const download: Download = {
        shop: "epic",
        objectId: payload.epicObjectId,
        uri: "",
        folderName,
        downloadPath,
        downloader: Downloader.Epic,
        progress: 0,
        bytesDownloaded: 0,
        fileSize: update ? 0 : resolved.downloadSizeInBytes,
        shouldSeed: false,
        status: "paused",
        queued: false,
        timestamp: Date.now(),
        extracting: false,
        automaticallyExtract: false,
        automaticallyDeleteArchiveFiles: false,
        epic: {
          owner: owned.owner,
          connectionId: owned.connection.connectionId,
          artifactId: payload.artifactId,
          platform: payload.platform,
          diskSizeInBytes: resolved.diskSizeInBytes,
          phase: "preparing",
          selection: resolved.selection,
          ...(update ? { update } : {}),
        },
      };
      // Never create/promote the imported Game or send a Hydra download mutation.
      await withEpicTiming("download.persist", () =>
        this.options.putDownload(id, download)
      );
      try {
        this.options.runtime.assertCurrent(prepared.target, controller.signal);
        if (payload.addToQueueOnly)
          await withEpicTiming("download.orchestrator-enqueue", () =>
            this.options.enqueuePreparedDownload(download)
          );
        else
          await withEpicTiming("download.orchestrator-start", () =>
            this.options.startPreparedDownload(download)
          );
      } catch (error) {
        const latest = await this.options.getDownload(id);
        if (
          latest?.downloader === Downloader.Epic &&
          latest.timestamp === download.timestamp
        )
          await this.options.putDownload(id, {
            ...latest,
            status: "error",
            queued: false,
            epic: latest.epic
              ? { ...latest.epic, error: epicManagedErrorCode(error) }
              : undefined,
          });
        throw error;
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: epicManagedErrorCode(error),
      };
    }
  }
  private async validateBasePath(value: string) {
    if (
      typeof value !== "string" ||
      !path.isAbsolute(value) ||
      value.includes("\0")
    )
      throw new EpicManagedError("invalid-path");
    const canonical = await fs.realpath(value).catch(() => null);
    if (!canonical || !(await fs.stat(canonical)).isDirectory())
      throw new EpicManagedError("invalid-path");
    return canonical;
  }
  private async validateSpace(destination: string, base: string, size: number) {
    if (!isPathContained(base, destination))
      throw new EpicManagedError("invalid-path");
    const used = await withEpicTiming("download.existing-files", () =>
      getReusableEpicDiskBytes(destination)
    );
    const disk = await withEpicTiming("download.free-space", () =>
      this.options.getDiskUsage(base)
    );
    if (
      !disk ||
      disk.free < Math.max(size - used, MINIMUM_FREE_DISK_SPACE_BYTES)
    )
      throw new EpicManagedError("insufficient-space");
  }
  async startRuntime(
    download: Download,
    onFailure: (error: unknown) => void,
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    if (
      this.active ||
      this.preparing ||
      this.removals.has(this.id(download.objectId))
    )
      throw new EpicManagedError("operation-in-progress");
    const controller = new AbortController();
    const done = withEpicTiming("download.prepare-runtime", () =>
      this.prepareRuntime(download, onFailure, controller, isCurrent)
    );
    const preparing = { id: this.id(download.objectId), controller, done };
    this.preparing = preparing;
    try {
      await done;
    } finally {
      if (this.preparing === preparing) this.preparing = null;
    }
  }
  private async prepareRuntime(
    download: Download,
    onFailure: (error: unknown) => void,
    controller: AbortController,
    isCurrent: () => boolean
  ) {
    const metadata = download.epic;
    if (
      download.downloader !== Downloader.Epic ||
      download.shop !== "epic" ||
      !metadata ||
      !download.folderName
    )
      throw new EpicManagedError("invalid-response");
    const owned = await withEpicTiming("download.runtime-capture", () =>
      this.options.installation.capture(download.objectId, controller.signal)
    );
    if (
      owned.connection.connectionId !== metadata.connectionId ||
      !epicOwnerMatches(owned.owner, metadata.owner)
    )
      throw new EpicManagedError("stale-connection");
    if (this.options.isGameRunning(owned.game))
      throw new EpicManagedError("game-running");
    const installedDlcs = download.folderName
      ? await this.options.installation.readInstalledDlcs(
          epicManagedTarget(owned, metadata.artifactId, metadata.platform),
          await fs
            .realpath(path.resolve(download.downloadPath, download.folderName))
            .catch(() =>
              path.resolve(download.downloadPath, download.folderName!)
            )
        )
      : new Map<string, string>();
    const selectedDlcs = Array.isArray(metadata.selection?.dlcs)
      ? metadata.selection.dlcs
      : [];
    const neededDlcs = new Set([...selectedDlcs, ...installedDlcs.keys()]);
    const requiredDlcs = new Set(
      selectedDlcs.filter((artifactId) => !installedDlcs.has(artifactId))
    );
    const prepared = await withEpicTiming("download.runtime-prepare", () =>
      this.options.installation.prepare(
        owned,
        metadata.artifactId,
        metadata.platform,
        controller.signal,
        { needed: neededDlcs, required: requiredDlcs }
      )
    );
    await this.options.installation.persistPreparation(
      prepared,
      download.objectId,
      controller.signal
    );
    if (controller.signal.aborted || !isCurrent())
      throw new EpicManagedError("operation-cancelled");
    const base = await withEpicTiming("download.base-path", () =>
      this.validateBasePath(download.downloadPath)
    );
    if (path.relative(download.downloadPath, base) !== "")
      throw new EpicManagedError("invalid-path");
    const folder = await this.options.installation.folderName(
      prepared.target,
      download.objectId
    );
    if (folder !== download.folderName)
      throw new EpicManagedError("invalid-path");
    const destination = path.resolve(base, folder);
    const installed = await this.options.installation.readInstalledForRepair(
      prepared.target,
      download.objectId,
      destination
    );
    const selection = resumeEpicSelection(prepared, download);
    const resolved =
      selection.selection.gameAlreadyInstalled &&
      installed?.version === prepared.version
        ? withoutInstalledEpicGame(selection)
        : selection;
    await this.validateSpace(destination, base, resolved.diskSizeInBytes);
    if (controller.signal.aborted || !isCurrent())
      throw new EpicManagedError("operation-cancelled");
    const resume = epicRuntimeResume(download, prepared, resolved);
    const active: ActiveEpicDownload = {
      prepared,
      id: this.id(download.objectId),
      controller,
      target: prepared.target,
      download: {
        ...download,
        fileSize: resume.fileSize,
        bytesDownloaded: resume.previousBytes,
        progress: resume.previousProgress,
        epic: {
          ...metadata,
          diskSizeInBytes: resolved.diskSizeInBytes,
          phase: "preparing",
          error: undefined,
          selection: resolved.selection,
          ...(metadata.update
            ? { update: { ...metadata.update, toVersion: prepared.version } }
            : {}),
        },
      },
      currentRunParser: resume.parser,
      finishedRunsBytes: 0,
      plannedTotalBytes: metadata.update ? null : resume.fileSize,
      selection: resolved,
      done: Promise.resolve(),
      completed: false,
      version: prepared.version,
      isCurrent,
    };
    this.active = active;
    active.done = this.install(active, owned, destination).catch((error) => {
      if (
        this.active === active &&
        !controller.signal.aborted &&
        this.options.runtime.current(active.target)
      )
        onFailure(error);
      if ((error as { code?: string })?.code === "cleanup-failed") throw error;
    });
    // Runtime errors are handled by the manager's current generation callback.
    void active.done.catch(() => undefined);
  }
  private async install(
    active: ActiveEpicDownload,
    owned: EpicOwnedGame,
    destination: string
  ) {
    const { target, controller } = active;
    let transferStarted = false;
    const assertActive = () => {
      this.options.runtime.assertCurrent(target, controller.signal);
      if (this.active !== active || !active.isCurrent())
        throw new EpicManagedError("operation-cancelled");
    };
    const onLine = (line: string) => {
      if (
        this.active !== active ||
        controller.signal.aborted ||
        !this.options.runtime.current(target)
      )
        return;
      active.currentRunParser.line(line);
      if (!transferStarted && !active.currentRunParser.state.preparing) {
        transferStarted = true;
        markEpicTiming("download.transfer-ready", { first: true });
      }
      active.download.epic!.phase = active.currentRunParser.state.preparing
        ? "preparing"
        : "downloading";
    };
    try {
      const existing = await this.options.installation.readInstalledForRepair(
        target,
        owned.game.objectId,
        destination
      );
      assertActive();
      if (!existing || existing.version !== active.version) {
        const pendingUpdate = active.download.epic?.update;
        if (pendingUpdate && !pendingUpdate.filesChanged) {
          pendingUpdate.filesChanged = true;
          await this.options.putDownload(active.id, active.download);
          assertActive();
        }
        await this.options.runtime.streamInstall(
          target,
          owned.game.objectId,
          active.prepared,
          epicInstallArgs({
            artifactId: target.artifactId,
            platform: target.platform,
            basePath: active.download.downloadPath,
            folderName: active.download.folderName!,
            installTags: existing
              ? epicInstallTags(existing.raw.install_tags)
              : active.selection.selection.installTags,
          }),
          { signal: controller.signal, onLine }
        );
      }
      assertActive();
      if (active.currentRunParser.state.failed)
        throw new EpicManagedError("process-failed");
      active.download.epic!.phase = "finalizing";
      const installed = await this.options.installation.readInstalled(
        target,
        owned.game.objectId,
        destination
      );
      assertActive();
      if (!installed || installed.version !== active.version)
        throw new EpicManagedError("installation-incomplete");
      if (this.isWindows()) await this.prerequisites(active, installed);
      assertActive();
      await this.options.installation.bind(
        owned,
        target,
        installed,
        controller.signal
      );
      assertActive();
      await this.installDlcs(active, owned, installed, assertActive, onLine);
      assertActive();
      const current = await this.options.getDownload(active.id);
      assertActive();
      if (
        !current ||
        current.downloader !== Downloader.Epic ||
        current.timestamp !== active.download.timestamp ||
        current.epic?.connectionId !== target.connection.connectionId ||
        current.epic.artifactId !== target.artifactId ||
        current.epic.platform !== target.platform ||
        !epicOwnerMatches(current.epic.owner, target.owner)
      )
        throw new EpicManagedError("operation-cancelled");
      const total = epicDownloadTotal(active);
      active.finishedRunsBytes = total;
      active.plannedTotalBytes = total;
      active.currentRunParser = new EpicDownloadProgressParser(0);
      active.currentRunParser.state.progress = 1;
      active.download = {
        ...current,
        progress: 1,
        bytesDownloaded: total,
        fileSize: total,
        status: "complete",
        epic: {
          ...current.epic,
          phase: "finalizing",
          error: undefined,
          update: undefined,
        },
      };
      await this.options.putDownload(active.id, active.download);
      assertActive();
      active.completed = true;
      this.options.afterGameUpdated?.();
    } catch (error) {
      if ((error as { code?: string })?.code === "cleanup-failed") throw error;
      if (controller.signal.aborted) return;
      throw error;
    }
  }
  private async installDlcs(
    active: ActiveEpicDownload,
    owned: EpicOwnedGame,
    installed: EpicInstalledGame,
    assertActive: () => void,
    onLine: (line: string) => void
  ) {
    const { target, controller } = active;
    const read = () =>
      this.options.installation.readInstalledDlcs(
        target,
        installed.installPath
      );
    const current = await read();
    assertActive();
    const pending = (active.prepared.dlcs ?? []).filter(
      (dlc) =>
        (active.selection.selection.dlcs.includes(dlc.artifactId) ||
          current.has(dlc.artifactId)) &&
        current.get(dlc.artifactId) !== dlc.version
    );
    const update = !!active.download.epic?.update;
    for (const dlc of pending) {
      const previous = active.currentRunParser.state;
      active.finishedRunsBytes +=
        active.plannedTotalBytes === null
          ? previous.bytesDownloaded
          : previous.fileSize;
      const size =
        update || current.has(dlc.artifactId) ? 0 : dlc.downloadSizeInBytes;
      const resumed = Math.max(
        0,
        active.download.bytesDownloaded - active.finishedRunsBytes
      );
      active.currentRunParser = new EpicDownloadProgressParser(
        size,
        Math.min(resumed, size),
        size > 0 ? Math.min(resumed, size) / size : 0
      );
      active.download.epic!.phase = "preparing";
      await this.options.runtime.streamInstall(
        target,
        owned.game.objectId,
        dlc,
        epicInstallArgs({
          artifactId: dlc.artifactId,
          platform: target.platform,
          basePath: active.download.downloadPath,
          folderName: active.download.folderName!,
        }),
        {
          signal: controller.signal,
          onLine,
          dlc: { target: dlc.target, objectId: dlc.objectId },
        }
      );
      assertActive();
      if (active.currentRunParser.state.failed)
        throw new EpicManagedError("process-failed");
      if ((await read()).get(dlc.artifactId) !== dlc.version)
        throw new EpicManagedError("installation-incomplete");
      assertActive();
    }
  }
  private async prerequisites(
    active: ActiveEpicDownload,
    installed: EpicInstalledGame
  ) {
    const info = installed.prereq_info;
    if (!info || info.installed === true) return;
    if (
      typeof info.path !== "string" ||
      !info.path ||
      typeof info.args !== "string"
    )
      throw new EpicManagedError("prerequisites-required");
    const relative = info.path.replaceAll("\\", path.sep);
    if (path.isAbsolute(relative) || path.win32.isAbsolute(info.path))
      throw new EpicManagedError("invalid-path");
    const candidate = path.resolve(installed.installPath, relative);
    if (!isPathContained(installed.installPath, candidate))
      throw new EpicManagedError("invalid-path");
    const executable = await fs.realpath(candidate).catch(() => null);
    if (
      !executable ||
      !isPathContained(installed.installPath, executable) ||
      !(await fs.stat(executable)).isFile()
    )
      throw new EpicManagedError("prerequisites-required");
    active.download.epic!.phase = "prerequisites";
    const passed = await (this.options.runPrerequisite ?? runEpicPrerequisite)(
      executable,
      stringArgv(info.args),
      active.controller.signal
    );
    if (!passed) throw new EpicManagedError("prerequisites-required");
    await this.options.runtime.serializeWorkspace(
      active.target,
      async (directory) => {
        this.options.runtime.assertCurrent(
          active.target,
          active.controller.signal
        );
        const file = path.join(directory, "installed.json");
        const values = await readManagedJson(file);
        const game = isRecord(values) ? values[active.target.artifactId] : null;
        if (!isRecord(values) || !isRecord(game) || !isRecord(game.prereq_info))
          throw new EpicManagedError("installation-incomplete");
        game.prereq_info.installed = true;
        await writeManagedJson(file, values);
      }
    );
  }
  progress(download: Download): DownloadProgress | null {
    const active = this.active;
    if (
      !active ||
      active.id !== this.id(download.objectId) ||
      !this.options.runtime.current(active.target)
    )
      return null;
    const state = active.currentRunParser.state;
    const total = epicDownloadTotal(active);
    const progress =
      total > 0
        ? Math.min(
            1,
            (active.finishedRunsBytes + state.progress * state.fileSize) / total
          )
        : state.progress;
    const current: Download = {
      ...download,
      status: active.completed ? "complete" : "active",
      bytesDownloaded: Math.min(
        total,
        active.finishedRunsBytes + state.bytesDownloaded
      ),
      fileSize: total,
      progress,
      epic: active.download.epic,
    };
    return {
      gameId: active.id,
      download: current,
      progress,
      downloadSpeed: state.downloadSpeed,
      timeRemaining: state.timeRemaining,
      numPeers: 0,
      numSeeds: 0,
      isDownloadingMetadata: !active.completed && state.preparing,
      isCheckingFiles:
        !active.completed &&
        ["finalizing", "prerequisites"].includes(
          active.download.epic?.phase ?? ""
        ),
    };
  }
  async stop(id?: string) {
    const preparing = this.preparing;
    const active = this.active;
    const waits: Promise<unknown>[] = [];
    for (const [key, enqueue] of this.enqueues)
      if (!id || key === id) {
        enqueue.controller.abort();
        waits.push(enqueue.done);
      }
    if (preparing && (!id || preparing.id === id)) {
      preparing.controller.abort();
      waits.push(preparing.done);
    }
    if (active && (!id || active.id === id)) {
      active.controller.abort();
      waits.push(active.done);
    }
    const results = await Promise.allSettled(waits);
    if (
      results.some(
        (value) =>
          value.status === "rejected" && value.reason?.code === "cleanup-failed"
      )
    )
      throw new EpicManagedError("cleanup-failed");
    if (this.active === active && (!id || active?.id === id))
      this.active = null;
  }
  async forgetInstallation(
    download: Download,
    removeFiles?: () => Promise<void>,
    afterForget?: () => Promise<void>
  ) {
    if (!download.epic) throw new EpicManagedError("invalid-response");
    const id = this.id(download.objectId);
    if (this.removals.has(id))
      throw new EpicManagedError("operation-in-progress");
    this.removals.add(id);
    try {
      await this.options.runtime.serializeLocalWorkspace(
        download.epic,
        async (directory) => {
          const file = path.join(directory, "installed.json");
          let value;
          try {
            value = await readManagedJson(file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (value !== undefined && !isRecord(value))
            throw new EpicManagedError("invalid-response");
          await removeFiles?.();
          if (isRecord(value)) {
            forgetEpicInstalledEntries(value, download.epic!.artifactId);
            await writeManagedJson(file, value);
          }
          await afterForget?.();
        }
      );
    } finally {
      this.removals.delete(id);
    }
  }
}

export function resumeEpicSelection(
  prepared: EpicPreparedInstallation,
  download: Download
): ResolvedEpicSelection {
  const saved = download.epic?.selection;
  if (!saved) return resolveEpicSelection(prepared, {});
  if (
    !Array.isArray(saved.installTags) ||
    saved.installTags.length > EPIC_MAX_INSTALL_TAGS ||
    !saved.installTags.every(isEpicInstallTag) ||
    !Array.isArray(saved.dlcs) ||
    !saved.dlcs.every(isSafeEpicArtifact) ||
    (saved.components !== undefined &&
      (!Array.isArray(saved.components) ||
        !saved.components.every(isEpicSelectionId)))
  )
    throw new EpicManagedError("invalid-selection");
  const dlcs = saved.dlcs.filter((artifactId) =>
    prepared.dlcs?.some((dlc) => dlc.artifactId === artifactId)
  );
  let fresh: ResolvedEpicSelection | null = null;
  try {
    fresh = resolveEpicSelection(prepared, {
      components: saved.components,
      dlcs,
    });
  } catch (error) {
    if (
      !(error instanceof EpicManagedError) ||
      error.code !== "invalid-selection"
    )
      throw error;
  }
  const preparedDlcs = (prepared.dlcs ?? []).filter((dlc) =>
    dlcs.includes(dlc.artifactId)
  );
  const dlcDownload = preparedDlcs.reduce(
    (total, dlc) => total + dlc.downloadSizeInBytes,
    0
  );
  const savedDownload = download.fileSize ?? prepared.downloadSizeInBytes;
  return {
    selection: { ...saved, installTags: [...saved.installTags], dlcs },
    dlcs: preparedDlcs,
    gameDownloadSizeInBytes:
      fresh?.gameDownloadSizeInBytes ??
      Math.max(0, savedDownload - dlcDownload),
    downloadSizeInBytes: fresh?.downloadSizeInBytes ?? savedDownload,
    diskSizeInBytes:
      fresh?.diskSizeInBytes ??
      download.epic?.diskSizeInBytes ??
      prepared.diskSizeInBytes,
  };
}

function epicRuntimeResume(
  download: Download,
  prepared: EpicPreparedInstallation,
  resolved: ResolvedEpicSelection
) {
  const update = download.epic?.update;
  const sameUpdate = update?.toVersion === prepared.version;
  const restarted = !!update && !sameUpdate;
  let fileSize = resolved.downloadSizeInBytes;
  if (update) fileSize = sameUpdate ? (download.fileSize ?? 0) : 0;
  const previousBytes = restarted ? 0 : download.bytesDownloaded;
  const previousProgress = restarted ? 0 : download.progress;
  const segmentSize = update ? fileSize : resolved.gameDownloadSizeInBytes;
  const segmentProgress =
    segmentSize > 0
      ? (previousProgress * Math.max(fileSize, segmentSize)) / segmentSize
      : previousProgress;
  return {
    fileSize,
    previousBytes,
    previousProgress,
    parser: new EpicDownloadProgressParser(
      segmentSize,
      previousBytes,
      segmentProgress
    ),
  };
}

const epicDownloadTotal = (active: ActiveEpicDownload) =>
  Math.max(
    active.plannedTotalBytes ?? 0,
    active.finishedRunsBytes + active.currentRunParser.state.fileSize
  );

let downloadService: EpicDownloadService | null = null;
export const setEpicDownloadService = (service: EpicDownloadService) => {
  downloadService = service;
};
export function getEpicDownloadService() {
  if (!downloadService) throw new EpicManagedError("legendary-unavailable");
  return downloadService;
}
