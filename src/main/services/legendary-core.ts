import {
  execFile,
  type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VERSION_CHECK_TIMEOUT_MS = 15_000;
const VERSION_CHECK_MAX_BUFFER_BYTES = 16 * 1024;

export interface LegendaryEnvironment {
  platform: string;
  arch: string;
  isPackaged: boolean;
  developmentRoot: string;
  resourcesPath: string;
}

export type LegendaryAvailability =
  | { available: true; binaryPath: string; version: string }
  | {
      available: false;
      reason:
        | "unsupported-platform"
        | "unsupported-architecture"
        | "missing"
        | "execution-failed"
        | "version-mismatch";
      binaryPath?: string;
      version?: string;
    };

interface LegendaryDependencies {
  isFile: (binaryPath: string) => Promise<boolean>;
  execFile: (
    binaryPath: string,
    args: string[],
    options: ExecFileOptionsWithStringEncoding,
    callback: (error: Error | null, stdout: string) => void
  ) => void;
}

const defaultDependencies: LegendaryDependencies = {
  isFile: async (binaryPath) => {
    try {
      return (await fs.promises.stat(binaryPath)).isFile();
    } catch {
      return false;
    }
  },
  execFile: (binaryPath, args, options, callback) => {
    execFile(binaryPath, args, options, callback);
  },
};

export const resolveLegendaryBinaryPath = (
  environment: LegendaryEnvironment
): string | null => {
  const { platform, arch, isPackaged, developmentRoot, resourcesPath } =
    environment;

  if (platform !== "win32" && platform !== "darwin") return null;
  if (arch !== "x64" && arch !== "arm64") return null;

  const paths = platform === "win32" ? path.win32 : path.posix;
  const binaryName = platform === "win32" ? "legendary.exe" : "legendary";

  return isPackaged
    ? paths.join(resourcesPath, "legendary", binaryName)
    : paths.join(developmentRoot, "legendary", platform, arch, binaryName);
};

/** Runs only when explicitly requested. Packaged executables may be signed, so
 * integrity against the upstream hash is checked during preparation, not here.
 */
export const getLegendaryAvailability = async (
  environment: LegendaryEnvironment,
  expectedVersion: string,
  overrides: Partial<LegendaryDependencies> = {}
): Promise<LegendaryAvailability> => {
  if (environment.platform !== "win32" && environment.platform !== "darwin") {
    return { available: false, reason: "unsupported-platform" };
  }

  const binaryPath = resolveLegendaryBinaryPath(environment);
  if (!binaryPath) {
    return { available: false, reason: "unsupported-architecture" };
  }

  const dependencies = { ...defaultDependencies, ...overrides };
  try {
    if (!(await dependencies.isFile(binaryPath))) {
      return { available: false, reason: "missing", binaryPath };
    }
  } catch {
    return { available: false, reason: "missing", binaryPath };
  }

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      dependencies.execFile(
        binaryPath,
        ["--version"],
        {
          shell: false,
          timeout: VERSION_CHECK_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: VERSION_CHECK_MAX_BUFFER_BYTES,
          encoding: "utf8",
        },
        (error, output) => (error ? reject(error) : resolve(output))
      );
    });

    const version = /^legendary version "([^"]+)", codename "[^"]*"\s*$/.exec(
      stdout.trim()
    )?.[1];

    if (version !== expectedVersion) {
      return {
        available: false,
        reason: "version-mismatch",
        binaryPath,
        version,
      };
    }

    return { available: true, binaryPath, version };
  } catch {
    return { available: false, reason: "execution-failed", binaryPath };
  }
};
