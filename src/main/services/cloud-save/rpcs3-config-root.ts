import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

import type { Rpcs3ConfigRootStatus } from "@types";

import { rpcs3ConfigRoots } from "../emulators/emulator-config.js";
import {
  parseRpcs3ActiveProfileId,
  resolveRpcs3VfsHdd0,
} from "./rpcs3-save-layout.js";

export interface Rpcs3SaveLocation {
  configRoot: string;
  homeRoot: string;
  activeProfileId: string;
}

const readOptional = async (file: string) =>
  fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

export const validateRpcs3ConfigRoot = async (
  root: string
): Promise<Rpcs3SaveLocation | null> => {
  if (!path.isAbsolute(root)) return null;
  try {
    const configRoot = await fs.realpath(root);
    if (!(await fs.stat(configRoot)).isDirectory()) return null;
    const [config, settingsContent, vfsContent] = await Promise.all([
      readOptional(path.join(configRoot, "config.yml")),
      readOptional(
        path.join(configRoot, "GuiConfigs", "persistent_settings.dat")
      ),
      readOptional(path.join(configRoot, "vfs.yml")),
    ]);
    if (config === null && settingsContent === null && vfsContent === null)
      return null;
    if (config !== null && YAML.parseDocument(config).errors.length > 0)
      return null;
    const hdd0 = resolveRpcs3VfsHdd0(configRoot, vfsContent);
    const realHdd0 = await fs.realpath(hdd0);
    if (!(await fs.stat(realHdd0)).isDirectory()) return null;
    const activeProfileId = parseRpcs3ActiveProfileId(settingsContent);
    if (!activeProfileId) return null;
    return {
      configRoot,
      homeRoot: path.join(realHdd0, "home"),
      activeProfileId,
    };
  } catch {
    return null;
  }
};

export const resolveRpcs3ConfigRootStatus = async (
  executablePath: string | null,
  selectedRoot: string | null | undefined,
  roots = rpcs3ConfigRoots(executablePath)
): Promise<{
  status: Rpcs3ConfigRootStatus;
  location: Rpcs3SaveLocation | null;
}> => {
  const base = {
    selectedRoot: selectedRoot ?? null,
    resolvedRoot: null,
    candidates: [] as string[],
  };
  if (!executablePath || !(await fs.stat(executablePath).catch(() => null))) {
    return { status: { ...base, status: "not-configured" }, location: null };
  }

  const checked = await Promise.all(
    [...new Set(roots.map((root) => path.resolve(root)))].map((root) =>
      validateRpcs3ConfigRoot(root)
    )
  );
  const locations = [
    ...new Map(
      checked
        .filter((location): location is Rpcs3SaveLocation => !!location)
        .map(
          (location) =>
            [
              process.platform === "win32"
                ? location.configRoot.toLowerCase()
                : location.configRoot,
              location,
            ] as const
        )
    ).values(),
  ];
  const candidates = locations.map((location) => location.configRoot);

  if (selectedRoot) {
    const selected = await validateRpcs3ConfigRoot(selectedRoot);
    if (!selected) {
      return {
        status: { ...base, status: "invalid-selection", candidates },
        location: null,
      };
    }
    return {
      status: {
        ...base,
        status: "ready",
        candidates,
        resolvedRoot: selected.configRoot,
      },
      location: selected,
    };
  }

  const location = locations.length === 1 ? locations[0] : null;
  return {
    status: {
      ...base,
      status: location ? "ready" : locations.length ? "ambiguous" : "missing",
      candidates,
      resolvedRoot: location?.configRoot ?? null,
    },
    location,
  };
};
