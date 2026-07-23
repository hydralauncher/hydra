import type { GameShop } from "./game.types";

export interface CloudSaveGameId {
  shop: GameShop;
  objectId: string;
}

export interface CloudSaveRuleCondition {
  os?: string;
  store?: string;
}

export interface CloudSaveRule {
  ruleId: string;
  kind: string;
  rawPath: string;
  source: string;
  tags: string[];
  when: CloudSaveRuleCondition[];
}

export interface GetSaveRulesForGameInput extends CloudSaveGameId {
  title?: string;
  remoteId?: string;
  userDataPath: string;
  sourceUrl?: string;
}

export interface GameSaveRules {
  gameId: CloudSaveGameId;
  manifestKey?: string | null;
  ruleSourceRevision: string;
  rules: CloudSaveRule[];
}

export interface KnownStoreAccount {
  store: string;
  steamId64?: string;
  accountId32?: string;
  source: "active-login" | "known-login" | "userdata-folder";
}

export interface StoreUserContext {
  active?: KnownStoreAccount;
  known: KnownStoreAccount[];
}

export interface StoreUserIdentity {
  kind: "default" | "validated-account" | "opaque-folder";
  store: string;
  steamId64?: string;
  accountId32?: string;
  concreteFolderId: string;
  source: "active-login" | "known-login" | "folder-match" | "unbound-rule";
  authority: "active" | "known" | "inferred";
}

export interface PortableStoreUserIdentity {
  kind: "default" | "validated-account" | "opaque-folder";
  store: string;
  steamId64?: string;
  accountId32?: string;
  concreteFolderId: string;
}

export interface PortableBindings {
  store: string;
  storeGameId: string;
  storeUser: PortableStoreUserIdentity;
}

export interface LocalResolutionBindings {
  environmentId: string;
  rootId: string;
  prefixGenerationId?: string;
  concreteUserSegment: string;
  concretePath: string;
}

export interface UserLocationCoverage {
  candidateId: string;
  ruleId: string;
  variantId?: string;
  rawPath?: string;
  relativePath?: string;
  authority: "authoritative" | "exact" | "inferred";
  outcome:
    | "scanned"
    | "confirmed-missing"
    | "partial"
    | "failed"
    | "unresolved";
  enumeratedCompletely: boolean;
  warningCodes: string[];
}

export interface BuildLocalGameSnapshotPipelineInput
  extends CloudSavePathContext {
  title?: string;
  remoteId?: string;
  userDataPath: string;
  sourceUrl?: string;
  environmentId: string;
  hashCache: LocalFileHashCacheEntry[];
}

export interface LocalFileHashCacheEntry {
  absolutePath: string;
  sizeBytes: number;
  lastModifiedAt: string;
  hash: string;
  algorithm?: "sha256";
}

export interface CloudSavePathContext extends CloudSaveGameId {
  platform: "windows" | "linux" | "mac";
  homeDir: string;
  documentsDir?: string;
  appDataDir?: string;
  executablePath?: string;
  winePrefixPath?: string;
  steamPath?: string;
  storeUserContext: StoreUserContext;
}

export type SnapshotVariant =
  | {
      variantId: string;
      kind: "default";
    }
  | {
      variantId: string;
      kind: "steam-account";
      steamId64: string;
    }
  | {
      variantId: string;
      kind: "opaque-folder";
      concreteFolderId: string;
    };

export interface CloudSaveFileIdentity {
  variantId: string;
  rawPath: string;
  relativePath: string;
}

export interface SnapshotFile extends CloudSaveFileIdentity {
  hash: string;
  sizeBytes: number;
  lastModifiedAt: string;
}

export type UserVariantSnapshotFile = SnapshotFile;
export type RestoreManifestFile = SnapshotFile;

export interface BuildSnapshotAggregateHashInput {
  variants: SnapshotVariant[];
  files: SnapshotFile[];
}

export interface RestoreManifestResponse {
  snapshot: CloudSaveGameId & {
    id: string;
    version: number;
  };
  variants: SnapshotVariant[];
  files: RestoreManifestFile[];
}

