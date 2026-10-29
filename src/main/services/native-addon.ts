import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { app } from "electron";
import type { ProcessPayload } from "./download/types";
import type { EpicProcessNode } from "./epic/managed-process-tracker";
import type {
  BuildLocalGameSnapshotInput,
  BuildLocalGameSnapshotPipelineInput,
  BuildSnapshotAggregateHashInput,
  DeleteLocalSaveTarget,
  DeleteLocalSaveTargetsResult,
  GameSaveRules,
  GetSaveRulesForGameInput,
  NativeLocalGameSnapshotPipelineResult,
  ReplaceRestoreTarget,
  ReplaceRestoreTargetsResult,
  ResolveRestoreTargetsInput,
  ResolveRestoreTargetsResult,
  ShouldSkipRestoreFileInput,
  VerifyDownloadedRestoreFileResult,
  CheckCloudSaveCustomPathOverlapInput,
  CheckCloudSaveCustomPathOverlapResult,
} from "@types";

import { logger } from "./logger";

type NativeProcessProfileImageResponse = {
  imagePath?: string;
  image_path?: string;
  mimeType?: string;
  mime_type?: string;
};

type NativeProcessSizedImageResponse = NativeProcessProfileImageResponse & {
  isAnimated?: boolean;
  is_animated?: boolean;
};

type NativeActiveWindowResponse = {
  windowId?: string;
  window_id?: string;
  processId?: number;
  process_id?: number;
};

export interface ScreenshotInputNativeConfig {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  gamepadEnabled: boolean;
  gamepadButtons: string[];
}

export interface ScreenshotInputNativeEvent {
  kind: string;
  source: string;
  backend: string;
}

export interface ScreenshotInputNativeStatus {
  keyboardBackend: string;
  gamepadBackend: string;
  keyboardError?: string | null;
  gamepadError?: string | null;
  waylandSession: boolean;
}
type NativeScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type NativeWindowBoundsResponse = {
  frame: NativeScreenRect;
  client: NativeScreenRect;
};

type NativeForegroundWindowResponse = {
  windowHandle?: string;
  window_handle?: string;
  processId?: number;
  process_id?: number;
};

export type InPlaceExtractionOptions = {
  archivePath: string;
  outputPath: string;
  passwords: string[];
  allowFresh: boolean;
  // Hydra recorded starting an in-place extraction of this archive.
  resume: boolean;
};

// "unavailable" leaves the archive untouched; "failed" means part of it is
// already extracted and removed, and only another in-place call resumes it.
// The call itself only rejects when the addon could not run.
export type InPlaceExtractionResult = {
  status: "finished" | "unavailable" | "failed";
  message?: string | null;
};

export type NativeProcessPayload = ProcessPayload &
  Pick<
    EpicProcessNode,
    | "startTime"
    | "invocationId"
    | "winePrefixPath"
    | "peExecutablePath"
    | "inspectionComplete"
  >;

