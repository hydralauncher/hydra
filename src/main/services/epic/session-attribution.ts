import { EPIC_SESSION_MAX_FILE_BYTES } from "./legendary-auth.js";
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord } from "./auth-protocol.js";
export interface EpicInstallManifest {
  artifactId: string;
  namespace?: string;
  itemId?: string;
  installLocation: string;
}
export function parseEpicInstallManifest(
  input: unknown
): EpicInstallManifest | null {
  if (
    !isRecord(input) ||
    typeof input.AppName !== "string" ||
    !input.AppName ||
    typeof input.InstallLocation !== "string" ||
    !input.InstallLocation ||
    input.bIsIncompleteInstall === true
  )
    return null;
  return {
    artifactId: input.AppName,
    installLocation: input.InstallLocation,
    ...(typeof input.CatalogNamespace === "string"
      ? { namespace: input.CatalogNamespace }
      : {}),
    ...(typeof input.CatalogItemId === "string"
      ? { itemId: input.CatalogItemId }
      : {}),
  };
}
export function isPathInside(
  root: string,
  candidate: string,
  paths: typeof path = path
) {
  if (!paths.isAbsolute(root) || !paths.isAbsolute(candidate)) return false;
  const relative = paths.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  );
}
export function parseLegendaryInstalledGame(
  input: unknown
): EpicInstallManifest | null {
  if (
    !isRecord(input) ||
    typeof input.app_name !== "string" ||
    !input.app_name ||
    typeof input.install_path !== "string" ||
    !input.install_path ||
    input.is_dlc === true ||
    input.needs_verification === true ||
    input.is_preloaded === true
  )
    return null;
  return { artifactId: input.app_name, installLocation: input.install_path };
}
async function verifyInstall(
  manifest: EpicInstallManifest,
  objectId: string,
  artifactIds: string[],
  matchedPath: string,
  winePrefix?: string | null,
  signal?: AbortSignal
) {
  if (!artifactIds.includes(manifest.artifactId) || signal?.aborted)
    return false;
  const [namespace, itemId] = objectId.split(":");
  if (
    (manifest.namespace && manifest.namespace !== namespace) ||
    (manifest.itemId && manifest.itemId !== itemId)
  )
    return false;
  let install = manifest.installLocation;
  if (process.platform !== "win32" && winePrefix && /^[cC]:[\\/]/.test(install))
    install = path.join(
      winePrefix,
      "drive_c",
      ...install.slice(3).split(/[\\/]/)
    );
  if (!isPathInside(install, matchedPath)) return false;
  const [realInstall, realExecutable] = await Promise.all([
    fs.realpath(install),
    fs.realpath(matchedPath),
  ]);
  return isPathInside(realInstall, realExecutable) && !signal?.aborted;
}
export async function isEpicInstallExecutable(
  objectId: string,
  artifactIds: string[],
  matchedPath: string,
  winePrefix?: string | null,
  signal?: AbortSignal
): Promise<boolean> {
  const roots: string[] = [];
  const windows = process.platform === "win32";
  // Read only an explicitly configured local installation database, never its credentials.
  const legendaryConfig = process.env.LEGENDARY_CONFIG_PATH;
  if (legendaryConfig && path.isAbsolute(legendaryConfig)) {
    try {
      const file = path.join(legendaryConfig, "installed.json");
      const stat = await fs.lstat(file);
      if (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size <= EPIC_SESSION_MAX_FILE_BYTES
      ) {
        const installed: unknown = JSON.parse(
          await fs.readFile(file, { encoding: "utf8", signal })
        );
        if (isRecord(installed))
          for (const value of Object.values(installed)) {
            const manifest = parseLegendaryInstalledGame(value);
            if (
              manifest &&
              (await verifyInstall(
                manifest,
                objectId,
                artifactIds,
                matchedPath,
                winePrefix,
                signal
              ))
            )
              return true;
          }
      }
    } catch {
      /* Missing or unverifiable metadata keeps the Hydra policy. */
    }
  }
  if (windows && process.env.PROGRAMDATA)
    roots.push(
      path.join(
        process.env.PROGRAMDATA,
        "Epic",
        "EpicGamesLauncher",
        "Data",
        "Manifests"
      )
    );
  if (process.platform === "linux" && winePrefix && path.isAbsolute(winePrefix))
    roots.push(
      path.join(
        winePrefix,
        "drive_c",
        "ProgramData",
        "Epic",
        "EpicGamesLauncher",
        "Data",
        "Manifests"
      )
    );
  // Do not infer a macOS installation from account ownership or search global prefixes.
  for (const root of roots) {
    let names: string[];
    try {
      names = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const name of names.filter((name) => name.endsWith(".item"))) {
      if (signal?.aborted) return false;
      try {
        const file = path.join(root, name);
        const stat = await fs.lstat(file);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > EPIC_SESSION_MAX_FILE_BYTES
        )
          continue;
        const manifest = parseEpicInstallManifest(
          JSON.parse(await fs.readFile(file, "utf8"))
        );
        if (
          manifest &&
          (await verifyInstall(
            manifest,
            objectId,
            artifactIds,
            matchedPath,
            winePrefix,
            signal
          ))
        )
          return true;
      } catch {
        /* Unverifiable installations keep the Hydra policy. */
      }
    }
  }
  return false;
}
