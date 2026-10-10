export const STORE_DETAILS_TIMEOUT_MS = 12_000;

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
