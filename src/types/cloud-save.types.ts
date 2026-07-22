import type { GameShop } from "./game.types";

export interface CloudSaveGameId {
  shop: GameShop;
  objectId: string;
}

export interface BuildLocalGameSnapshotPipelineInput {
  shop: GameShop;
  objectId: string;
  title?: string;
  remoteId?: string;
  userDataPath: string;
  sourceUrl?: string;
  platform: "windows" | "linux" | "mac";
  homeDir: string;
  documentsDir?: string;
  appDataDir?: string;
  executablePath?: string;
  winePrefixPath?: string;
  steamPath?: string;
  storeUserId?: string;
  hashCache: LocalFileHashCacheEntry[];
}

export interface LocalFileHashCacheEntry {
  absolutePath: string;
  sizeBytes: number;
  lastModifiedAt: string;
  hash: string;
}

export interface CloudSavePathContext {
  shop: GameShop;
  objectId: string;
  platform: "windows" | "linux" | "mac";
  homeDir: string;
  documentsDir?: string;
  appDataDir?: string;
  executablePath?: string;
  winePrefixPath?: string;
  steamPath?: string;
  storeUserId?: string;
}

export interface RestoreManifestFile {
  rawPath: string;
  relativePath: string;
  hash: string;
  sizeBytes: number;
  lastModifiedAt?: string | null;
}

export interface RestoreManifestResponse {
  snapshot: CloudSaveGameId & { id: string };
  files: RestoreManifestFile[];
}

export interface RemoteSnapshotSummary {
  id: string;
  status: "active" | "historical";
  createdAt: string;
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
}

export type CloudSaveState =
  | "synced"
  | "local-ahead"
  | "remote-ahead"
  | "conflict"
  | "untracked";

export interface CompareGameSnapshotsInput {
  localSnapshotHash: string;
  localSnapshotFileCount: number;
  baseSnapshotHash?: string;
  remoteSnapshots: RemoteSnapshotSummary[];
}

export interface NativeCloudSaveStateResult {
  state: CloudSaveState;
  isOutOfSync: boolean;
  activeRemoteSnapshot: RemoteSnapshotSummary | null;
}

export interface CloudSaveStateResult {
  state: CloudSaveState;
  hasChanged: boolean;
  activeRemoteSnapshot: RemoteSnapshotSummary | null;
}

export interface CloudSaveOverview extends CloudSaveStateResult {
  snapshots: RemoteSnapshotSummary[];
  isAutomaticSyncEnabled: boolean;
}

export type CloudSaveV2FileComparisonStatus =
  | "unchanged"
  | "modified"
  | "local-only"
  | "remote-only";

interface CloudSaveV2FileBase {
  rawPath: string;
  relativePath: string;
  sizeBytes: number;
  lastModifiedAt: string | null;
}

export interface CloudSaveV2LocalFile extends CloudSaveV2FileBase {
  source: "local";
  absolutePath: string;
}

export interface CloudSaveV2RemoteFile extends CloudSaveV2FileBase {
  source: "remote";
}

export type CloudSaveV2File = CloudSaveV2LocalFile | CloudSaveV2RemoteFile;

interface CloudSaveV2FileSourceBase {
  fileCount: number;
  totalSizeBytes: number;
  files: CloudSaveV2File[];
}

export interface CloudSaveV2LocalFileSource extends CloudSaveV2FileSourceBase {
  kind: "local";
  files: CloudSaveV2LocalFile[];
}

export interface CloudSaveV2ActiveSnapshotFileSource
  extends CloudSaveV2FileSourceBase {
  kind: "active-snapshot";
  snapshotId: string;
  createdAt: string;
  files: CloudSaveV2RemoteFile[];
}

export type CloudSaveV2FileSource =
  | CloudSaveV2LocalFileSource
  | CloudSaveV2ActiveSnapshotFileSource;

export interface CloudSaveV2FileComparison {
  rawPath: string;
  relativePath: string;
  status: CloudSaveV2FileComparisonStatus;
  local: CloudSaveV2LocalFile | null;
  remote: CloudSaveV2RemoteFile | null;
}

export interface CloudSaveV2FileDetails {
  state: CloudSaveState;
  local: CloudSaveV2LocalFileSource;
  activeSnapshot: CloudSaveV2ActiveSnapshotFileSource | null;
  comparisons: CloudSaveV2FileComparison[];
}

export type CloudSaveSyncTrigger =
  | "manual"
  | "environment-changed"
  | "pre-launch"
  | "post-exit";

export type CloudSaveSyncAction = "none" | "upload" | "restore" | "conflict";

export type CloudSaveConflictResolution = "keep-local" | "keep-remote";

export interface SyncGameCloudSaveResult {
  trigger: CloudSaveSyncTrigger;
  action: CloudSaveSyncAction;
  initialState: CloudSaveState;
  finalState: CloudSaveState;
  remoteHash?: string | null;
  environmentId?: string;
}

export type CloudSaveAutomaticSyncTrigger = Exclude<
  CloudSaveSyncTrigger,
  "manual"
>;

