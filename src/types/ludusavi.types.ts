export interface LudusaviScanChange {
  change: "New" | "Different" | "Removed" | "Same" | "Unknown";
  decision: "Processed" | "Cancelled" | "Ignore";
  bytes: number;
}

export interface LudusaviGame extends LudusaviScanChange {
  files: Record<string, LudusaviScanChange>;
}

export interface LudusaviBackup {
  overall: {
    totalGames: number;
    totalBytes: number;
    processedGames: number;
    processedBytes: number;
    changedGames: {
      new: number;
      different: number;
      same: number;
    };
  };
  games: Record<string, LudusaviGame>;

  // Custom path for the backup, extracted from the config
  customBackupPath?: string | null;
}

export interface LudusaviConfig {
  manifest: {
    enable: boolean;
    secondary: {
      url: string;
      enable: boolean;
    }[];
  };
  customGames: {
    name: string;
    files: string[];
    registry: [];
  }[];
}
