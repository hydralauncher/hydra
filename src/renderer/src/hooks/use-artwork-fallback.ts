import { useEffect, useState } from "react";

import type { ArtworkKind, GameShop } from "@types";

const resolvedCache = new Map<string, string | null>();
const inflightRequests = new Map<string, Promise<string | null>>();

const cacheKey = (shop: GameShop, objectId: string, kind: ArtworkKind) =>
  `${shop}:${objectId}:${kind}`;

const requestFallback = (
  shop: GameShop,
  objectId: string,
  kind: ArtworkKind
): Promise<string | null> => {
  const key = cacheKey(shop, objectId, kind);

  const existing = inflightRequests.get(key);
  if (existing) return existing;

  const request = globalThis.window.electron
    .getGameArtwork(shop, objectId, kind, 0)
    .then((page) => page?.items?.[0]?.url ?? null)
    .catch(() => null)
    .then((url) => {
      resolvedCache.set(key, url);
      inflightRequests.delete(key);
      return url;
    });

  inflightRequests.set(key, request);
  return request;
};

export function useArtworkFallback(
  shop: GameShop,
  objectId: string,
  kind: ArtworkKind,
  enabled: boolean
): string | null {
  const key = cacheKey(shop, objectId, kind);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(
    () => resolvedCache.get(key) ?? null
  );

  useEffect(() => {
    if (!enabled) {
      setFallbackUrl(null);
      return;
    }

    if (resolvedCache.has(key)) {
      setFallbackUrl(resolvedCache.get(key) ?? null);
      return;
    }

    let cancelled = false;
    requestFallback(shop, objectId, kind).then((url) => {
      if (!cancelled) setFallbackUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, key, shop, objectId, kind]);

  return enabled ? fallbackUrl : null;
}