type HydraNativeModule = {
  torrentInitialize: (port: number) => Promise<void>;
  torrentRequest: (method: string, paramsJson: string) => Promise<string>;
  torrentShutdown: () => Promise<void>;
  processProfileImage: (
    imagePath: string,
    targetExtension?: string
  ) => NativeProcessProfileImageResponse;
  processImage: (
    imagePath: string,
    outputPathBase: string,
    width: number,
    height: number,
    preserveAnimation: boolean
  ) => Promise<NativeProcessSizedImageResponse>;
  listProcesses: () => NativeProcessPayload[];
  getLinuxActiveWindow: () => NativeActiveWindowResponse | null;
  startScreenshotInput: (
    config: ScreenshotInputNativeConfig,
    callback: (event: ScreenshotInputNativeEvent) => void
  ) => ScreenshotInputNativeStatus;
  updateScreenshotInputBinding: (
    config: ScreenshotInputNativeConfig
  ) => boolean;
  stopScreenshotInput: () => void;
  probeScreenshotInput: (
    config: ScreenshotInputNativeConfig
  ) => ScreenshotInputNativeStatus;
  getWindowsForegroundWindow?: () => NativeForegroundWindowResponse | null;
  getLinuxWindowClientPid?: (windowId: string) => number | null;
  getKdeFocusedProcessId?: () => number | null;
  startKdeFocusWatch?: () => void;
  stopKdeFocusWatch?: () => void;
  getWindowsWindowBounds?: (
    windowHandle: string
  ) => NativeWindowBoundsResponse | null;
  extractArchiveInPlace: (
    options: InPlaceExtractionOptions,
    onProgress: (fraction: number) => void
  ) => Promise<InPlaceExtractionResult>;
  inPlaceJournalExists: (archivePath: string) => boolean;
  buildLocalGameSnapshotPipeline: (
    input: BuildLocalGameSnapshotPipelineInput
  ) => Promise<NativeLocalGameSnapshotPipelineResult>;
  buildLocalGameSnapshot: (
    input: BuildLocalGameSnapshotInput
  ) => Promise<NativeLocalGameSnapshotPipelineResult>;
  getSaveRulesForGame: (
    input: GetSaveRulesForGameInput
  ) => Promise<GameSaveRules>;
  buildSnapshotAggregateHash: (
    input: BuildSnapshotAggregateHashInput
  ) => string;
  checkCloudSaveCustomPathOverlap: (
    input: CheckCloudSaveCustomPathOverlapInput
  ) => CheckCloudSaveCustomPathOverlapResult;
  uploadLocalSaveBlob: (
    absolutePath: string,
    uploadUrl: string,
    contentLength: string,
    checksumSha256: string
  ) => Promise<void>;
  resolveRestoreTargets: (
    input: ResolveRestoreTargetsInput
  ) => Promise<ResolveRestoreTargetsResult>;
  downloadRestoreBlobToTemp: (
    snapshotId: string,
    hash: string,
    expectedSizeBytes: number,
    downloadUrl: string,
    tempRoot: string
  ) => Promise<string>;
  verifyDownloadedRestoreFile: (
    tempPath: string,
    expectedHash: string
  ) => Promise<VerifyDownloadedRestoreFileResult>;
  shouldSkipRestoreFile: (
    localPath: string,
    expectedHash: string
  ) => Promise<boolean>;
  replaceRestoreTargets: (
    files: ReplaceRestoreTarget[]
  ) => Promise<ReplaceRestoreTargetsResult>;
  deleteLocalSaveTargets: (
    files: DeleteLocalSaveTarget[],
    cleanupRootPaths?: string[]
  ) => Promise<DeleteLocalSaveTargetsResult>;
  cleanupRestoreTempSnapshot: (
    snapshotId: string,
    tempRoot: string
  ) => Promise<void>;
};

export type SystemProcessMap = {
  processMap: Record<string, string[]>;
  winePrefixMap: Record<string, string>;
  processTree?: EpicProcessNode[];
  linuxProcesses: Array<{
    name: string;
    cwd: string;
    exe: string;
    pid: number;
    appImagePath: string | null;
    steamCompatDataPath: string | null;
  }>;
};

