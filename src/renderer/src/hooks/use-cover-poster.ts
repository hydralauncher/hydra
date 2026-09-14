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
): string | null | undefined {
  const [poster, setPoster] = useState<string | null | undefined>(() =>
    url && posterCache.has(url) ? posterCache.get(url) : undefined
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

    setPoster(undefined);

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

const warmedSources = new Map<string, HTMLImageElement>();

export function useAnimatedSourceWarmup(
  source: string | null | undefined,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled || !source || warmedSources.has(source)) return;

    let cancelled = false;

    const warm = () => {
      if (cancelled || warmedSources.has(source)) return;

      const image = new Image();
      image.decoding = "async";
      image.src = source;

      warmedSources.set(source, image);
    };

    const requestIdle = globalThis.window.requestIdleCallback;

    if (typeof requestIdle === "function") {
      const handle = requestIdle(warm, { timeout: 3000 });

      return () => {
        cancelled = true;
        globalThis.window.cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(warm, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [enabled, source]);
}
