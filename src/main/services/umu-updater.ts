import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import axios from "axios";
import * as tar from "tar";
import { SystemPath } from "./system-path";
import { logger } from "./logger";
import {
  BUNDLED_UMU_VERSION,
  compareUmuVersions,
  parseUmuRelease,
} from "./umu-release";
import {
  isUmuUpdateCheckDue,
  parseUmuUpdateState,
  recordUmuUpdateFailure,
  recordUmuUpdateSuccess,
  type UmuUpdateState,
} from "./umu-update-schedule";

const UMU_RELEASE_API_URL =
  "https://api.github.com/repos/Open-Wine-Components/umu-launcher/releases/latest";
const UMU_RELEASE_REQUEST_TIMEOUT_MS = 15_000;
const UMU_DOWNLOAD_TIMEOUT_MS = 120_000;
const UMU_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const UMU_ZIPAPP_ENTRY = "umu/umu-run";

const getManagedUmuDirectory = () =>
  path.join(SystemPath.getPath("userData"), "umu");

const getStatePath = () => path.join(getManagedUmuDirectory(), "state.json");

const getVersionBinaryPath = (version: string) =>
  path.join(getManagedUmuDirectory(), version, "umu-run");

const readState = (): UmuUpdateState | null => {
  try {
    return parseUmuUpdateState(
      JSON.parse(fs.readFileSync(getStatePath(), "utf8"))
    );
  } catch {
    return null;
  }
};

const writeState = async (state: UmuUpdateState) => {
  await fs.promises.mkdir(getManagedUmuDirectory(), { recursive: true });
  const temporaryPath = `${getStatePath()}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(temporaryPath, JSON.stringify(state));
  await fs.promises.rename(temporaryPath, getStatePath());
};

const isUsableBinary = (binaryPath: string) => {
  try {
    const stat = fs.statSync(binaryPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
};

const getInstalledManagedVersion = (state: UmuUpdateState | null) => {
  if (!state?.version) return null;
  if (compareUmuVersions(state.version, BUNDLED_UMU_VERSION) <= 0) return null;
  return isUsableBinary(getVersionBinaryPath(state.version))
    ? state.version
    : null;
};

const removeStaleVersions = async (keptVersions: Set<string>) => {
  const entries = await fs.promises
    .readdir(getManagedUmuDirectory(), { withFileTypes: true })
    .catch(() => [] as fs.Dirent[]);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !keptVersions.has(entry.name))
      .map((entry) =>
        fs.promises
          .rm(path.join(getManagedUmuDirectory(), entry.name), {
            recursive: true,
            force: true,
          })
          .catch(() => undefined)
      )
  );
};

const installRelease = async (
  version: string,
  downloadUrl: string,
  sha256: string
) => {
  const response = await axios.get<ArrayBuffer>(downloadUrl, {
    responseType: "arraybuffer",
    timeout: UMU_DOWNLOAD_TIMEOUT_MS,
    maxContentLength: UMU_MAX_DOWNLOAD_BYTES,
  });
  const archive = Buffer.from(response.data);
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== sha256) {
    throw new Error(`umu ${version} archive digest mismatch`);
  }

  const workingDirectory = path.join(
    getManagedUmuDirectory(),
    `.download-${randomUUID()}`
  );
  await fs.promises.mkdir(workingDirectory, { recursive: true });

  try {
    const archivePath = path.join(workingDirectory, "umu.tar");
    await fs.promises.writeFile(archivePath, archive);
    await tar.x({
      file: archivePath,
      cwd: workingDirectory,
      filter: (entryPath) => entryPath === UMU_ZIPAPP_ENTRY,
    });

    const extractedBinary = path.join(workingDirectory, UMU_ZIPAPP_ENTRY);
    if (!isUsableBinary(extractedBinary)) {
      throw new Error(`umu ${version} archive is missing ${UMU_ZIPAPP_ENTRY}`);
    }

    const versionDirectory = path.dirname(getVersionBinaryPath(version));
    await fs.promises.rm(versionDirectory, { recursive: true, force: true });
    await fs.promises.mkdir(versionDirectory, { recursive: true });
    await fs.promises.rename(extractedBinary, getVersionBinaryPath(version));
    await fs.promises.chmod(getVersionBinaryPath(version), 0o700);
  } finally {
    await fs.promises
      .rm(workingDirectory, { recursive: true, force: true })
      .catch(() => undefined);
  }
};

export class UmuUpdater {
  private static updatePromise: Promise<void> | null = null;

  public static getManagedBinaryPath(): string | null {
    if (process.platform !== "linux") return null;
    const version = getInstalledManagedVersion(readState());
    return version ? getVersionBinaryPath(version) : null;
  }

  public static checkForUpdates(): Promise<void> {
    if (process.platform !== "linux") return Promise.resolve();
    this.updatePromise ??= this.runUpdateCheck().finally(() => {
      this.updatePromise = null;
    });
    return this.updatePromise;
  }

  private static async runUpdateCheck() {
    const state = readState();
    if (!isUmuUpdateCheckDue(state, Date.now())) return;

    const installedVersion = getInstalledManagedVersion(state);
    const currentVersion = installedVersion ?? BUNDLED_UMU_VERSION;

    try {
      const response = await axios.get(UMU_RELEASE_API_URL, {
        timeout: UMU_RELEASE_REQUEST_TIMEOUT_MS,
        headers: { Accept: "application/vnd.github+json" },
      });
      const release = parseUmuRelease(response.data);

      if (
        !release ||
        compareUmuVersions(release.version, currentVersion) <= 0
      ) {
        await writeState(recordUmuUpdateSuccess(installedVersion, Date.now()));
        return;
      }

      logger.info("Updating umu-launcher", {
        from: currentVersion,
        to: release.version,
      });
      await installRelease(
        release.version,
        release.downloadUrl,
        release.sha256
      );
      await writeState(recordUmuUpdateSuccess(release.version, Date.now()));
      await removeStaleVersions(
        new Set([release.version, installedVersion ?? release.version])
      );
      logger.info("umu-launcher updated", { version: release.version });
    } catch (error) {
      const failedState = recordUmuUpdateFailure(
        state,
        installedVersion,
        Date.now()
      );
      logger.warn("Failed to update umu-launcher", {
        currentVersion,
        failureCount: failedState.failureCount,
        retryAt: new Date(failedState.retryAt ?? Date.now()).toISOString(),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await writeState(failedState).catch(() => undefined);
    }
  }
}
