import { useEffect, useState } from "react";

import type { CloudSaveInsights, GameShop } from "@types";

interface UseCloudSaveInsightsOptions {
  objectId: string | null;
  shop: GameShop | null;
  enabled: boolean;
  refreshKey: string;
}

export const useCloudSaveInsights = ({
  objectId,
  shop,
  enabled,
  refreshKey,
}: UseCloudSaveInsightsOptions) => {
  const [insights, setInsights] = useState<CloudSaveInsights | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const gameKey = objectId && shop ? `${shop}:${objectId}` : null;
  const requestKey = gameKey ? `${gameKey}|${refreshKey}` : null;

  useEffect(() => {
    setInsights(null);
    setLoadedKey(null);
  }, [gameKey]);

  useEffect(() => {
    if (!enabled || !objectId || !shop || !requestKey) return;
    if (loadedKey === requestKey) return;
    let cancelled = false;
    window.electron
      .getCloudSaveInsights(objectId, shop)
      .then((result) => {
        if (cancelled) return;
        setInsights(result);
        setLoadedKey(requestKey);
      })
      .catch(() => {
        if (cancelled) return;
        setInsights(null);
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loadedKey, objectId, requestKey, shop]);

  return {
    insights,
    isLoading: enabled && requestKey !== null && loadedKey !== requestKey,
  };
};
