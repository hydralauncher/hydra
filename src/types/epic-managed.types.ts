import type { EpicErrorCode } from "./epic-integration.types";

export type EpicInstallPlatform = "Windows" | "Mac";

/** Local account ownership; never a catalogue identity or a credential. */
export interface EpicLocalOwner {
  environment: string;
  userId: string;
  epicAccountId: string;
}

export interface EpicInstallation {
  owner: EpicLocalOwner;
  artifactId: string;
  platform: EpicInstallPlatform;
  savePath?: string | null;
  savePathSource?: "automatic" | "custom";
  savePathPrefixGeneration?: string;
  automaticSaveSync?: boolean;
  saveAnchor?: {
    remoteManifest: string | null;
    /** Missing on legacy anchors, which must recheck the remote version. */
    remoteModifiedAt?: string | null;
    localDigest: string;
  };
  pendingSaveUpload?: boolean;
}

export interface EpicDownloadMetadata {
  owner: EpicLocalOwner;
  connectionId: string;
  artifactId: string;
  platform: EpicInstallPlatform;
  diskSizeInBytes: number;
  phase?: "preparing" | "downloading" | "finalizing" | "prerequisites";
  error?: EpicInstallError;
}

export type EpicInstallError =
  | EpicErrorCode
  | "game-not-owned"
  | "invalid-artifact"
  | "ambiguous-artifact"
  | "not-installable"
  | "external-launcher-required"
  | "invalid-path"
  | "insufficient-space"
  | "installation-incomplete"
  | "installation-missing"
  | "process-failed"
  | "prerequisites-required"
  | "game-running"
  | "update-required"
  | "compatibility-runtime-unavailable"
  | "compatibility-runtime-download-failed"
  | "compatibility-prefix-invalid"
  | "compatibility-prefix-busy"
  | "compatibility-launch-failed";

export interface EpicLinuxCompatibility {
  winePrefixPath: string | null;
  protonName: string | null;
  protonSource: "game" | "global" | "umu";
}

export interface EpicGameInstallOption {
  preparationId?: string;
  artifactId: string;
  platform: EpicInstallPlatform;
  downloadSizeInBytes: number | null;
  diskSizeInBytes: number | null;
  supportsCloudSaves: boolean;
  installed: boolean;
}

export interface EpicGameInstallOptions {
  connectionId?: string;
  options: EpicGameInstallOption[];
  error?: EpicInstallError;
}

export interface StartEpicGameDownloadPayload {
  preparationId?: string;
  epicObjectId: string;
  connectionId: string;
  artifactId: string;
  platform: EpicInstallPlatform;
  downloadPath: string;
  addToQueueOnly?: boolean;
}

export interface EpicLaunchOptions {
  epicSavePolicy?: "local-once";
  epicOffline?: boolean;
}

export type EpicSaveError =
  | EpicInstallError
  | "saves-unsupported"
  | "save-path-required"
  | "save-conflict"
  | "save-sync-failed"
  | "save-verification-failed"
  | "save-operation-active";

export type EpicCloudSaveStatus =
  | "idle"
  | "syncing"
  | "conflict"
  | "pending-upload"
  | "unavailable"
  | "up-to-date";

export interface EpicCloudSaveState {
  epicObjectId: string;
  status: EpicCloudSaveStatus;
  supportsCloudSaves: boolean;
  canRunOffline?: boolean;
  automaticSync: boolean;
  savePath: string | null;
  pendingUpload: boolean;
  remoteManifest: string | null;
  phase?: "checking" | "downloading" | "restoring" | "uploading" | "verifying";
  localModifiedAt?: string | null;
  remoteModifiedAt?: string | null;
  error?: EpicSaveError;
}

export interface EpicCloudSaveSettings {
  automaticSync: boolean;
  savePath?: string | null;
}

export interface ResolveEpicCloudSaveConflictPayload {
  epicObjectId: string;
  expectedRemoteManifest: string | null;
  expectedRemoteModifiedAt: string | null;
  choice: "local" | "remote";
}

export type EpicManagedOperationResult =
  | { ok: true }
  | { ok: false; error: EpicSaveError };
