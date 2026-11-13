import { shell } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  isRecompilationAssetFromRepository,
  pickRecompilationInstallAsset,
} from "@shared";
import type {
  RecompilationActionResult,
  RecompilationDetails,
  RecompilationInstallProgress,
  RecompilationInstallState,
  RecompilationPrepareProgress,
  RecompilationRef,
  RecompilationReleases,
} from "@types";
import {
  HydraApi,
  logger,
  SevenZip,
  SystemPath,
  WindowManager,
} from "@main/services";
import {
  downloadToFile,
  removeFileQuietly,
} from "@main/services/download-to-file";
import {
  forgetRecompilationInstallDirectory,
  getRecompilationInstallDirectory as getInstallDirectory,
  isRecompilationFolderMissing,
  INSTALL_MARKER_FILE,
  type InstallMarker,
  parseRecompilationRef as parseRef,
  isLinkedInstall,
  listDefaultRecompilationParents,
  readInstallMarker,
  saveRecompilationInstallDirectory,
} from "./recompilation-paths";
import { recompilationInstallsSublevel } from "@main/level";
import {
  getRecompilationExecutableOverride,
  RECOMPILATION_EXTRACTED_ROM_FOLDER,
  RECOMPILATION_ROM_CHOICE_FILE,
  markRecompilationRomLaunched,
  prepareRecompilationRom,
  shouldHideRecompilationConsole,
  shouldPrepareAfterUpdate,
} from "./recompilation-rom";
import recompilationSaves from "./recompilation-saves.json";
import {
  addRecompilationDisc,
  linkInstalledRecompilation,
  removeRecompilationDisc,
  waitForRecompilationLink,
} from "./recompilation-disc";
import {
  getPortPlatform,
  getPortProtonPath,
  getPortWinePrefix,
  runsThroughProton,
  type PortPlatform,
} from "./recompilation-proton";
import {
  findDeclaredRecompilationEntry,
  findRecompilationExecutable,
  isBareReleaseExecutable,
  isNestedReleaseArchive,
  restoreExecutableBits,
} from "./recompilation-executable";
import {
  checkPickedFolder,
  identifyFolderVersion,
  resolvePickedFolder,
  warmFolderCheck,
} from "./recompilation-folder-check";

const MAX_NESTED_ARCHIVES = 3;

class RecompilationInstallError extends Error {}

const installsInProgress = new Set<string>();
const launchesInProgress = new Set<string>();
const preparesInProgress = new Set<string>();

export const isRecompilationBusy = (slug: string) =>
  installsInProgress.has(slug) ||
  launchesInProgress.has(slug) ||
  preparesInProgress.has(slug) ||
  uninstallsInProgress.has(slug);

const lastProgress = new Map<string, RecompilationInstallProgress>();
const versionRechecks = new Set<string>();
const versionsBeingIdentified = new Set<string>();

/**
 * Finds which release a linked folder holds, after it is linked so the user
 * doesn't wait for it. Its version is kept when found.
 */
const identifyLinkedVersion = async (
  ref: RecompilationRef,
  installDirectory: string,
  executablePath: string
) => {
  if (versionsBeingIdentified.has(ref.slug)) return;
  versionsBeingIdentified.add(ref.slug);
  sendProgress({ slug: ref.slug, phase: "identifying", loaded: 0, total: 1 });
  try {
    const version = await identifyFolderVersion(
      ref,
      executablePath,
      runsThroughProton(executablePath)
        ? "win32"
        : (process.platform as PortPlatform),
      (loaded, total) =>
        sendProgress({ slug: ref.slug, phase: "identifying", loaded, total })
    );
    if (!version) return;
    const current = await readInstallMarker(installDirectory);
    if (current?.slug !== ref.slug || current.version) return;
    await fs.promises.writeFile(
      path.join(installDirectory, INSTALL_MARKER_FILE),
      JSON.stringify({ ...current, version, verified: true }, null, 2)
    );
  } finally {
    versionsBeingIdentified.delete(ref.slug);
    sendProgress({ slug: ref.slug, phase: "changed" });
  }
};

/** A release Hydra hadn't listed yet may be known now: looked up once a session. */
const recheckLinkedVersion = (
  ref: RecompilationRef,
  installDirectory: string,
  marker: InstallMarker
) => {
  if (!marker.executablePath || versionRechecks.has(ref.slug)) return;
  versionRechecks.add(ref.slug);
  void identifyLinkedVersion(ref, installDirectory, marker.executablePath);
};
const uninstallsInProgress = new Set<string>();

const sendProgress = (progress: RecompilationInstallProgress) => {
  if (
    progress.phase === "downloading" ||
    progress.phase === "extracting" ||
    progress.phase === "uninstalling" ||
    progress.phase === "identifying"
  ) {
    lastProgress.set(progress.slug, progress);
  } else {
    lastProgress.delete(progress.slug);
  }
  WindowManager.mainWindow?.webContents.send(
    "on-recompilation-install-progress",
    progress
  );
};

