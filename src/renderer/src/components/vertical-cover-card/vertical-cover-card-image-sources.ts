export const getVerticalCoverCardImageSources = (
  sources: readonly (string | null | undefined)[]
) => {
  const seen = new Set<string>();

  return sources.reduce<string[]>((result, source) => {
    const normalizedSource = source?.trim();
    if (!normalizedSource || seen.has(normalizedSource)) return result;

    seen.add(normalizedSource);
    result.push(normalizedSource);
    return result;
  }, []);
};
