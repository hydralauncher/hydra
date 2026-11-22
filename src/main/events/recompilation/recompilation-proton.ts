import path from "node:path";

import type { UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { Umu } from "@main/services/umu";
import { Wine } from "@main/services/wine";

export type PortPlatform = "win32" | "linux" | "darwin";

const protonPorts = new Set<string>();

/** A Windows build installed on Linux runs through Proton. */
export const runsThroughProton = (executablePath: string | null | undefined) =>
  process.platform === "linux" &&
  typeof executablePath === "string" &&
  executablePath.toLowerCase().endsWith(".exe");

export const rememberPortRuntime = (
  slug: string,
  executablePath: string | null | undefined
) => {
  if (runsThroughProton(executablePath)) protonPorts.add(slug);
  else protonPorts.delete(slug);
};

export const isProtonPort = (slug: string) => protonPorts.has(slug);

/** The OS the port's build was made for, which picks its paths and files. */
export const getPortPlatform = (slug: string): PortPlatform =>
  protonPorts.has(slug) ? "win32" : (process.platform as PortPlatform);

export const getPortWinePrefix = (slug: string) =>
  Wine.getEffectivePrefixPath(null, `recompilation-${slug}`);

export const getPortProtonPath = async () => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  const protonPath = userPreferences?.defaultProtonPath;
  return protonPath && Umu.isValidProtonPath(protonPath) ? protonPath : null;
};

/** How a program running in Wine sees a Linux path. */
export const toWinePath = (hostPath: string) =>
  `Z:${hostPath.replaceAll("/", "\\")}`;

/** The Windows user folders inside the port's Wine prefix. */
export const getPrefixFolders = (winePrefix: string) => {
  const profile =
    Wine.getPrefixUserProfile(winePrefix)?.path ??
    path.join(winePrefix, "drive_c", "users", "steamuser");
  return {
    home: profile,
    winAppData: path.join(profile, "AppData", "Roaming"),
    winLocalAppData: path.join(profile, "AppData", "Local"),
  };
};
