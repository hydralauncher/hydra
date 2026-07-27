import type { GameShop } from "./game.types";

export interface CloudBackupMetadataSummary {
  gameName: string;
  steamAppId: string;
  gameVersion: string | null;
  platform: NodeJS.Platform | string;
  backupDate: string;
}

export interface CloudBackupEntry {
  /** Full remote path of the archive, e.g. disk:/HydraBackups/steam/220/backup_....tar.gz */
  path: string;
  /** File name of the archive */
  name: string;
  shop: GameShop;
  objectId: string;
  /** Resolved from the local library when available, falling back to metadata or objectId */
  gameTitle: string;
  created: string;
  modified: string;
  size: number;
  /** Present only when a metadata sidecar file was uploaded alongside the archive */
  metadata: CloudBackupMetadataSummary | null;
}

export interface CloudStorageUsage {
  totalSpace: number;
  usedSpace: number;
  backupsSize: number;
  backupsCount: number;
}