export type CloudSaveAutomaticSyncEvent =
  | {
      gameId: CloudSaveGameId;
      trigger: CloudSaveAutomaticSyncTrigger;
      status: "progress";
      progress: CloudSaveSyncProgressPayload;
    }
  | {
      gameId: CloudSaveGameId;
      trigger: CloudSaveAutomaticSyncTrigger;
      status: "completed" | "conflict" | "failed";
      result?: SyncGameCloudSaveResult;
    };

export type CloudSaveSyncProgressStage =
  | "analyzing"
  | "uploading"
  | "restoring"
  | "completed"
  | "conflict";

export interface CloudSaveSyncProgressPayload {
  gameId: CloudSaveGameId;
  stage: CloudSaveSyncProgressStage;
  processedFiles: number;
  totalFiles: number;
}

export interface CloudSaveSyncIpcProgressPayload
  extends CloudSaveSyncProgressPayload {
  operationId: string;
}

export interface ResolveRestoreTargetsInput extends CloudSavePathContext {
  files: RestoreManifestFile[];
}

export interface ResolvedRestoreTarget extends RestoreManifestFile {
  targetPath: string;
}

export interface RestoreDownloadUrlFile extends RestoreManifestFile {
  downloadUrl: string;
}

export interface DownloadedRestoreFile extends RestoreManifestFile {
  tempPath: string;
}

export interface VerifyDownloadedRestoreFileInput {
  tempPath: string;
  expectedHash: string;
}

export type VerifyDownloadedRestoreFileResult =
  | { ok: true }
  | { ok: false; reason: "hash_mismatch" };

export interface ShouldSkipRestoreFileInput {
  localPath: string;
  expectedHash: string;
}

interface RestoreTargetIdentity {
  rawPath: string;
  relativePath: string;
  targetPath: string;
}

export type ReplaceRestoreTarget =
  | (RestoreTargetIdentity & {
      action: "restore";
      tempPath: string;
      expectedHash: string;
    })
  | (RestoreTargetIdentity & { action: "skip" });

export interface RestoreResultFile extends RestoreTargetIdentity {}

export interface RestoreSkippedFile extends RestoreTargetIdentity {
  reason: "already_matches_expected_state";
}

export interface RestoreFailedFile extends RestoreTargetIdentity {
  reason: "failed_to_replace_target" | "restore_rolled_back";
}

export interface ReplaceRestoreTargetsResult {
  restoredFiles: RestoreResultFile[];
  skippedFiles: RestoreSkippedFile[];
  failedFiles: RestoreFailedFile[];
}

export interface RestoreRemoteSnapshotResult {
  ok: boolean;
  restoredFiles: number;
  skippedFiles: number;
  failedFiles: number;
}

export type RestoreProgressStage =
  | "starting"
  | "resolving"
  | "checking"
  | "downloading"
  | "verifying"
  | "applying_restore"
  | "completed";

export interface RestoreProgressPayload {
  gameId: CloudSaveGameId;
  stage: RestoreProgressStage;
  processedFiles: number;
  totalFiles: number;
}

export interface LocalGameSnapshotFile {
  rawPath: string;
  relativePath: string;
  hash: string;
  sizeBytes: number;
  lastModifiedAt: string;
}

export interface LocalGameSnapshot {
  gameId: CloudSaveGameId;
  manifestKey?: string | null;
  fileCount: number;
  totalSizeBytes: number;
  files: LocalGameSnapshotFile[];
}

export interface LocalGameSnapshotWithHash extends LocalGameSnapshot {
  aggregateHash: string;
}

export interface LocalGameSnapshotSourceFile {
  rawPath: string;
  relativePath: string;
  absolutePath: string;
  hash: string;
  sizeBytes: number;
}

export interface LocalGameSnapshotPipelineResult
  extends LocalGameSnapshotWithHash {
  sourceFiles: LocalGameSnapshotSourceFile[];
}

export interface LocalGameSnapshotContext
  extends LocalGameSnapshotPipelineResult {
  environmentId: string;
  pathContext: CloudSavePathContext;
}

export interface NativeLocalGameSnapshotPipelineResult
  extends LocalGameSnapshotPipelineResult {
  hashCache: LocalFileHashCacheEntry[];
}

export type PrepareSnapshotFile =
  | { rawPath: string; relativePath: string; status: "skip" }
  | {
      rawPath: string;
      relativePath: string;
      status: "upload";
      uploadUrl: string;
    };

export interface PrepareSnapshotResponse {
  snapshotId: string;
  snapshotHash: string;
  files: PrepareSnapshotFile[];
}

export interface CloudSaveUploadProgress {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
  currentFile: string | null;
}

export interface UploadLocalGameSnapshotResult {
  snapshotId: string | null;
  uploadedFiles: number;
  skippedFiles: number;
}

export interface CommitSnapshotResponse {
  snapshotId: string;
  status: "active";
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
}

export interface RemoteGameSnapshot {
  id: string;
  status: "active";
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
}

export interface CloudSaveSyncAnchor {
  baseSnapshotId: string;
  baseAggregateHash: string;
  updatedAt: string;
  schemaVersion?: 2;
  environmentId?: string;
}
