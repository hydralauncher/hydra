import fs from "node:fs";

export const isFlatpak =
  process.platform === "linux" &&
  (!!process.env.FLATPAK_ID || fs.existsSync("/.flatpak-info"));

const docPortalPrefixes =
  process.platform === "linux"
    ? [`/run/user/${process.getuid?.() ?? 1000}/doc/`, "/run/flatpak/doc/"]
    : [];

export const isDocPortalPath = (filePath: string) =>
  docPortalPrefixes.some((prefix) => filePath.startsWith(prefix));

export const docPortalMountRoot = docPortalPrefixes[0]?.slice(0, -1) ?? null;

export const isDocPortalMountAvailable = () =>
  docPortalMountRoot !== null && fs.existsSync(docPortalMountRoot);
