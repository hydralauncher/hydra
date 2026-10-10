export const STORE_DETAILS_TIMEOUT_MS = 12_000;

export const resolveCachedStoreDetails = async <T>(
  cached: T | null | undefined,
  refresh: () => Promise<T | null>,
  save: (details: T) => Promise<void>,
  onError: (error: unknown) => void
): Promise<T | null> => {
  const refreshed = refresh()
    .then((details) => {
      if (details) void save(details).catch(onError);
      return details;
    })
    .catch((error) => {
      onError(error);
      return null;
    });
  return cached ?? refreshed;
};

export const resolveStoreDetails = async <T>(
  direct: () => Promise<T | null>,
  fallback: () => Promise<T | null>,
  usable: (value: T) => boolean
): Promise<T | null> => {
  try {
    const details = await direct();
    if (details && usable(details)) return details;
  } catch {
    // The persisted English payload remains available when the store fails.
  }
  return fallback();
};
