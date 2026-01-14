import { useCallback, useEffect, useState } from "react";
import type { GameShop } from "@types";
import { formatBytes } from "@renderer/utils/format-bytes";
import { logger } from "@renderer/logger";

interface GameDiskUsageResult {
  installerSize: string | null;
  installedSize: string | null;
  totalSize: string | null;
  isLoading: boolean;
  refetch: () => void;
}

export function useGameDiskUsage(
  shop: GameShop,
  objectId: string
): GameDiskUsageResult {
  const [installerSizeBytes, setInstallerSizeBytes] = useState<number | null>(
    null
  );
  const [installedSizeBytes, setInstalledSizeBytes] = useState<number | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);

  const fetchDiskUsage = useCallback(async () => {
    logger.log("useGameDiskUsage: fetching for", { shop, objectId });
    setIsLoading(true);
    try {
      const result = await window.electron.getGameDiskUsage(shop, objectId);
      logger.log("useGameDiskUsage: got result", result);
      setInstallerSizeBytes(result.installerSize);
      setInstalledSizeBytes(result.installedSize);
    } catch (err) {
      logger.error("Failed to fetch disk usage:", err);
      setInstallerSizeBytes(null);
      setInstalledSizeBytes(null);
    } finally {
      setIsLoading(false);
    }
  }, [shop, objectId]);

  useEffect(() => {
    fetchDiskUsage();
  }, [fetchDiskUsage]);

  const installerSize =
    installerSizeBytes !== null ? formatBytes(installerSizeBytes) : null;
  const installedSize =
    installedSizeBytes !== null ? formatBytes(installedSizeBytes) : null;

  const totalBytes =
    (installerSizeBytes ?? 0) + (installedSizeBytes ?? 0) || null;
  const totalSize = totalBytes !== null ? formatBytes(totalBytes) : null;

  return {
    installerSize,
    installedSize,
    totalSize,
    isLoading,
    refetch: fetchDiskUsage,
  };
}
