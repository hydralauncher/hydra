import { promises as fs } from "node:fs";
import path from "node:path";

import {
  RETROARCH_LEGACY_EXTRA_SUFFIXES,
  retroArchBatterySuffixes,
  retroArchLogicalSaveName,
  retroArchLogicalStateName,
  retroArchPhysicalSaveName,
  retroArchStateSuffix,
  retroArchTransferPakSaveName,
} from "./retroarch-save-config.js";

export interface RomSaveLocation {
  rawPath: string;
  romPath: string;
  saveDirectory: string | null;
  stateDirectory: string | null;
  stem: string;
  hasTransferPak: boolean;
}

export interface RetroArchTarget {
  directory: string;
  filePath: string;
  relativePath: string;
}

export const isSafeRetroArchFileTarget = async (
  directory: string,
  filePath: string
) => {
  if (path.dirname(filePath) !== directory) return false;
  const directoryStat = await fs.lstat(directory).catch(() => null);
  if (directoryStat?.isSymbolicLink()) return false;
  const fileStat = await fs.lstat(filePath).catch(() => null);
  return !fileStat?.isSymbolicLink();
};

export const retroArchTargetForFile = (
  location: RomSaveLocation,
  relativePath: string
): RetroArchTarget | null => {
  if (relativePath === "transfer-pak.sav") {
    if (!location.hasTransferPak) return null;
    const directory = path.dirname(location.romPath);
    return {
      directory,
      filePath: path.join(
        directory,
        retroArchTransferPakSaveName(location.romPath)
      ),
      relativePath,
    };
  }
  const fileName = retroArchPhysicalSaveName(location.romPath, relativePath);
  if (!fileName) return null;
  const directory = relativePath.startsWith("state.state")
    ? location.stateDirectory
    : location.saveDirectory;
  return directory
    ? { directory, filePath: path.join(directory, fileName), relativePath }
    : null;
};

export const discoverRetroArchTargets = async (
  location: RomSaveLocation,
  platform: string
): Promise<{ targets: RetroArchTarget[]; complete: boolean }> => {
  const targets: RetroArchTarget[] = [];
  let complete = Boolean(location.saveDirectory && location.stateDirectory);
  for (const directory of [location.saveDirectory, location.stateDirectory]) {
    if (!directory) continue;
    const stat = await fs.lstat(directory).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) complete = false;
  }
  for (const suffix of retroArchBatterySuffixes(platform)) {
    const target = retroArchTargetForFile(
      location,
      retroArchLogicalSaveName(suffix)!
    );
    if (target) targets.push(target);
  }
  if (location.saveDirectory) {
    for (const suffix of RETROARCH_LEGACY_EXTRA_SUFFIXES) {
      const target = retroArchTargetForFile(
        location,
        retroArchLogicalSaveName(suffix)!
      );
      if (target && (await fs.lstat(target.filePath).catch(() => null))) {
        targets.push(target);
      }
    }
    const ambiguousSav = retroArchTargetForFile(location, "battery.sav");
    if (
      ambiguousSav &&
      (await fs.lstat(ambiguousSav.filePath).catch(() => null))
    ) {
      complete = false;
    }
  }
  if (location.stateDirectory) {
    let entries: string[];
    try {
      entries = await fs.readdir(location.stateDirectory);
    } catch (error) {
      complete = false;
      entries = [];
    }
    const entrySet = new Set(entries);
    for (const name of entries) {
      const suffix = retroArchStateSuffix(name, location.stem);
      if (!suffix) continue;
      const state = retroArchTargetForFile(
        location,
        retroArchLogicalStateName(suffix)!
      );
      if (!state) continue;
      targets.push(state);
      if (entrySet.has(`${name}.png`)) {
        const image = retroArchTargetForFile(
          location,
          retroArchLogicalStateName(`${suffix}.png`)!
        );
        if (image) targets.push(image);
      }
    }
  }
  const transferPak = retroArchTargetForFile(location, "transfer-pak.sav");
  if (transferPak) targets.push(transferPak);
  return { targets, complete };
};
