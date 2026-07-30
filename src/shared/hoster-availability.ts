export const VIKINGFILE_URI_PREFIXES = [
  "https://vikingfile.com",
  "https://vik1ngfile.site",
];

export const HOSTER_AVAILABILITY_MAX_URIS_PER_REQUEST = 50;

export const supportsHosterAvailabilityCheck = (uri: string) =>
  VIKINGFILE_URI_PREFIXES.some((prefix) => uri.startsWith(prefix));

export const getCheckableHosterUris = (uris: string[]) =>
  Array.from(new Set(uris.filter(supportsHosterAvailabilityCheck)));

export interface HosterAvailabilityCheckable {
  uris: string[];
  unavailableUris: string[];
}

export const applyHosterAvailability = <T extends HosterAvailabilityCheckable>(
  repacks: T[],
  availability: Record<string, boolean>
): T[] => {
  if (Object.keys(availability).length === 0) return repacks;

  return repacks.map((repack) => {
    const uris = Array.isArray(repack.uris) ? repack.uris : [];
    const checkedUris = uris.filter((uri) => uri in availability);

    if (checkedUris.length === 0) return repack;

    const unavailableUris = new Set(
      Array.isArray(repack.unavailableUris) ? repack.unavailableUris : []
    );

    for (const uri of checkedUris) {
      if (availability[uri]) {
        unavailableUris.delete(uri);
      } else {
        unavailableUris.add(uri);
      }
    }

    return { ...repack, unavailableUris: Array.from(unavailableUris) };
  });
};
