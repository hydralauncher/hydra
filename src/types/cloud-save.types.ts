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
  platform: "windows" | "linux";
  homeDir: string;
  documentsDir?: string;
  appDataDir?: string;
  executablePath?: string;
  winePrefixPath?: string;
  protonPath?: string;
  steamPath?: string;
  steamUserIds: string[];
}

export interface CloudSavePathContext {
  shop: GameShop;
  objectId: string;
  platform: "windows" | "linux";
  homeDir: string;
  documentsDir?: string;
  appDataDir?: string;
  executablePath?: string;
  winePrefixPath?: string;
  protonPath?: string;
  steamPath?: string;
  steamUserIds: string[];
}

export interface RestoreManifestFile {
  rawPath: string;
  relativePath: string;
  hash: string;
  sizeBytes: number;
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

export interface RestoreFinishedPayload {
  gameId: CloudSaveGameId;
  restoredFiles: number;
  skippedFiles: number;
  failedFiles: number;
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
}
