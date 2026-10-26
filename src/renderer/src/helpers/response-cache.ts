export const RESPONSE_CACHE_TTL_MS = 60_000;
export const MAX_CACHED_RESPONSES = 200;

export interface ApiRequestOptions {
  params: Record<string, string | number>;
  needsAuth: boolean;
}

export type ApiGet = (
  path: string,
  options: ApiRequestOptions
) => Promise<unknown>;

export const getRequestKey = (
  path: string,
  options: ApiRequestOptions,
  accountId: string | null = null
) => {
  const params = Object.entries(options.params)
    .map(([key, value]) => `${key}=${value}`)
    .sort((a, b) => a.localeCompare(b))
    .join("&");

  return `${accountId ?? "guest"}|${path}?${params}|auth=${options.needsAuth}`;
};

export const createResponseCache = (
  get: ApiGet,
  now: () => number = Date.now,
  ttl = RESPONSE_CACHE_TTL_MS,
  maxEntries = MAX_CACHED_RESPONSES
) => {
  const cache = new Map<string, { at: number; response: unknown }>();
  const inFlight = new Map<string, Promise<unknown>>();
  let generation = 0;

  const peek = (
    path: string,
    options: ApiRequestOptions,
    accountId: string | null = null
  ) => {
    const key = getRequestKey(path, options, accountId);
    const cached = cache.get(key);
    if (!cached) return undefined;
    if (now() - cached.at < ttl) return cached.response;

    cache.delete(key);
    return undefined;
  };

  const store = (key: string, response: unknown) => {
    cache.delete(key);
    cache.set(key, { at: now(), response });

    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const request = (
    path: string,
    options: ApiRequestOptions,
    accountId: string | null = null
  ): Promise<unknown> => {
    const key = getRequestKey(path, options, accountId);
    const cached = peek(path, options, accountId);
    if (cached !== undefined) return Promise.resolve(cached);

    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;

    const requestGeneration = generation;
    const promise: Promise<unknown> = get(path, options)
      .then((response) => {
        if (requestGeneration === generation) store(key, response);
        return response;
      })
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  };

  const evict = (
    path: string,
    options: ApiRequestOptions,
    accountId: string | null = null
  ) => {
    cache.delete(getRequestKey(path, options, accountId));
  };

  const evictPath = (path: string) => {
    for (const key of [...cache.keys()]) {
      if (key.includes(`|${path}?`)) cache.delete(key);
    }
  };

  const clear = () => {
    generation += 1;
    cache.clear();
    inFlight.clear();
  };

  return { get: request, peek, evict, evictPath, clear };
};