const sendPrepareProgress = (progress: RecompilationPrepareProgress) => {
  if (progress.phase === "running") preparesInProgress.add(progress.slug);
  else preparesInProgress.delete(progress.slug);

  WindowManager.mainWindow?.webContents.send(
    "on-recompilation-prepare-progress",
    progress
  );
};

const apiPath = ({ objectId, slug }: RecompilationRef) =>
  `/games/launchbox/${objectId}/recompilations/${slug}`;

const loadSession = () => import("./recompilation-session");

const hashFile = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

const isExecutableInUse = async (executablePath: string | null) => {
  if (!executablePath) return false;
  try {
    const handle = await fs.promises.open(executablePath, "r+");
    await handle.close();
    return false;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    return code === "EBUSY" || code === "ETXTBSY";
  }
};

const isPortRunning = async (
  ref: RecompilationRef,
  executablePath: string | null
) => {
  if (launchesInProgress.has(ref.slug)) return true;
  const { isRecompilationRunning } = await loadSession();
  return isRecompilationRunning(ref) || isExecutableInUse(executablePath);
};

const getSingleEntry = async (directory: string) => {
  const entries = await fs.promises.readdir(directory, {
    withFileTypes: true,
  });
  return entries.length === 1 ? entries[0] : null;
};

const refreshDeclaredEntry = async (
  slug: string,
  installDirectory: string,
  executablePath: string
) => {
  const declared = await findDeclaredRecompilationEntry(
    installDirectory,
    getRecompilationExecutableOverride(slug),
    getPortPlatform(slug)
  ).catch(() => null);
  if (!declared || declared === executablePath) return executablePath;

  const marker = await readInstallMarker(installDirectory);
  if (marker) {
    await fs.promises.writeFile(
      path.join(installDirectory, INSTALL_MARKER_FILE),
      JSON.stringify({ ...marker, executablePath: declared }, null, 2)
    );
  }
  return declared;
};

const extractNestedArchives = async (stagingDirectory: string) => {
  for (let layer = 0; layer < MAX_NESTED_ARCHIVES; layer++) {
    const entry = await getSingleEntry(stagingDirectory);
    if (!entry?.isFile() || !isNestedReleaseArchive(entry.name)) return;

    const archivePath = path.join(stagingDirectory, entry.name);
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: stagingDirectory,
    });
    await fs.promises.rm(archivePath, { force: true });
  }
};

const resolveExtractedRoot = async (stagingDirectory: string) => {
  const entry = await getSingleEntry(stagingDirectory);
  return entry?.isDirectory()
    ? path.join(stagingDirectory, entry.name)
    : stagingDirectory;
};

const APPIMAGE_EXTRACT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Some AppImages (Nix-built ones like bbport's) hold a compressed stream before
 * the image that 7-Zip opens instead, and symlinks 7-Zip refuses. The
 * AppImage's own extractor handles both; it lands in `squashfs-root`.
 */
const extractAppImageWithItself = (
  appImagePath: string,
  stagingDirectory: string
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(appImagePath, ["--appimage-extract"], {
      cwd: stagingDirectory,
      env: getPortEnv({}),
      stdio: "ignore",
      shell: false,
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("--appimage-extract timed out"));
    }, APPIMAGE_EXTRACT_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`--appimage-extract exited with ${code}`));
    });
  });

const extractReleaseArchive = async (
  archivePath: string,
  assetName: string,
  stagingDirectory: string,
  onProgress?: (percent: number) => void
) => {
  try {
    await SevenZip.extractFile(
      {
        filePath: archivePath,
        outputPath: stagingDirectory,
      },
      onProgress ? ({ percent }) => onProgress(percent) : undefined
    );
  } catch (error) {
    const isAppImage = assetName.toLowerCase().endsWith(".appimage");
    if (process.platform !== "linux" || !isAppImage) throw error;

    logger.warn(`7-Zip could not open ${assetName}, using its own extractor`);
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
    await fs.promises.mkdir(stagingDirectory, { recursive: true });
    // Only this user runs the downloaded AppImage, once, to unpack it.
    await fs.promises.chmod(archivePath, 0o700);
    await extractAppImageWithItself(archivePath, stagingDirectory);
  }
};

const listReleaseFiles = async (root: string) => {
  const entries = await fs.promises.readdir(root, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) =>
      path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
};

