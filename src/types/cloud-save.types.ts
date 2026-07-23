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
  kind: "validated-account" | "opaque-folder";
  store: string;
  steamId64?: string;
  accountId32?: string;
  concreteFolderId: string;
  source: "active-login" | "known-login" | "folder-match" | "unbound-rule";
  authority: "active" | "known" | "inferred";
}

export interface PortableStoreUserIdentity {
  kind: "validated-account" | "opaque-folder";
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

export type CloudSaveTargetSemantics =
  | "single-file"
  | "directory-tree"
  | "glob-set";

export interface PortableLocator {
  version: 1;
  ruleId: string;
  rawRule: string;
  ruleSource: string;
  rootKind: string;
  bindings: PortableBindings;
  targetSemantics: CloudSaveTargetSemantics;
}

export interface UserLocationCoverage {
  candidateId: string;
  ruleId: string;
  variantId?: string;
  logicalFileId?: string;
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
  environmentId: string;
  storeUserContext: StoreUserContext;
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
  storeUserContext: StoreUserContext;
}

export interface UserVariantSnapshotFile {
  logicalFileId: string;
  variantId: string;
  ruleId: string;
  relativePath: string;
  locator: PortableLocator;
  contentHash: string;
  sizeBytes: number;
}

export interface BuildSnapshotAggregateHashInput {
  schemaVersion: number;
  saveNamespaceKey: string;
  files: UserVariantSnapshotFile[];
}

export interface RestoreManifestFile extends UserVariantSnapshotFile {
  lastModifiedAt?: string | null;
}

export interface RestoreManifestResponse {
  snapshot: CloudSaveGameId & {
    id: string;
    revision: number;
    aggregateHash: string;
    schemaVersion: number;
  };
  files: RestoreManifestFile[];
}

export interface RemoteSnapshotSummary {
  id: string;
  status: "active" | "historical";
  createdAt: string;
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
  revision: number;
  schemaVersion: number;
}

export interface CloudSaveHeadResponse {
  revision: number;
  snapshotId: string | null;
  snapshotHash: string | null;
  schemaVersion: number | null;
  files: UserVariantSnapshotFile[];
}

export type CloudSaveState =
  | "synced"
  | "partial"
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
  discoveredVariantCount: number;
  unresolvedRemoteVariantCount: number;
  warnings: UserLocationCoverage[];
}

export type CloudSaveV2FileComparisonStatus =
  | "unchanged"
  | "modified"
  | "local-only"
  | "remote-only";

interface CloudSaveV2FileBase {
  logicalFileId: string;
  variantId: string;
  ruleId: string;
  rawPath: string;
  relativePath: string;
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
  createdAt: string;
  files: CloudSaveV2RemoteFile[];
}

export type CloudSaveV2FileSource =
  | CloudSaveV2LocalFileSource
  | CloudSaveV2ActiveSnapshotFileSource;

export interface CloudSaveV2FileComparison {
  logicalFileId: string;
  variantId: string;
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
  approvedRules: Array<Pick<CloudSaveRule, "ruleId" | "rawPath" | "source">>;
  files: RestoreManifestFile[];
}

export type RestorePlanActionKind = "skip-identical" | "create" | "replace";

export interface ResolvedRestoreTarget extends RestoreManifestFile {
  targetPath: string;
  action: RestorePlanActionKind;
}

export type BlockedRestoreReason =
  | "blocked-user-not-found"
  | "blocked-user-ambiguous"
  | "blocked-rule-unavailable"
  | "blocked-target-outside-root";

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

interface RestoreTargetIdentity {
  logicalFileId: string;
  variantId: string;
  ruleId: string;
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
  partial: boolean;
  restoredFiles: number;
  skippedFiles: number;
  failedFiles: number;
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

export interface LocalGameSnapshotFile extends UserVariantSnapshotFile {}

export interface LocalGameSnapshot {
  gameId: CloudSaveGameId;
  manifestKey?: string | null;
  schemaVersion: number;
  saveNamespaceKey: string;
  ruleSourceRevision: string;
  discoveryEngineVersion: number;
  coverage: UserLocationCoverage[];
  fileCount: number;
  totalSizeBytes: number;
  files: LocalGameSnapshotFile[];
}

export interface LocalGameSnapshotWithHash extends LocalGameSnapshot {
  aggregateHash: string;
}

export interface LocalGameSnapshotSourceFile {
  logicalFileId: string;
  variantId: string;
  ruleId: string;
  relativePath: string;
  absolutePath: string;
  contentHash: string;
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

export type PrepareSnapshotFile =
  | { logicalFileId: string; status: "skip" }
  | { logicalFileId: string; status: "upload"; uploadUrl: string };

export interface PrepareSnapshotResponse {
  pendingSnapshotId: string;
  snapshotHash: string;
  expectedHeadRevision: number;
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
  pendingSnapshotId: string | null;
  uploadedFiles: number;
  skippedFiles: number;
}

export interface CommitSnapshotResponse {
  snapshotId: string;
  status: "active";
  revision: number;
  schemaVersion: number;
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
  files: UserVariantSnapshotFile[];
}

export interface RemoteGameSnapshot {
  id: string;
  status: "active";
  revision: number;
  schemaVersion: number;
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
}

export interface CloudSaveSyncAnchorEntry {
  logicalFileId: string;
  contentHash: string;
  sizeBytes: number;
}

export interface CloudSaveSyncAnchor {
  schemaVersion: 3;
  environmentId: string;
  baseSnapshotId: string;
  baseHeadRevision: number;
  baseAggregateHash: string;
  entries: CloudSaveSyncAnchorEntry[];
  unresolvedRemoteEntryIds: string[];
  updatedAt: string;
}

export type CloudSaveMergeConflict = {
  logicalFileId: string;
  local: LocalGameSnapshotFile;
  remote: UserVariantSnapshotFile;
};

export interface CloudSaveMergeResult {
  files: UserVariantSnapshotFile[];
  conflicts: CloudSaveMergeConflict[];
  restoreEntryIds: string[];
  unresolvedRemoteEntryIds: string[];
  partial: boolean;
}
