export type EmulatorSystem = "ps1" | "ps2" | "ps3";

export type EmulatorBinary = "duckstation" | "pcsx2" | "rpcs3";

export interface RomFolder {
  id: string;
  path: string;
  scanSubfolders: boolean;
  fileCount: number;
  sizeBytes: number;
  lastScanAt: number | null;
}

export interface EmulatorConfig {
  system: EmulatorSystem;
  binary: EmulatorBinary;
  executablePath: string | null;
  detectedVersion: string | null;
  detectedAt: number | null;
  romFolders: RomFolder[];
  lastScanAt: number | null;
  totalFiles: number;
  totalSizeBytes: number;
}

export type EmulatorConfigMap = Record<EmulatorSystem, EmulatorConfig>;

export interface DetectedRom {
  objectId: string;
  title: string;
  libraryImageUrl: string | null;
  iconUrl: string | null;
  sizeBytes: number | null;
  skus: string[];
}

export interface ClassicsDisc {
  path: string;
  label: string;
  fileName: string;
  sku?: string | null;
}

/** A game save detected inside a PS2 memory card (`.ps2`) image. */
export interface Ps2MemoryCardSaveRecord {
  cardFilePath: string; // absolute path to the .ps2 file
  cardLabel: string; // basename, e.g. "Mcd001.ps2"
  folderName: string; // on-card save folder, e.g. "BESLES-50009"
  sku: string | null; // normalized "SLES-50009", or null if unrecognized
  objectId: string | null; // resolved LaunchBox objectId, or null if unmatched
  shop: "launchbox" | null;
  title: string | null; // resolved title (UI falls back to folderName)
  iconUrl: string | null;
  libraryImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  fileCount: number;
  sizeBytes: number;
  createdAt: number; // save's created time (epoch ms)
  modifiedAt: number; // save's modified time (epoch ms)
  detectedAt: number; // when this scan recorded it (epoch ms)
}

export interface Ps2MemcardScanInput {
  autoDetect: boolean;
  manualPaths?: string[];
}

export type Ps2MemcardScanProgress =
  | {
      type: "scan_progress";
      processed: number;
      total: number;
      currentCard: string | null;
    }
  | {
      type: "match_progress";
      processed: number;
      total: number;
      currentSave: string;
      status: "matched" | "unmatched";
      matched: number;
      unmatched: number;
    }
  | {
      type: "done";
      cardCount: number;
      saveCount: number;
      matched: number;
      unmatched: number;
    }
  | { type: "cancelled"; cardCount: number; saveCount: number }
  | { type: "error"; message: string };

export interface Ps2ExportResult {
  ok: boolean;
  location?: string;
  sizeBytes?: number;
  error?: string;
}

/*
 * PS1 (DuckStation) memory card saves reuse the exact same record/scan/export
 * shapes as PS2 — only the on-card format and export container differ. These
 * neutral aliases let the shared sublevel, IPC and UI code read system-agnostic.
 * For PS1, `folderName` holds the on-card save identifier and `fileCount` holds
 * the block count.
 */
export type MemoryCardSaveRecord = Ps2MemoryCardSaveRecord;
export type MemcardScanInput = Ps2MemcardScanInput;
export type MemcardScanProgress = Ps2MemcardScanProgress;
export type MemcardExportResult = Ps2ExportResult;

/* ── Cloud emulation saves (`/profile/emulation-saves`) ───────────────────── */

export type EmulationSavePlatform = "ps1" | "ps2";
export type EmulationSaveEmulator = "duckstation" | "pcsx2";

export interface EmulationBackupProgress {
  platform: EmulationSavePlatform;
  cardFilePath: string;
  processed: number;
  uploaded: number;
  failed: number;
  total: number;
  currentLabel: string | null;
}

/** A committed cloud save as returned by the emulation-saves API. */
export interface EmulationCloudSave {
  id: string;
  platform: EmulationSavePlatform;
  emulator: EmulationSaveEmulator;
  saveKind: "game_save";
  saveIdentity: string;
  artifactLengthInBytes: number;
  fileName: string;
  hostname: string | null;
  localLastModifiedAt: string | null;
  label: string | null;
  metadata: Record<string, unknown> | null;
  shop: "launchbox" | "steam" | null;
  objectId: string | null;
  lastUploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Result of writing a downloaded cloud save back into a local card. */
export interface MemcardRestoreResult {
  ok: boolean;
  error?: string;
}

/** A local memory card a cloud save can be restored into. */
export interface MemcardRestoreTarget {
  cardFilePath: string;
  cardLabel: string;
}

/* ── Emulator install helper (Setup Wizard) ───────────────────────────────── */

export type EmulatorInstallKind =
  | "windows-installer"
  | "linux-appimage"
  | "windows-archive"
  | "link";

export type EmulatorInstallChannel = "release" | "prerelease";

export type EmulatorInstallLinkKind = "aur" | "flatpak" | "release_page";

/** A single, IPC-serializable install option offered for an emulator. */
export interface ResolvedInstallOption {
  id: string;
  binary: EmulatorBinary;
  kind: EmulatorInstallKind;
  channel: EmulatorInstallChannel | null;
  downloadUrl: string | null;
  fileName: string | null;
  version: string | null;
  htmlUrl: string | null;
  linkUrl: string | null;
  linkKind: EmulatorInstallLinkKind | null;
}

export type EmulatorInstallPhase =
  | "downloading"
  | "extracting"
  | "running"
  | "done"
  | "error";

export interface EmulatorInstallProgress {
  binary: EmulatorBinary;
  optionId: string;
  phase: EmulatorInstallPhase;
  loaded?: number;
  total?: number;
  reason?: string;
  path?: string;
}

export interface EmulatorInstallResult {
  ok: boolean;
  path?: string;
  reason?: string;
}