export interface RemoteSnapshotSummary {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
}

export type CloudSaveState =
  | "synced"
  | "partial"
  | "local-ahead"
  | "remote-ahead"
  | "conflict"
  | "untracked";

export interface CloudSaveStateResult {
  state: CloudSaveState;
  hasChanged: boolean;
  activeRemoteSnapshot: RemoteSnapshotSummary | null;
}

export interface CloudSaveOverview extends CloudSaveStateResult {
  isAutomaticSyncEnabled: boolean;
  suggestedAction: CloudSaveSyncAction;
  discoveredVariantCount: number;
  unresolvedRemoteVariantCount: number;
  warnings: UserLocationCoverage[];
}

export type CloudSaveV2FileComparisonStatus =
  | "unchanged"
  | "modified"
  | "local-only"
  | "remote-only";

interface CloudSaveV2FileBase extends CloudSaveFileIdentity {
  sizeBytes: number;
  lastModifiedAt: string | null;
  userLabel: string;
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
  version: number;
  updatedAt: string;
  files: CloudSaveV2RemoteFile[];
}

export type CloudSaveV2FileSource =
  | CloudSaveV2LocalFileSource
  | CloudSaveV2ActiveSnapshotFileSource;

export interface CloudSaveV2FileComparison extends CloudSaveFileIdentity {
  status: CloudSaveV2FileComparisonStatus;
  local: CloudSaveV2LocalFile | null;
  remote: CloudSaveV2RemoteFile | null;
}

export interface CloudSaveV2FileDetails {
  state: CloudSaveState;
  local: CloudSaveV2LocalFileSource;
  activeSnapshot: CloudSaveV2ActiveSnapshotFileSource | null;
  comparisons: CloudSaveV2FileComparison[];
  variants: Array<{
    variantId: string;
    userLabel: string;
    fileCount: number;
    conflictCount: number;
    active: boolean;
    warningCodes: string[];
  }>;
  unresolvedRemoteVariantCount: number;
}

export type CloudSaveSyncTrigger =
  | "manual"
  | "environment-changed"
  | "pre-launch"
  | "post-exit";

export type CloudSaveSyncAction =
  | "none"
  | "upload"
  | "restore"
  | "merge"
  | "conflict";

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
      status: "completed" | "conflict";
      result?: SyncGameCloudSaveResult;
    }
  | {
      gameId: CloudSaveGameId;
      trigger: CloudSaveAutomaticSyncTrigger;
      status: "failed";
      errorCode?: string;
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
  approvedRules: Array<Pick<CloudSaveRule, "kind" | "rawPath" | "source">>;
  variants: SnapshotVariant[];
  files: RestoreManifestFile[];
}

export type RestorePlanActionKind = "skip-identical" | "create" | "replace";

export interface ResolvedRestoreTarget extends RestoreManifestFile {
  targetPath: string;
  restoreRootPath: string;
  action: RestorePlanActionKind;
}

export type BlockedRestoreReason =
  | "blocked-user-not-found"
  | "blocked-user-ambiguous"
  | "blocked-rule-unavailable"
  | "blocked-target-outside-root"
  | "blocked-target-ambiguous";

export interface BlockedRestoreFile extends RestoreManifestFile {
  reason: BlockedRestoreReason;
}

