import { promises as fs } from "node:fs";
import path from "node:path";

import type { EmulatorSaveLocationStatus } from "@types";

import {
  shadps4DefaultUserDir,
  shadps4PortableUserDir,
} from "../emulators/shadps4-files.js";

export interface Shadps4SaveLocation {
  dataDir: string;
  homeRoot: string;
}

const isDirectory = async (target: string) =>
  (await fs.stat(target).catch(() => null))?.isDirectory() ?? false;

const readHomeDir = (configContent: string): string | null | undefined => {
  let config: unknown;
  try {
    config = JSON.parse(configContent);
  } catch {
    return undefined;
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return undefined;
  }
  const general = (config as Record<string, unknown>)["General"];
  if (general === undefined) return null;
  if (!general || typeof general !== "object" || Array.isArray(general)) {
    return undefined;
  }
  const homeDir = (general as Record<string, unknown>)["home_dir"];
  if (homeDir === undefined || homeDir === "") return null;
  return typeof homeDir === "string" ? homeDir : undefined;
};

export const validateShadps4DataDir = async (
  dir: string,
  workingDir?: string
): Promise<Shadps4SaveLocation | null> => {
  if (!path.isAbsolute(dir)) return null;
  try {
    const dataDir = await fs.realpath(dir);
    if (!(await isDirectory(dataDir))) return null;
    const configContent = await fs
      .readFile(path.join(dataDir, "config.json"), "utf8")
      .catch(() => null);
    if (configContent === null) return null;
    const homeDir = readHomeDir(configContent);
    if (homeDir === undefined) return null;
    if (homeDir !== null && !path.isAbsolute(homeDir) && !workingDir) {
      return null;
    }
    const homeRoot = await fs.realpath(
      homeDir === null
        ? path.join(dataDir, "home")
        : path.resolve(workingDir ?? dataDir, homeDir)
    );
    if (!(await isDirectory(homeRoot))) return null;
    return { dataDir, homeRoot };
  } catch {
    return null;
  }
};

export const shadps4DataDirCandidates = (executablePath: string | null) => [
  ...(executablePath ? [shadps4PortableUserDir(executablePath)] : []),
  shadps4DefaultUserDir(),
];

const pathKey = (value: string) =>
  process.platform === "win32" ? value.toLowerCase() : value;

export const resolveShadps4DataDirStatus = async (
  executablePath: string | null,
  selectedDir: string | null | undefined,
  candidateDirs = shadps4DataDirCandidates(executablePath)
): Promise<{
  status: EmulatorSaveLocationStatus;
  location: Shadps4SaveLocation | null;
}> => {
  const base = {
    selectedRoot: selectedDir ?? null,
    resolvedRoot: null,
    candidates: [] as string[],
  };
  if (!executablePath || !(await fs.stat(executablePath).catch(() => null))) {
    return { status: { ...base, status: "not-configured" }, location: null };
  }
  const workingDir = path.dirname(executablePath);

  const checked = await Promise.all(
    candidateDirs.map((dir) =>
      validateShadps4DataDir(path.resolve(dir), workingDir)
    )
  );
  const locations = [
    ...new Map(
      checked
        .filter((location): location is Shadps4SaveLocation => !!location)
        .map((location) => [pathKey(location.dataDir), location] as const)
    ).values(),
  ];
  const candidates = locations.map((location) => location.dataDir);

  if (selectedDir) {
    const selected = await validateShadps4DataDir(selectedDir, workingDir);
    return selected
      ? {
          status: {
            ...base,
            status: "ready",
            candidates,
            resolvedRoot: selected.dataDir,
          },
          location: selected,
        }
      : {
          status: { ...base, status: "invalid-selection", candidates },
          location: null,
        };
  }

  const portableDir = shadps4PortableUserDir(executablePath);
  const automaticDir = (await isDirectory(portableDir))
    ? portableDir
    : shadps4DefaultUserDir();
  const location = await validateShadps4DataDir(automaticDir, workingDir);
  return {
    status: {
      ...base,
      status: location ? "ready" : "missing",
      candidates,
      resolvedRoot: location?.dataDir ?? null,
    },
    location,
  };
};