// Runs in the worker thread (CJS context).
// "list"  → posts back the raw ProcessPayload array (used by close-game, launch-game)
// "map"   → posts back compact pre-built maps (used by the main loop's watchProcesses)
const WORKER_CODE = `
const { workerData, parentPort } = require('worker_threads');
const path = require('path');
const addon = require(workerData.addonPath);
const platform = process.platform;

function buildMaps(processes) {
  const processMap = Object.create(null);
  const winePrefixMap = Object.create(null);
  const linuxProcesses = [];
  const processTree = [];

  for (const proc of processes) {
    processTree.push({
      pid: proc.pid,
      parentPid: proc.parentPid,
      exe: proc.exe,
      cwd: proc.cwd,
      startTime: proc.startTime,
      invocationId: proc.invocationId,
      winePrefixPath: proc.winePrefixPath,
      peExecutablePath: proc.peExecutablePath,
      inspectionComplete: proc.inspectionComplete,
    });
    const key = proc.name && proc.name.toLowerCase();
    const value = platform === 'win32'
      ? proc.exe
      : path.join(proc.cwd || '', proc.name || '');

    if (!key || !value) continue;

    const steamCompatDataPath = proc.environ && proc.environ.STEAM_COMPAT_DATA_PATH;
    if (steamCompatDataPath) winePrefixMap[value] = steamCompatDataPath;

    if (platform === 'linux') {
      const appImagePath = proc.environ && proc.environ.APPIMAGE;
      linuxProcesses.push({
        name: key,
        cwd: (proc.cwd || '').toLowerCase(),
        exe: (proc.exe || '').toLowerCase(),
        pid: proc.pid,
        appImagePath: appImagePath ? appImagePath.toLowerCase() : null,
        steamCompatDataPath: steamCompatDataPath ? steamCompatDataPath.toLowerCase() : null,
      });
    }

    if (!processMap[key]) processMap[key] = [];
    processMap[key].push(value);
  }

  return { processMap, winePrefixMap, linuxProcesses, processTree };
}

parentPort.on('message', (type) => {
  try {
    const processes = addon.listProcesses();
    if (type === 'map') {
      parentPort.postMessage({ type: 'map', result: buildMaps(processes) });
    } else {
      parentPort.postMessage({ type: 'list', result: processes });
    }
  } catch (_) {
    if (type === 'map') {
      parentPort.postMessage({ type: 'map', result: null });
    } else {
      parentPort.postMessage({ type: 'list', result: [] });
    }
  }
});
`;

type PendingResolver =
  | { type: "list"; resolve: (p: NativeProcessPayload[]) => void }
  | { type: "map"; resolve: (m: SystemProcessMap | null) => void };

export class NativeAddon {
  public static torrentInitialize(port: number) {
    return this.load().torrentInitialize(port);
  }

  public static torrentRequest(method: string, paramsJson: string) {
    return this.load().torrentRequest(method, paramsJson);
  }

  public static torrentShutdown() {
    // Quitting an app which never used torrenting must not load the addon.
    return this.nativeModule?.torrentShutdown() ?? Promise.resolve();
  }
  private static nativeModule: HydraNativeModule | null = null;
  private static worker: Worker | null = null;
  private static pendingResolvers: PendingResolver[] = [];

  private static resolveAddonPath() {
    if (app.isPackaged) {
      return path.join(
        process.resourcesPath,
        "hydra-native",
        "hydra-native.node"
      );
    }

    return path.join(app.getAppPath(), "hydra-native", "hydra-native.node");
  }

  private static load() {
    if (this.nativeModule) return this.nativeModule;

    const addonPath = this.resolveAddonPath();

    if (!fs.existsSync(addonPath)) {
      throw new Error(`Hydra native addon not found at ${addonPath}`);
    }

    const require = createRequire(import.meta.url);
    const nativeModule = require(addonPath) as HydraNativeModule;

    this.nativeModule = nativeModule;

    return nativeModule;
  }

  private static getWorker(): Worker {
    if (this.worker) return this.worker;

    const addonPath = this.resolveAddonPath();

    if (!fs.existsSync(addonPath)) {
      throw new Error(`Hydra native addon not found at ${addonPath}`);
    }

    this.worker = new Worker(WORKER_CODE, {
      eval: true,
      workerData: { addonPath },
    });

    this.worker.on("message", ({ result }) => {
      const pending = this.pendingResolvers.shift();
      if (!pending) return;
      if (pending.type === "list") {
        (pending.resolve as (p: NativeProcessPayload[]) => void)(
          (result as NativeProcessPayload[]).filter(
            (p): p is NativeProcessPayload =>
              typeof p?.pid === "number" &&
              typeof p?.name === "string" &&
              p.name.length > 0
          )
        );
      } else {
        (pending.resolve as (m: SystemProcessMap | null) => void)(
          result as SystemProcessMap | null
        );
      }
    });

    this.worker.on("error", (error) => {
      logger.error("Process list worker error", error);
      this.drainResolvers();
    });

    this.worker.on("exit", (code) => {
      if (code !== 0)
        logger.error(`Process list worker exited with code ${code}`);
      this.worker = null;
      this.drainResolvers();
    });

    return this.worker;
  }

