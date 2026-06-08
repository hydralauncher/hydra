/**
 * Normalize a raw game serial into the canonical `XXXX-NNNNN` SKU shape used by
 * the LaunchBox shop-details endpoint (e.g. `SLUS_213.76` -> `SLUS-21376`).
 *
 * Kept as a dependency-free leaf module (no logger, no path aliases) so the pure
 * `.ps2` parser and the standalone verification script can import it without
 * pulling in Electron/`@main` resolution. `extract-disc-sku.ts` re-exports it.
 */
export const normalize = (raw: string): string => {
  const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = /^([A-Z]{4})(\d+)$/.exec(stripped);
  if (!match) return stripped;
  return `${match[1]}-${match[2]}`;
};
