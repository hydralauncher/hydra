export interface LudusaviScanChange {
  change: "New" | "Different" | "Removed" | "Same" | "Unknown";
  decision: "Processed" | "Cancelled" | "Ignore";
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
  games: Record<string, LudusaviScanChange>;
}

export interface LudusaviFindResult {
  games: Record<string, unknown>;
}
