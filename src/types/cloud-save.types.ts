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
  /**
   * Local-only binding for an explicitly approved custom path. It is never
   * included in the remote snapshot identity.
   */
  preferredPath?: string;
}

export type CloudSaveCustomPathPlatform = "windows" | "linux" | "mac";

export interface CloudSaveCustomPath {
  rawPath: string;
  path: string;
  platform: CloudSaveCustomPathPlatform;
  storeUserId?: string;
}

export type CloudSaveUnresolvedCustomPathState =
  | "recoverable"
  | "needs-confirmation"
  | "invalid";

export type CloudSaveUnresolvedCustomPathReason =
  | "environment-unavailable"
  | "wine-prefix-unavailable"
  | "wine-profile-unavailable"
  | "account-selection-required"
  | "legacy"
  | "foreign-platform"
  | "unregistered"
  | "mapped-location-overlap"
  | "custom-location-overlap"
  | "invalid";

export interface CloudSaveUnresolvedCustomPath {
  rawPath: string;
  pathHint: string | null;
  state: CloudSaveUnresolvedCustomPathState;
  reason: CloudSaveUnresolvedCustomPathReason;
  registered: boolean;
}

export interface CloudSaveCustomPathBindings {
  ready: CloudSaveCustomPath[];
  unresolved: CloudSaveUnresolvedCustomPath[];
}

export interface CheckCloudSaveCustomPathOverlapInput
  extends Omit<CloudSavePathContext, "storeUserContext"> {
  rules: CloudSaveRule[];
  selectedPath: string;
  remoteRelativePaths: string[];
}

export type CloudSaveCustomPathOverlapReason =
  | "mapped-location-overlap"
  | "custom-location-overlap"
  | "remote-target-mapped";

export interface CheckCloudSaveCustomPathOverlapResult {
  hasOverlap: boolean;
  reason?: CloudSaveCustomPathOverlapReason;
  conflictingRawPath?: string;
}

export interface SelectCloudSaveCustomPathResult {
  canceled: boolean;
  customPath?: CloudSaveCustomPath;
}

export interface CloudSaveCustomPathApproval {
  id: string;
  gameId: CloudSaveGameId;
  purpose: "pre-launch" | "manual-sync" | "custom-path-rebind";
  rawPath: string;
  suggestedPath: string | null;
  selectedPath: string | null;
  canUseSuggestedPath: boolean;
  fileCount: number;
  totalSizeBytes: number;
  files: CloudSaveCustomPathApprovalFile[];
  snapshotId: string | null;
  snapshotVersion: number | null;
}

export interface CloudSaveCustomPathApprovalFile {
  name: string;
  relativePath: string;
  sizeBytes: number;
  lastModifiedAt: string;
}

export interface SelectCloudSaveCustomPathApprovalResult {
  canceled: boolean;
  approval: CloudSaveCustomPathApproval;
}

export interface ConfirmCloudSaveCustomPathApprovalResult {
  pendingApproval: CloudSaveCustomPathApproval | null;
}

export interface ConfirmCloudSaveCustomPathRebindApprovalResult {
  rawPath: string;
}

export type CloudSaveModalSyncResult =
  | {
      status: "approval-required";
      approval: CloudSaveCustomPathApproval;
    }
  | {
      status: "completed";
      result: SyncGameCloudSaveResult;
    };

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
  source:
    | "active-login"
    | "known-login"
    | "userdata-folder"
    | "remote-snapshot";
}

export interface StoreUserContext {
  active?: KnownStoreAccount;
  known: KnownStoreAccount[];
}

export interface StoreUserIdentity {
  kind: "default" | "folder-profile";
  store: string;
  steamId64?: string;
  accountId32?: string;
  concreteFolderId: string;
  source: "folder-match" | "unbound-rule";
  authority: "inferred" | "literal";
}

export interface PortableStoreUserIdentity {
  kind: "default" | "folder-profile";
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
  selectedRoot: boolean;
  authority: "authoritative" | "exact" | "inferred";
  outcome:
    | "scanned"
    | "confirmed-missing"
    | "partial"
    | "failed"
    | "unresolved"
    | "foreign-environment";
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
  extraRules?: CloudSaveRule[];
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
  customPathRawPaths: string[];
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
  localSnapshotSummary: {
    updatedAt: string | null;
    totalSizeBytes: number;
  };
  isAutomaticSyncEnabled: boolean;
  suggestedAction: CloudSaveSyncAction;
  discoveredVariantCount: number;
  unresolvedRemoteVariantCount: number;
  unconfiguredCustomPathCount: number;
  warnings: UserLocationCoverage[];
}

export type CloudSaveAutomaticSyncMode = "disabled" | "legacy" | "v2";

export interface CloudSaveAutomaticSyncModeChangedEvent {
  gameId: CloudSaveGameId;
  mode: CloudSaveAutomaticSyncMode;
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
  customPaths: CloudSaveCustomPath[];
  unresolvedCustomPaths: CloudSaveUnresolvedCustomPath[];
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
  | "game-page-open"
  | "custom-path-rebind"
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

export type SyncCloudSaveOnGamePageResult =
  | {
      accepted: false;
      reason: "game-running";
    }
  | {
      accepted: true;
      result: SyncGameCloudSaveResult | null;
    };

export type CloudSaveAutomaticSyncTrigger = Exclude<
  CloudSaveSyncTrigger,
  "manual" | "custom-path-rebind"
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
      status: "completed" | "conflict" | "cancelled";
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

export interface ResolveRestoreTargetsInput
  extends Omit<CloudSavePathContext, "storeUserContext"> {
  approvedRules: Array<
    Pick<
      CloudSaveRule,
      "kind" | "rawPath" | "source" | "preferredPath" | "when"
    >
  >;
  variants: SnapshotVariant[];
  files: RestoreManifestFile[];
}

export type RestorePlanActionKind = "skip-identical" | "create" | "replace";

export interface ResolvedRestoreTarget extends RestoreManifestFile {
  targetPath: string;
  restoreRootPath: string;
  action: RestorePlanActionKind;
  observedHash?: string;
  observedSizeBytes?: number;
  observedLastModifiedAt?: string;
}

export type BlockedRestoreReason =
  | "blocked-user-not-found"
  | "blocked-user-ambiguous"
  | "blocked-rule-unavailable"
  | "blocked-relative-path-incomplete"
  | "blocked-target-outside-root"
  | "blocked-target-ambiguous"
  | "foreign-environment";

export interface BlockedRestoreFile extends RestoreManifestFile {
  reason: BlockedRestoreReason;
}

export interface ResolveRestoreTargetsResult {
  actions: ResolvedRestoreTarget[];
  blocked: BlockedRestoreFile[];
  deferred: BlockedRestoreFile[];
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

export interface DeleteLocalSaveTarget extends CloudSaveFileIdentity {
  targetPath: string;
  restoreRootPath: string;
  expectedHash: string;
  expectedSizeBytes: number;
}

export interface DeleteLocalSaveTargetsResult {
  deletedFiles: CloudSaveFileIdentity[];
  deletedDirectories: string[];
  cleanupFailureCount: number;
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
  customPathRawPaths: string[];
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
  customPathRawPaths: string[];
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
  local: LocalGameSnapshotFile | null;
  remote: SnapshotFile | null;
};

export interface CloudSaveMergeResult {
  variants: SnapshotVariant[];
  files: SnapshotFile[];
  conflicts: CloudSaveMergeConflict[];
  restoreEntryIds: string[];
  deleteRemoteEntryIds: string[];
  deleteLocalEntryIds: string[];
  unresolvedRemoteEntryIds: string[];
  partial: boolean;
}
