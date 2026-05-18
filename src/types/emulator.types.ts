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
