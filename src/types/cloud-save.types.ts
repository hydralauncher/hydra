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

export interface CloudSaveSyncAnchor {
  baseSnapshotId: string;
  baseAggregateHash: string;
  updatedAt: string;
}
