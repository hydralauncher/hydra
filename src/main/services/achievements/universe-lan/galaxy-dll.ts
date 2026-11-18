import path from "node:path";
import fs from "node:fs";

import { readDirectorySafe } from "../game-directory.js";
import { readPeVersionInfo } from "./pe-version.js";

export const GOG_GALAXY_PRODUCT_NAME = "GOG Galaxy";
export const UNIVERSE_LAN_PRODUCT_NAME = "UniverseLAN Client";

const GALAXY_DLL_ARCHITECTURES = {
  "galaxy64.dll": "x64",
  "galaxy.dll": "x86",
} as const;

export type GalaxyDllArchitecture =
  (typeof GALAXY_DLL_ARCHITECTURES)[keyof typeof GALAXY_DLL_ARCHITECTURES];

export type GalaxyDllKind = "gog" | "universe-lan" | "unknown";

export interface GalaxyDll {
  filePath: string;
  architecture: GalaxyDllArchitecture;
  kind: GalaxyDllKind;
  /** Galaxy SDK version as used by UniverseLAN release names, e.g. 1.148.3 */
  sdkVersion: string | null;
}

/** The fourth version component is always 0 for the Galaxy SDK. */
export const toSdkVersion = (fileVersion: string | null) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(fileVersion ?? "");

  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
};

const classifyProductName = (productName: string | null): GalaxyDllKind => {
  if (productName === GOG_GALAXY_PRODUCT_NAME) return "gog";
  if (productName === UNIVERSE_LAN_PRODUCT_NAME) return "universe-lan";
  return "unknown";
};

export const inspectGalaxyDll = async (
  filePath: string,
  architecture: GalaxyDllArchitecture
): Promise<GalaxyDll> => {
  const { fileVersion, productName } = readPeVersionInfo(
    await fs.promises.readFile(filePath)
  );

  return {
    filePath,
    architecture,
    kind: classifyProductName(productName),
    sdkVersion: toSdkVersion(fileVersion),
  };
};

export const findGalaxyDlls = async (directories: string[]) => {
  // Keyed by lower-cased path so the same DLL reached through two base
  // directories is only inspected once (Windows paths are case-insensitive).
  const candidates = new Map<
    string,
    { filePath: string; architecture: GalaxyDllArchitecture }
  >();

  await Promise.all(
    directories.map(async (directory) => {
      for (const entry of (await readDirectorySafe(directory)) ?? []) {
        if (!entry.isFile()) continue;

        const architecture =
          GALAXY_DLL_ARCHITECTURES[
            entry.name.toLowerCase() as keyof typeof GALAXY_DLL_ARCHITECTURES
          ];

        if (!architecture) continue;

        const filePath = path.resolve(directory, entry.name);
        candidates.set(filePath.toLowerCase(), { filePath, architecture });
      }
    })
  );

  const dlls = await Promise.all(
    [...candidates.values()].map(({ filePath, architecture }) =>
      inspectGalaxyDll(filePath, architecture).catch(() => null)
    )
  );

  return dlls
    .filter((dll): dll is GalaxyDll => dll !== null)
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
};
