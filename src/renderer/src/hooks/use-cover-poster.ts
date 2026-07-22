import { useEffect, useState } from "react";

const posterCache = new Map<string, string | null>();
const inflightRequests = new Map<string, Promise<string | null>>();

const ANIMATED_COVER_PATTERN = /\.(webp|gif|png|apng)(\?.*)?$/i;

export const isAnimatedCoverCandidate = (url: string | null | undefined) =>
  !!url && ANIMATED_COVER_PATTERN.test(url);

const requestPoster = (url: string): Promise<string | null> => {
  const existing = inflightRequests.get(url);
  if (existing !== undefined) return existing;

  if (typeof globalThis.window.electron?.getCoverPoster !== "function") {
    return Promise.resolve(null);
  }

  const request = globalThis.window.electron
    .getCoverPoster(url)
    .catch(() => null)
    .then((poster) => {
      posterCache.set(url, poster);
      inflightRequests.delete(url);
      return poster;
    });

  inflightRequests.set(url, request);
  return request;
};

export function useCoverPoster(
  url: string | null | undefined,
  enabled: boolean
): string | null {
  const [poster, setPoster] = useState<string | null>(() =>
    url ? (posterCache.get(url) ?? null) : null
  );

  useEffect(() => {
    if (!enabled || !url) {
      setPoster(null);
      return;
    }

    if (posterCache.has(url)) {
      setPoster(posterCache.get(url) ?? null);
      return;
    }

    let cancelled = false;
    requestPoster(url).then((resolved) => {
      if (!cancelled) setPoster(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

  return enabled ? poster : null;
}
