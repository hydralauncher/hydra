import type { GameShop } from "./game.types";

export interface HydraBackupMetadata {
  /** Schema version for forward-compatibility */
  version: 1;
  /** Game title as stored in Hydra */
  gameName: string;
  /** Steam AppID or custom objectId */
  steamAppId: string;
  /** Game shop type */
  shop: GameShop;
  /** ISO 8601 timestamp when backup was created */
  backupDate: string;
  /** Always "Hydra" — identifies the source launcher */
  launcher: "Hydra";
  /** OS platform at time of backup */
  platform: NodeJS.Platform;
  /** Machine hostname at time of backup */
  hostname: string;
  /** Absolute paths to save files as reported by Ludusavi */
  originalSavePaths: string[];
  /** Wine prefix path (Linux only) */
  winePrefixPath?: string | null;
  /** Detected Steam emulator type, if identifiable */
  emulatorType?: string | null;
  /** Game version string, if available */
  gameVersion?: string | null;
}

export interface BackupRelocationResult {
  /** Whether any files were relocated */
  relocated: boolean;
  /** Original save paths (from backup metadata) */
  from: string[];
  /** New save paths (current system) */
  to: string[];
  /** Number of files successfully relocated */
  filesRelocated: number;
}