export interface ResolveRestoreTargetsResult {
  actions: ResolvedRestoreTarget[];
  blocked: BlockedRestoreFile[];
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

interface RestoreTargetIdentity extends CloudSaveFileIdentity {
  targetPath: string;
  restoreRootPath: string;
  lastModifiedAt: string;
}

export type ReplaceRestoreTarget =
  | (RestoreTargetIdentity & {
      action: "restore";
      tempPath: string;
      expectedHash: string;
    })
  | (RestoreTargetIdentity & {
      action: "skip";
      expectedHash: string;
    });

export interface RestoreResultFile extends RestoreTargetIdentity {}

export interface RestoreSkippedFile extends RestoreTargetIdentity {
  reason: "already_matches_expected_state";
}

export interface RestoreFailedFile extends RestoreTargetIdentity {
  reason: "failed_to_replace_target" | "restore_rolled_back";
}

export interface RestoreMetadataFailure {
  path: string;
  kind: "file" | "directory";
  reason:
    | "invalid-last-modified-at"
    | "target-outside-restore-root"
    | "failed-to-read-original-mtime"
    | "failed-to-set-mtime"
    | "failed-to-restore-mtime-during-rollback";
}

export interface ReplaceRestoreTargetsResult {
  restoredFiles: RestoreResultFile[];
  skippedFiles: RestoreSkippedFile[];
  failedFiles: RestoreFailedFile[];
  metadataFailures: RestoreMetadataFailure[];
  updatedDirectoryCount: number;
}

export interface RestoreRemoteSnapshotResult {
  ok: boolean;
  partial: boolean;
  restoredFiles: number;
  skippedFiles: number;
  failedFiles: number;
  metadataFailedPaths: number;
  blockedFiles: number;
  unresolvedRemoteEntryIds: string[];
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

export interface LocalGameSnapshotFile extends SnapshotFile {}

export interface LocalGameSnapshot {
  gameId: CloudSaveGameId;
  manifestKey?: string | null;
  ruleSourceRevision: string;
  discoveryEngineVersion: number;
  coverage: UserLocationCoverage[];
  variants: SnapshotVariant[];
  fileCount: number;
  totalSizeBytes: number;
  files: LocalGameSnapshotFile[];
}

export interface LocalGameSnapshotWithHash extends LocalGameSnapshot {
  aggregateHash: string;
}

export interface LocalGameSnapshotSourceFile extends CloudSaveFileIdentity {
  ruleId: string;
  absolutePath: string;
  hash: string;
  sizeBytes: number;
  lastModifiedAt: string;
  localBindings: LocalResolutionBindings;
  confidence: "authoritative" | "exact" | "inferred";
  provenance: string[];
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

export interface PrepareSnapshotRequest extends CloudSaveGameId {
  platform: CloudSavePathContext["platform"];
  hostname?: string;
  snapshotHash: string;
  baseVersion: number;
  variants: SnapshotVariant[];
  files: SnapshotFile[];
}

interface PrepareSnapshotFileIdentity extends CloudSaveFileIdentity {
  status: "skip" | "upload";
}

export type PrepareSnapshotFile =
  | (PrepareSnapshotFileIdentity & { status: "skip" })
  | (PrepareSnapshotFileIdentity & {
      status: "upload";
      uploadUrl: string;
      requiredHeaders: {
        "Content-Length": string;
        "x-amz-checksum-sha256": string;
      };
    });

export interface PrepareSnapshotResponse {
  pendingSnapshotId: string;
  snapshotHash: string;
  files: PrepareSnapshotFile[];
}

export interface CommitSnapshotRequest {
  pendingSnapshotId: string;
}

export interface CloudSaveUploadProgress {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
  currentFile: string | null;
}

export interface UploadLocalGameSnapshotResult {
  pendingSnapshotId: string | null;
  uploadedFiles: number;
  skippedFiles: number;
}

export interface CommitSnapshotResponse {
  snapshotId: string;
  version: number;
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
}

export interface RemoteGameSnapshot {
  id: string;
  version: number;
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
}

export interface CloudSaveSyncAnchorEntry extends CloudSaveFileIdentity {
  hash: string;
  sizeBytes: number;
}

export interface CloudSaveSyncAnchor {
  schemaVersion: 4;
  environmentId: string;
  baseSnapshotId: string;
  baseVersion: number;
  baseAggregateHash: string;
  entries: CloudSaveSyncAnchorEntry[];
  unresolvedRemoteEntryIds: string[];
  updatedAt: string;
}

export type CloudSaveMergeConflict = {
  entryId: string;
  local: LocalGameSnapshotFile;
  remote: SnapshotFile;
};

export interface CloudSaveMergeResult {
  variants: SnapshotVariant[];
  files: SnapshotFile[];
  conflicts: CloudSaveMergeConflict[];
  restoreEntryIds: string[];
  unresolvedRemoteEntryIds: string[];
  partial: boolean;
}