  public static processProfileImage(
    imagePath: string,
    targetExtension = "webp"
  ) {
    try {
      const response = this.load().processProfileImage(
        imagePath,
        targetExtension
      );

      const normalizedImagePath = response.imagePath ?? response.image_path;
      const normalizedMimeType = response.mimeType ?? response.mime_type;

      if (!normalizedImagePath || !normalizedMimeType) {
        throw new Error("Hydra native addon returned an invalid payload");
      }

      return {
        imagePath: normalizedImagePath,
        mimeType: normalizedMimeType,
      };
    } catch (error) {
      logger.error("Failed to process profile image via native addon", error);
      throw error;
    }
  }

  public static async processImage(
    imagePath: string,
    outputPathBase: string,
    width: number,
    height: number,
    preserveAnimation: boolean
  ) {
    try {
      const response = await this.load().processImage(
        imagePath,
        outputPathBase,
        width,
        height,
        preserveAnimation
      );

      const normalizedImagePath = response.imagePath ?? response.image_path;
      const normalizedMimeType = response.mimeType ?? response.mime_type;
      const normalizedIsAnimated =
        response.isAnimated ?? response.is_animated ?? false;

      if (!normalizedImagePath || !normalizedMimeType) {
        throw new Error("Hydra native addon returned an invalid payload");
      }

      return {
        imagePath: normalizedImagePath,
        mimeType: normalizedMimeType,
        isAnimated: normalizedIsAnimated,
      };
    } catch (error) {
      logger.error("Failed to process friend image via native addon", error);
      throw error;
    }
  }

  private static drainResolvers() {
    const drained = this.pendingResolvers.splice(0);
    for (const pending of drained) {
      if (pending.type === "list") pending.resolve([]);
      else pending.resolve(null);
    }
  }

  public static listProcesses(): Promise<NativeProcessPayload[]> {
    return new Promise((resolve) => {
      try {
        const worker = this.getWorker();
        this.pendingResolvers.push({ type: "list", resolve });
        worker.postMessage("list");
      } catch {
        resolve([]);
      }
    });
  }

  public static getLinuxActiveWindow() {
    if (process.platform !== "linux") return null;

    try {
      const response = this.load().getLinuxActiveWindow();
      if (!response) return null;

      const windowId = response.windowId ?? response.window_id;
      if (!windowId) return null;

      return {
        windowId,
        processId: response.processId ?? response.process_id ?? null,
      };
    } catch (error) {
      logger.error("Failed to identify active Linux window", error);
      return null;
    }
  }

  public static startScreenshotInput(
    config: ScreenshotInputNativeConfig,
    callback: (event: ScreenshotInputNativeEvent) => void
  ) {
    return this.load().startScreenshotInput(config, callback);
  }

  public static updateScreenshotInputBinding(
    config: ScreenshotInputNativeConfig
  ) {
    return this.load().updateScreenshotInputBinding(config);
  }

  public static stopScreenshotInput() {
    this.nativeModule?.stopScreenshotInput();
  }

  public static probeScreenshotInput(config: ScreenshotInputNativeConfig) {
    return this.load().probeScreenshotInput(config);
  }

  public static getWindowsForegroundWindow() {
    if (process.platform !== "win32") return null;

    try {
      const getForegroundWindow = this.load().getWindowsForegroundWindow;
      if (!getForegroundWindow) return undefined;

      const response = getForegroundWindow();
      if (!response) return null;

      const windowHandle = response.windowHandle ?? response.window_handle;
      const processId = response.processId ?? response.process_id;
      if (!windowHandle || !processId) return null;

      return { windowHandle, processId };
    } catch (error) {
      logger.error("Failed to identify the Windows foreground window", error);
      return undefined;
    }
  }

  public static getWindowsWindowBounds(windowHandle: string) {
    if (process.platform !== "win32") return null;

    try {
      return this.load().getWindowsWindowBounds?.(windowHandle) ?? null;
    } catch (error) {
      logger.error("Failed to read the Windows window bounds", error);
      return null;
    }
  }

  public static getLinuxWindowClientPid(windowId: string) {
    if (process.platform !== "linux") return null;

    try {
      return this.load().getLinuxWindowClientPid?.(windowId) ?? null;
    } catch (error) {
      logger.error("Failed to resolve the Linux window client process", error);
      return null;
    }
  }

