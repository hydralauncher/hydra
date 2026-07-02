import fs from "node:fs";

export const isFlatpak =
  process.platform === "linux" &&
  (!!process.env.FLATPAK_ID || fs.existsSync("/.flatpak-info"));

// Conventional first-user UID on Linux, used only if process.getuid is
// unavailable (non-POSIX platforms).
const DEFAULT_FALLBACK_UID = 1000;

const docPortalPrefixes =
  process.platform === "linux"
    ? [
        `/run/user/${process.getuid?.() ?? DEFAULT_FALLBACK_UID}/doc/`,
        "/run/flatpak/doc/",
      ]
    : [];

export const isDocPortalPath = (filePath: string) =>
  docPortalPrefixes.some((prefix) => filePath.startsWith(prefix));

export const docPortalMountRoot = docPortalPrefixes[0]?.slice(0, -1) ?? null;

export const isDocPortalMountAvailable = () =>
  docPortalMountRoot !== null && fs.existsSync(docPortalMountRoot);
