import fs from "node:fs";
import path from "node:path";

const PREFIX_STEAM_DIR_SEGMENTS = ["drive_c", "Program Files (x86)", "Steam"];

// Mirrors Proton's setup_prefix copy list: [source in legacycompat, target].
const STEAM_CLIENT_FILES: ReadonlyArray<readonly [string, string]> = [
  ["steamclient.dll", "steamclient.dll"],
  ["steamclient64.dll", "steamclient64.dll"],
  ["GameOverlayRenderer64.dll", "GameOverlayRenderer64.dll"],
  ["SteamService.exe", "steam.exe"],
  ["Steam.dll", "Steam.dll"],
];

const isUpToDate = (sourcePath: string, targetPath: string) => {
  try {
    return fs.statSync(sourcePath).size === fs.statSync(targetPath).size;
  } catch {
    return false;
  }
};

/**
 * umu-run resets STEAM_COMPAT_CLIENT_INSTALL_PATH before invoking Proton, so
 * Proton never copies the Steam client files into the prefix. Games relying on
 * them (e.g. OnlineFix's SteamOverlay64.dll loading GameOverlayRenderer64.dll)
 * then fail, so copy them ourselves when the launch asks for the Steam client.
 * Proton's prefix creation keeps existing files, so this is safe to run before
 * the prefix exists.
 */
export const seedPrefixSteamClientFiles = (
  winePrefixPath: string,
  steamClientInstallPath: string
): string[] => {
  const legacyCompatPath = path.join(steamClientInstallPath, "legacycompat");
  const prefixSteamPath = path.join(
    winePrefixPath,
    ...PREFIX_STEAM_DIR_SEGMENTS
  );
  const copiedFiles: string[] = [];

  for (const [source, target] of STEAM_CLIENT_FILES) {
    const sourcePath = path.join(legacyCompatPath, source);
    const targetPath = path.join(prefixSteamPath, target);

    if (!fs.existsSync(sourcePath) || isUpToDate(sourcePath, targetPath)) {
      continue;
    }

    fs.mkdirSync(prefixSteamPath, { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    copiedFiles.push(target);
  }

  return copiedFiles;
};