  public static getKdeFocusedProcessId() {
    if (process.platform !== "linux") return undefined;

    try {
      const getFocusedProcessId = this.load().getKdeFocusedProcessId;
      if (!getFocusedProcessId) return undefined;
      return getFocusedProcessId() ?? null;
    } catch (error) {
      logger.warn("Failed to read the KWin active window", error);
      return undefined;
    }
  }

  public static startKdeFocusWatch() {
    if (process.platform !== "linux") return;

    try {
      this.load().startKdeFocusWatch?.();
    } catch (error) {
      logger.warn("Failed to start the KWin focus watch", error);
    }
  }

  public static stopKdeFocusWatch() {
    this.nativeModule?.stopKdeFocusWatch?.();
  }

  public static getSystemProcessMap(): Promise<SystemProcessMap | null> {
    return new Promise((resolve) => {
      try {
        const worker = this.getWorker();
        this.pendingResolvers.push({ type: "map", resolve });
        worker.postMessage("map");
      } catch {
        resolve(null);
      }
    });
  }

  public static extractArchiveInPlace(
    options: InPlaceExtractionOptions,
    onProgress: (fraction: number) => void
  ) {
    return this.load().extractArchiveInPlace(options, onProgress);
  }

  public static inPlaceJournalExists(archivePath: string) {
    return this.load().inPlaceJournalExists(archivePath);
  }

  public static buildLocalGameSnapshotPipeline(
    input: BuildLocalGameSnapshotPipelineInput
  ) {
    return this.load().buildLocalGameSnapshotPipeline(input);
  }

  public static buildLocalGameSnapshot(input: BuildLocalGameSnapshotInput) {
    return this.load().buildLocalGameSnapshot(input);
  }

  public static getSaveRulesForGame(input: GetSaveRulesForGameInput) {
    return this.load().getSaveRulesForGame(input);
  }

  public static checkCloudSaveCustomPathOverlap(
    input: CheckCloudSaveCustomPathOverlapInput
  ) {
    return this.load().checkCloudSaveCustomPathOverlap(input);
  }

  public static buildSnapshotAggregateHash(
    input: BuildSnapshotAggregateHashInput
  ) {
    return this.load().buildSnapshotAggregateHash(input);
  }

  public static uploadLocalSaveBlob(
    absolutePath: string,
    uploadUrl: string,
    contentLength: string,
    checksumSha256: string
  ) {
    return this.load().uploadLocalSaveBlob(
      absolutePath,
      uploadUrl,
      contentLength,
      checksumSha256
    );
  }

  public static resolveRestoreTargets(input: ResolveRestoreTargetsInput) {
    return this.load().resolveRestoreTargets(input);
  }

  public static downloadRestoreBlobToTemp(
    snapshotId: string,
    hash: string,
    expectedSizeBytes: number,
    downloadUrl: string,
    tempRoot: string
  ) {
    return this.load().downloadRestoreBlobToTemp(
      snapshotId,
      hash,
      expectedSizeBytes,
      downloadUrl,
      tempRoot
    );
  }

  public static verifyDownloadedRestoreFile(
    tempPath: string,
    expectedHash: string
  ) {
    return this.load().verifyDownloadedRestoreFile(tempPath, expectedHash);
  }

  public static shouldSkipRestoreFile(input: ShouldSkipRestoreFileInput) {
    return this.load().shouldSkipRestoreFile(
      input.localPath,
      input.expectedHash
    );
  }

  public static replaceRestoreTargets(files: ReplaceRestoreTarget[]) {
    return this.load().replaceRestoreTargets(files);
  }

  public static deleteLocalSaveTargets(
    files: DeleteLocalSaveTarget[],
    cleanupRootPaths?: string[]
  ) {
    return this.load().deleteLocalSaveTargets(files, cleanupRootPaths);
  }

  public static cleanupRestoreTempSnapshot(
    snapshotId: string,
    tempRoot: string
  ) {
    return this.load().cleanupRestoreTempSnapshot(snapshotId, tempRoot);
  }
}
