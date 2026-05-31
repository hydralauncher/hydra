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