const extractRelease = async (
  archivePath: string,
  assetName: string,
  installDirectory: string,
  portName: string,
  executableOverride: string | null,
  buildPlatform: PortPlatform,
  onProgress?: (percent: number) => void
) => {
  const stagingDirectory = `${installDirectory}.partial`;
  await fs.promises.rm(stagingDirectory, { recursive: true, force: true });

  try {
    if (isBareReleaseExecutable(assetName, executableOverride)) {
      await fs.promises.mkdir(stagingDirectory, { recursive: true });
      await fs.promises.copyFile(
        archivePath,
        path.join(stagingDirectory, path.basename(assetName))
      );
    } else {
      await extractReleaseArchive(
        archivePath,
        assetName,
        stagingDirectory,
        onProgress
      );
    }
    await extractNestedArchives(stagingDirectory);
    const root = await resolveExtractedRoot(stagingDirectory);
    await restoreExecutableBits(root);
    const executablePath = await findRecompilationExecutable(
      root,
      portName,
      executableOverride,
      buildPlatform
    );
    if (!executablePath) throw new RecompilationInstallError("no_executable");
    const files = await listReleaseFiles(root);
    await fs.promises.mkdir(installDirectory, { recursive: true });
    await fs.promises.cp(root, installDirectory, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    return {
      executablePath: path.join(
        installDirectory,
        path.relative(root, executablePath)
      ),
      files,
    };
  } finally {
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
  }
};

export const getRecompilationInstallState = async (
  rawRef: unknown
): Promise<RecompilationInstallState | null> => {
  const ref = parseRef(rawRef);
  if (!ref) return null;

  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(installDirectory);
  const installed = marker?.slug === ref.slug;
  if (installed && !installsInProgress.has(ref.slug)) {
    void linkInstalledRecompilation(ref.slug, installDirectory, marker);
    if (isLinkedInstall(marker) && !marker.version) {
      recheckLinkedVersion(ref, installDirectory, marker);
    }
  }

  return {
    installed,
    isInstalling: installsInProgress.has(ref.slug),
    isPreparing: preparesInProgress.has(ref.slug),
    version: installed ? marker.version : null,
    installPath: installed ? installDirectory : null,
    installParentPath: path.dirname(installDirectory),
    executablePath: installed ? marker.executablePath : null,
    hasCloudSaves: Object.hasOwn(recompilationSaves, ref.slug),
    progress: lastProgress.get(ref.slug) ?? null,
    linked: installed && isLinkedInstall(marker),
    verified:
      installed && (marker.verified === true || Boolean(marker.version)),
    isIdentifyingVersion: versionsBeingIdentified.has(ref.slug),
    installedFileCount: installed ? (marker.installedFiles?.length ?? 0) : 0,
  };
};

const resolveTargetDirectory = async (
  ref: RecompilationRef,
  rawParentDirectory: unknown,
  isInstalled: boolean
) => {
  if (
    isInstalled ||
    typeof rawParentDirectory !== "string" ||
    !path.isAbsolute(rawParentDirectory)
  ) {
    return getInstallDirectory(ref.slug);
  }

  try {
    await fs.promises.mkdir(rawParentDirectory, { recursive: true });
    await fs.promises.access(rawParentDirectory, fs.constants.W_OK);
  } catch {
    throw new RecompilationInstallError("install_folder_unwritable");
  }
  return path.join(rawParentDirectory, ref.slug);
};

const fetchRelease = async (ref: RecompilationRef) => {
  const [details, { releases }] = await Promise.all([
    HydraApi.get<RecompilationDetails>(apiPath(ref), undefined, {
      needsAuth: false,
    }),
    HydraApi.get<RecompilationReleases>(`${apiPath(ref)}/releases`, undefined, {
      needsAuth: false,
    }),
  ]);
  const release =
    releases.find((item) => item.isLatest) ?? releases.at(0) ?? null;
  const asset = release
    ? pickRecompilationInstallAsset(release.assets, process.platform)
    : null;

  if (
    !release ||
    !asset ||
    !isRecompilationAssetFromRepository(
      asset,
      details.repository.fullName,
      release.tag
    )
  ) {
    throw new RecompilationInstallError("no_release_file");
  }

  return { details, release, asset };
};

const downloadAndInstall = async (
  ref: RecompilationRef,
  installDirectory: string,
  onArchivePath: (archivePath: string) => void
) => {
  const { details, release, asset } = await fetchRelease(ref);
  const buildPlatform: PortPlatform =
    asset.os === "windows" ? "win32" : (process.platform as PortPlatform);
  const archivePath = path.join(
    SystemPath.getPath("temp"),
    `hydra-recompilation-${ref.slug}-${path.basename(asset.name)}`
  );
  onArchivePath(archivePath);

  sendProgress({
    slug: ref.slug,
    phase: "downloading",
    loaded: 0,
    total: asset.size,
  });

  await downloadToFile(asset.url, archivePath, (loaded, total) => {
    sendProgress({
      slug: ref.slug,
      phase: "downloading",
      loaded,
      total: total ?? asset.size,
    });
  });

  const { size } = await fs.promises.stat(archivePath);
  if (size !== asset.size) {
    throw new Error(`Unexpected size for ${asset.name}: ${size}`);
  }
  if (asset.sha256 && (await hashFile(archivePath)) !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.name}`);
  }

  sendProgress({ slug: ref.slug, phase: "extracting", loaded: 0, total: 100 });
  let lastPercent = 0;
  const previousMarker = await readInstallMarker(installDirectory);
  const { executablePath, files } = await extractRelease(
    archivePath,
    asset.name,
    installDirectory,
    details.name,
    getRecompilationExecutableOverride(ref.slug, buildPlatform),
    buildPlatform,
    (percent) => {
      const rounded = Math.min(100, Math.max(0, Math.floor(percent)));
      if (rounded <= lastPercent) return;
      lastPercent = rounded;
      sendProgress({
        slug: ref.slug,
        phase: "extracting",
        loaded: rounded,
        total: 100,
      });
    }
  );

  const linked = isLinkedInstall(previousMarker);
  const marker: InstallMarker = {
    slug: ref.slug,
    objectId: ref.objectId,
    version: release.version,
    assetName: asset.name,
    executablePath,
    installedAt: new Date().toISOString(),
    name: details.name,
    iconUrl: details.iconUrl,
    ...(linked
      ? {
          linked: true,
          installedFiles: [
            ...new Set([...(previousMarker?.installedFiles ?? []), ...files]),
          ],
        }
      : {}),
  };
  await fs.promises.writeFile(
    path.join(installDirectory, INSTALL_MARKER_FILE),
    JSON.stringify(marker, null, 2)
  );
  await saveRecompilationInstallDirectory(ref.slug, installDirectory);
  await addRecompilationDisc(ref, installDirectory, {
    name: details.name,
    iconUrl: details.iconUrl,
  });
};

export const installRecompilation = async (
  rawRef: unknown,
  rawParentDirectory?: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  installsInProgress.add(ref.slug);

  let archivePath = null as string | null;
  let installDirectory = null as string | null;
  let preparing = false;
  let result: RecompilationActionResult;

  try {
    const current = await getRecompilationInstallState(ref);
    if (await isPortRunning(ref, current?.executablePath ?? null)) {
      return { ok: false, reason: "running" };
    }

    installDirectory = await resolveTargetDirectory(
      ref,
      rawParentDirectory,
      current?.installed === true
    );
    await downloadAndInstall(ref, installDirectory, (downloadPath) => {
      archivePath = downloadPath;
    });
    result = { ok: true };
    preparing = await shouldPrepareAfterUpdate(ref).catch(() => false);
  } catch (error) {
    logger.error(`Failed to install recompilation ${ref.slug}`, error);
    result = {
      ok: false,
      reason:
        error instanceof RecompilationInstallError
          ? error.message
          : "install_failed",
    };
  } finally {
    if (archivePath) await removeFileQuietly(archivePath);
    // Hands the port straight to the preparation, so Play can't start in between.
    if (preparing) launchesInProgress.add(ref.slug);
    installsInProgress.delete(ref.slug);
  }

  sendProgress(
    result.ok
      ? { slug: ref.slug, phase: "done" }
      : { slug: ref.slug, phase: "error", reason: result.reason }
  );

  if (preparing && installDirectory) {
    void runPreparation(ref, installDirectory);
    return { ...result, preparing: true };
  }

  return result;
};

const DETAILS_CACHE_MS = 10 * 60_000;
const cachedDetails = new Map<
  string,
  { at: number; result: Promise<RecompilationDetails | null> }
>();

const fetchDetailsQuietly = (ref: RecompilationRef) => {
  const key = `${ref.objectId}:${ref.slug}`;
  const cached = cachedDetails.get(key);
  if (cached && Date.now() - cached.at < DETAILS_CACHE_MS) {
    return cached.result;
  }
  const result = HydraApi.get<RecompilationDetails>(apiPath(ref), undefined, {
    needsAuth: false,
  }).catch(() => null);
  cachedDetails.set(key, { at: Date.now(), result });
  return result;
};

const isDirectory = (directory: string) =>
  fs.promises
    .stat(directory)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

/** Linux also takes a Windows build, through Proton, when the port has no Linux one. */
const getLinkPlatforms = (
  details: RecompilationDetails | null
): PortPlatform[] => {
  const nativePlatform = process.platform as PortPlatform;
  const isWindowsOnly =
    details !== null &&
    details.systems.includes("windows") &&
    !details.systems.includes("linux");
  return nativePlatform === "linux" && isWindowsOnly
    ? ["linux", "win32"]
    : [nativePlatform];
};

/** Fetched while the user browses for the folder, so the check is quick. */
export const warmRecompilationFolderCheck = async (rawRef: unknown) => {
  const ref = parseRef(rawRef);
  if (!ref) return;
  const details = await fetchDetailsQuietly(ref);
  warmFolderCheck(ref, details?.name ?? ref.slug, getLinkPlatforms(details));
};

const isSameOrInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

/** A drive, the downloads folder, or another port's folder can't be a port's own. */
const findFolderConflict = async (slug: string, directory: string) => {
  if (path.parse(directory).root === directory) return "invalid_folder";
  const shared = await listDefaultRecompilationParents();
  if (shared.some((parent) => path.resolve(parent) === directory)) {
    return "shared_folder";
  }
  for await (const [
    otherSlug,
    otherDirectory,
  ] of recompilationInstallsSublevel.iterator()) {
    if (otherSlug === slug || typeof otherDirectory !== "string") continue;
    const other = path.resolve(otherDirectory);
    if (isSameOrInside(other, directory) || isSameOrInside(directory, other)) {
      return "other_port";
    }
  }
  return null;
};

type LinkFailure = { ok: false; reason: string };

const failLink = (reason: string): LinkFailure => ({ ok: false, reason });

const readLinkOptions = (rawOptions: unknown) =>
  typeof rawOptions === "object" &&
  rawOptions !== null &&
  (rawOptions as { force?: unknown }).force === true;

const resolveLinkDirectory = async (rawDirectory: unknown) => {
  if (typeof rawDirectory !== "string" || !path.isAbsolute(rawDirectory)) {
    return null;
  }
  const picked = path.resolve(rawDirectory);
  return (await isDirectory(picked)) ? resolvePickedFolder(picked) : null;
};

const findLinkBlocker = async (ref: RecompilationRef, directory: string) => {
  const conflict = await findFolderConflict(ref.slug, directory);
  if (conflict) return conflict;
  if (isRecompilationBusy(ref.slug)) return "already_installing";
  const current = await getRecompilationInstallState(ref);
  if (await isPortRunning(ref, current?.executablePath ?? null)) {
    return "running";
  }
  return null;
};

const buildLinkedMarker = async (
  ref: RecompilationRef,
  directory: string,
  force: boolean
): Promise<InstallMarker | LinkFailure> => {
  const details = await fetchDetailsQuietly(ref);
  const portName = details?.name ?? ref.slug;
  const platforms = getLinkPlatforms(details);
  const check = await checkPickedFolder(ref, directory, portName, platforms);
  if (!check.fits && !force) return failLink("doesnt_look_right");

  const findIn = (platform: PortPlatform) =>
    findRecompilationExecutable(
      directory,
      portName,
      getRecompilationExecutableOverride(ref.slug, platform),
      platform
    ).catch(() => null);
  const executablePath =
    check.executablePath ??
    (await Promise.all(platforms.map(findIn))).find(Boolean) ??
    null;
  if (!executablePath) return failLink("no_executable");

  return {
    slug: ref.slug,
    objectId: ref.objectId,
    version: "",
    assetName: "",
    executablePath,
    installedAt: new Date().toISOString(),
    name: details?.name,
    iconUrl: details?.iconUrl ?? null,
    linked: true,
    verified: check.fits,
  };
};

const saveLinkedFolder = async (
  ref: RecompilationRef,
  directory: string,
  marker: InstallMarker
) => {
  await saveRecompilationInstallDirectory(ref.slug, directory);
  const { getOrAddBaseGame } = await import("./recompilation-base-game");
  await getOrAddBaseGame(ref).catch((error) => {
    logger.error(
      "Failed to add the recompilation's game to the library",
      error
    );
  });
  await linkInstalledRecompilation(ref.slug, directory, marker);
  sendProgress({ slug: ref.slug, phase: "done" });
  if (!marker.version && marker.executablePath) {
    versionRechecks.add(ref.slug);
    void identifyLinkedVersion(ref, directory, marker.executablePath);
  }
};

export const linkRecompilationFolder = async (
  rawRef: unknown,
  rawDirectory: unknown,
  rawOptions?: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return failLink("invalid_port");
  const directory = await resolveLinkDirectory(rawDirectory);
  if (!directory) return failLink("invalid_folder");
  const blocker = await findLinkBlocker(ref, directory);
  if (blocker) return failLink(blocker);

  const existing = await readInstallMarker(directory);
  if (existing && existing.slug !== ref.slug) return failLink("other_port");

  const marker = existing
    ? { ...existing, objectId: ref.objectId }
    : await buildLinkedMarker(ref, directory, readLinkOptions(rawOptions));
  if ("ok" in marker) return marker;

  try {
    await fs.promises.writeFile(
      path.join(directory, INSTALL_MARKER_FILE),
      JSON.stringify(marker, null, 2)
    );
  } catch {
    return failLink("install_folder_unwritable");
  }

  await saveLinkedFolder(ref, directory, marker);
  return { ok: true };
};

export const uninstallRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(installDirectory);
  if (marker?.slug !== ref.slug) {
    if (await isRecompilationFolderMissing(ref.slug)) {
      return forgetMissingFolder(ref);
    }
    await removeRecompilationDisc(ref);
    return { ok: false, reason: "not_installed" };
  }

  if (installsInProgress.has(ref.slug) || uninstallsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }
  if (await isPortRunning(ref, marker.executablePath)) {
    return { ok: false, reason: "running" };
  }

  uninstallsInProgress.add(ref.slug);
  try {
    await waitForRecompilationLink(ref.slug);
    const onProgress = (loaded: number, total: number) =>
      sendProgress({ slug: ref.slug, phase: "uninstalling", loaded, total });
    if (isLinkedInstall(marker)) {
      await deleteFilesWithProgress(
        resolveInstalledFiles(installDirectory, marker.installedFiles ?? []),
        onProgress
      );
      await removeEmptyFolders(installDirectory, marker.installedFiles ?? []);
      await removeHydraFiles(installDirectory, HYDRA_FILES);
    } else {
      const entries = await fs.promises
        .readdir(installDirectory, { recursive: true, withFileTypes: true })
        .catch(() => []);
      await deleteFilesWithProgress(
        entries
          .filter((entry) => !entry.isDirectory())
          .map((entry) => path.join(entry.parentPath, entry.name)),
        onProgress
      );
      await fs.promises.rm(installDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    logger.error(`Failed to uninstall ${ref.slug}`, error);
    sendProgress({ slug: ref.slug, phase: "uninstalled" });
    return { ok: false, reason: "uninstall_failed" };
  } finally {
    uninstallsInProgress.delete(ref.slug);
  }
  await forgetRecompilationInstallDirectory(ref.slug);
  await removeRecompilationDisc(ref);
  sendProgress({ slug: ref.slug, phase: "uninstalled" });
  return { ok: true };
};

/** Stops using a folder the user picked, leaving every file in it. */
export const unlinkRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(installDirectory);
  if (marker?.slug !== ref.slug || !isLinkedInstall(marker)) {
    if (await isRecompilationFolderMissing(ref.slug)) {
      return forgetMissingFolder(ref);
    }
    return { ok: false, reason: "not_linked" };
  }
  if (isRecompilationBusy(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }
  if (await isPortRunning(ref, marker.executablePath)) {
    return { ok: false, reason: "running" };
  }

  await waitForRecompilationLink(ref.slug);
  try {
    await removeHydraFiles(installDirectory, HYDRA_TRACKING_FILES);
  } catch (error) {
    logger.error(`Failed to unlink ${ref.slug}`, error);
    return { ok: false, reason: "uninstall_failed" };
  }
  await forgetRecompilationInstallDirectory(ref.slug);
  await removeRecompilationDisc(ref);
  sendProgress({ slug: ref.slug, phase: "uninstalled" });
  return { ok: true };
};

const forgetMissingFolder = async (
  ref: RecompilationRef
): Promise<RecompilationActionResult> => {
  if (installsInProgress.has(ref.slug) || uninstallsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }
  await forgetRecompilationInstallDirectory(ref.slug);
  await removeRecompilationDisc(ref);
  sendProgress({ slug: ref.slug, phase: "uninstalled" });
  return { ok: true, folderMissing: true };
};

const HYDRA_TRACKING_FILES = [
  INSTALL_MARKER_FILE,
  RECOMPILATION_ROM_CHOICE_FILE,
];
const HYDRA_FILES = [
  ...HYDRA_TRACKING_FILES,
  RECOMPILATION_EXTRACTED_ROM_FOLDER,
];

const removeHydraFiles = async (directory: string, names: string[]) => {
  await Promise.all(
    names.map((name) =>
      fs.promises.rm(path.join(directory, name), {
        recursive: true,
        force: true,
      })
    )
  );
};

const resolveInstalledFiles = (directory: string, files: string[]) =>
  files
    .map((file) => path.resolve(directory, file))
    .filter((file) => {
      const relative = path.relative(directory, file);
      return (
        relative !== "" &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative)
      );
    });

/** Removes the release's folders that are empty once its files are gone. */
const removeEmptyFolders = async (directory: string, files: string[]) => {
  const folders = new Set<string>();
  for (const file of resolveInstalledFiles(directory, files)) {
    for (
      let folder = path.dirname(file);
      folder !== directory && folder.startsWith(directory);
      folder = path.dirname(folder)
    ) {
      folders.add(folder);
    }
  }
  const byDepth = new Map<number, string[]>();
  for (const folder of folders) {
    const depth = folder.split(path.sep).length;
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), folder]);
  }
  const deepestFirst = [...byDepth.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, level]) => level);
  await deepestFirst.reduce(
    (previous, level) =>
      previous.then(() =>
        Promise.all(
          level.map((folder) =>
            fs.promises.rmdir(folder).catch(() => undefined)
          )
        ).then(() => undefined)
      ),
    Promise.resolve()
  );
};

const DELETE_BATCH_SIZE = 16;

const deleteFilesWithProgress = async (
  files: string[],
  onProgress: (loaded: number, total: number) => void
) => {
  let deleted = 0;
  let lastPercent = -1;
  onProgress(0, files.length || 1);
  const countDeleted = () => {
    deleted += 1;
    const percent = Math.floor((deleted / files.length) * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    onProgress(deleted, files.length);
  };
  const batches = Array.from(
    { length: Math.ceil(files.length / DELETE_BATCH_SIZE) },
    (_, index) =>
      files.slice(index * DELETE_BATCH_SIZE, (index + 1) * DELETE_BATCH_SIZE)
  );
  await batches.reduce(
    (previous, batch) =>
      previous.then(() =>
        Promise.all(
          batch.map((file) =>
            fs.promises.rm(file, { force: true }).then(countDeleted)
          )
        ).then(() => undefined)
      ),
    Promise.resolve()
  );
};

export const openRecompilationFolder = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const state = await getRecompilationInstallState(rawRef);
  if (!state?.installPath) return { ok: false, reason: "not_installed" };

  const error = await shell.openPath(state.installPath);
  return error ? { ok: false, reason: error } : { ok: true };
};

// Set by Hydra's own AppImage; a port's AppRun would resolve its files inside Hydra instead of its own folder.
const HYDRA_APPIMAGE_ENV = ["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

const getPortEnv = (launchEnv: Record<string, string>) => {
  const env = { ...process.env, ...launchEnv };
  for (const key of HYDRA_APPIMAGE_ENV) delete env[key];
  return env;
};

const spawnPort = (
  executablePath: string,
  launch: { args: string[]; env: Record<string, string> }
) =>
  new Promise<
    | { ok: true; child: ReturnType<typeof spawn> }
    | { ok: false; error: unknown }
  >((resolve) => {
    const child = spawn(executablePath, launch.args, {
      cwd: path.dirname(executablePath),
      env: getPortEnv(launch.env),
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, child });
    });
    child.once("error", (error) => resolve({ ok: false, error }));
  });

const HIDE_CONSOLE_SCRIPT = [
  'Add-Type -TypeDefinition \'using System; using System.Text; using System.Runtime.InteropServices; public static class HydraPortConsole { delegate bool EnumProc(IntPtr h, IntPtr l); [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l); [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c); public static int Hide(uint pid) { int hidden = 0; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid || !IsWindowVisible(h)) return true; var name = new StringBuilder(64); GetClassName(h, name, 64); if (name.ToString() == "ConsoleWindowClass") { ShowWindow(h, 0); hidden++; } return true; }, IntPtr.Zero); return hidden; } }\'',
  "$portId = [uint32][Console]::In.ReadLine()",
  "$deadline = (Get-Date).AddSeconds(20)",
  "while ((Get-Date) -lt $deadline) { if (-not (Get-Process -Id $portId -ErrorAction SilentlyContinue)) { break }; if ([HydraPortConsole]::Hide($portId) -gt 0) { $deadline = (Get-Date).AddSeconds(2) }; Start-Sleep -Milliseconds 50 }",
].join("; ");

const startConsoleHider = () => {
  if (process.platform !== "win32") return null;
  const hider = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", HIDE_CONSOLE_SCRIPT],
    { stdio: ["pipe", "ignore", "ignore"], windowsHide: true }
  );
  hider.once("error", (error) =>
    logger.error("Failed to start the port console hider", error)
  );
  return hider;
};

/** A Windows build on Linux runs through umu-run with the user's Proton. */
const launchPortWithProton = async (
  slug: string,
  executablePath: string,
  launch: { args: string[]; env: Record<string, string> }
) => {
  const { Umu } = await import("@main/services/umu");
  const { UmuUpdater } = await import("@main/services/umu-updater");
  void UmuUpdater.checkForUpdates();

  let markExited: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    markExited = resolve;
  });
  try {
    const pid = await Umu.launchExecutable(executablePath, launch.args, {
      winePrefixPath: getPortWinePrefix(slug),
      protonPath: await getPortProtonPath(),
      gameId: `recompilation-${slug}`,
      env: launch.env,
      onExit: () => markExited(),
    });
    return { pid, exited };
  } catch (error) {
    logger.error(`Failed to launch ${slug} through Proton`, error);
    return null;
  }
};

type LaunchFailure = { ok: false; reason: string };

const resolveLaunchProgram = async (
  ref: RecompilationRef
): Promise<{ installPath: string; executablePath: string } | LaunchFailure> => {
  const state = await getRecompilationInstallState(ref);
  if (!state?.installPath) {
    return {
      ok: false,
      reason: (await isRecompilationFolderMissing(ref.slug))
        ? "folder_missing"
        : "not_installed",
    };
  }
  if (!state.executablePath) return { ok: false, reason: "no_executable" };
  if (state.linked && !state.verified) {
    return { ok: false, reason: "port_update_required" };
  }

  const executablePath = await refreshDeclaredEntry(
    ref.slug,
    state.installPath,
    state.executablePath
  );
  const relative = path.relative(state.installPath, executablePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "no_executable" };
  }
  if (!fs.existsSync(executablePath)) {
    return { ok: false, reason: "program_missing" };
  }
  return { installPath: state.installPath, executablePath };
};

const findLaunchBlocker = async (
  ref: RecompilationRef,
  executablePath: string,
  isRecompilationRunning: (ref: RecompilationRef) => boolean
) => {
  if (
    isRecompilationRunning(ref) ||
    (await isExecutableInUse(executablePath))
  ) {
    return "already_running";
  }
  const { isPs4PkgJobRunningFor } = await import("../emulators/ps4-pkg-job");
  return isPs4PkgJobRunningFor(ref.objectId) ? "pkg_job_running" : null;
};

const prepareLaunch = async (ref: RecompilationRef, installPath: string) => {
  let prepared = false;
  const launch = await prepareRecompilationRom(ref, installPath, (step) => {
    prepared = true;
    sendPrepareProgress({ slug: ref.slug, phase: "running", ...step });
  });
  if (prepared) {
    sendPrepareProgress({
      slug: ref.slug,
      phase: launch.ok ? "done" : "error",
    });
  }
  return launch;
};

const startPort = async (
  ref: RecompilationRef,
  executablePath: string,
  launch: { args: string[]; env: Record<string, string> },
  session: Awaited<ReturnType<typeof loadSession>>
): Promise<RecompilationActionResult> => {
  if (runsThroughProton(executablePath)) {
    const launched = await launchPortWithProton(
      ref.slug,
      executablePath,
      launch
    );
    if (!launched) {
      session.clearRecompilationCloudSaveGuard(ref);
      return { ok: false, reason: "launch_failed" };
    }
    void session.startRecompilationSession(ref, null, launched);
    return { ok: true };
  }

  const consoleHider = shouldHideRecompilationConsole(ref.slug)
    ? startConsoleHider()
    : null;
  const spawned = await spawnPort(executablePath, launch);
  if (spawned.ok && spawned.child.pid) {
    consoleHider?.stdin?.end(`${spawned.child.pid}\n`);
  } else {
    consoleHider?.kill();
  }
  if (!spawned.ok) {
    logger.error("Failed to launch recompilation", spawned.error);
    session.clearRecompilationCloudSaveGuard(ref);
    return { ok: false, reason: "launch_failed" };
  }
  void session.startRecompilationSession(ref, spawned.child);
  return { ok: true };
};

const launchRecompilation = async (
  ref: RecompilationRef
): Promise<RecompilationActionResult> => {
  const program = await resolveLaunchProgram(ref);
  if ("ok" in program) return program;
  const { installPath, executablePath } = program;

  const session = await loadSession();
  const blocker = await findLaunchBlocker(
    ref,
    executablePath,
    session.isRecompilationRunning
  );
  if (blocker) return { ok: false, reason: blocker };

  const launch = await prepareLaunch(ref, installPath);
  if (!launch.ok) return { ok: false, reason: launch.reason };

  if (!(await session.prepareRecompilationCloudSave(ref))) {
    return { ok: false, reason: "cloud_save_conflict" };
  }

  const { applyPendingTrophyReset } = await import(
    "./recompilation-trophy-watcher"
  );
  await applyPendingTrophyReset(ref).catch((error) =>
    logger.error("Failed to apply a saved trophy reset", error)
  );

  const result = await startPort(ref, executablePath, launch, session);
  if (result.ok) void markRecompilationRomLaunched(installPath);
  return result;
};

export const playRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "not_installed" };
  if (launchesInProgress.has(ref.slug)) return { ok: false, reason: "running" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  launchesInProgress.add(ref.slug);
  try {
    return await launchRecompilation(ref);
  } finally {
    launchesInProgress.delete(ref.slug);
  }
};

export const prepareRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };
  if (launchesInProgress.has(ref.slug)) return { ok: false, reason: "running" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  const state = await getRecompilationInstallState(ref);
  if (!state?.installPath) return { ok: false, reason: "not_installed" };

  return runPreparation(ref, state.installPath);
};

/** Marks the port busy before the first await, so callers can report it as preparing right away. */
const runPreparation = async (
  ref: RecompilationRef,
  installPath: string
): Promise<RecompilationActionResult> => {
  launchesInProgress.add(ref.slug);
  sendPrepareProgress({ slug: ref.slug, phase: "running" });
  try {
    const result = await prepareRecompilationRom(ref, installPath, (step) =>
      sendPrepareProgress({ slug: ref.slug, phase: "running", ...step })
    );
    sendPrepareProgress({
      slug: ref.slug,
      phase: result.ok ? "done" : "error",
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } catch (error) {
    logger.error(`Failed to prepare recompilation ${ref.slug}`, error);
    sendPrepareProgress({ slug: ref.slug, phase: "error" });
    return { ok: false, reason: "rom_prepare_failed" };
  } finally {
    launchesInProgress.delete(ref.slug);
  }
};
