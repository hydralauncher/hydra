interface CacheEntry<T> {
  computedAt: number;
  value: T;
  refresh?: Promise<T>;
}

export const createThrottledCache = <T>(
  compute: (key: string) => Promise<T>,
  intervalInMs: number,
  createEmptyValue: () => T,
  onError?: (error: unknown) => void
) => {
  const entries = new Map<string, CacheEntry<T>>();

  const isStale = (entry: CacheEntry<T> | undefined) =>
    !entry || Date.now() - entry.computedAt >= intervalInMs;

  const startRefresh = (key: string, entry: CacheEntry<T> | undefined) => {
    const previousValue = entry?.value ?? createEmptyValue();

    const refresh = compute(key)
      .catch((error) => {
        onError?.(error);

        return previousValue;
      })
      .then((value) => {
        entries.set(key, { computedAt: Date.now(), value });

        return value;
      });

    entries.set(key, {
      computedAt: entry?.computedAt ?? 0,
      value: previousValue,
      refresh,
    });

    return refresh;
  };

  return {
    get(key: string): T {
      const entry = entries.get(key);

      if (isStale(entry) && entry?.refresh === undefined) {
        startRefresh(key, entry);
      }

      return entry?.value ?? createEmptyValue();
    },

    resolve(key: string): Promise<T> {
      const entry = entries.get(key);
      const refresh = entry?.refresh;

      if (refresh !== undefined) return refresh;

      if (entry && !isStale(entry)) return Promise.resolve(entry.value);

      return startRefresh(key, entry);
    },
  };
};
