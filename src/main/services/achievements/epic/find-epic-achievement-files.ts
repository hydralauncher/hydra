import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Cracker } from "../../../../shared/constants.js";
import type { AchievementFile } from "@types";

export interface EpicAchievementRoots {
  /** Folders that hold `NemirtingasEpicEmu`, usually Roaming AppData. */
  nemirtingas: string[];
  /** Folders that hold `Remedy\AlanWake2`, Local and Roaming AppData. */
  alanWake2: string[];
}

interface Candidate {
  filePath: string;
  mtimeMs: number;
}

export const ALAN_WAKE_2_NAMESPACE = "c4763f236d08423eb47b4c3008779c84";

const MAX_ACHIEVEMENT_FILE_BYTES = 2 * 1024 * 1024;
const ALAN_WAKE_2_CONTAINER_NAME = "achievements";

const getEpicNamespace = (objectId: string) =>
  /^([a-f0-9]{32}):[a-z0-9]+$/i.exec(objectId)?.[1]?.toLowerCase() ?? null;

const isDirectory = async (directory: string) => {
  const info = await lstat(directory).catch(() => null);
  return Boolean(info?.isDirectory() && !info.isSymbolicLink());
};

const getFileCandidate = async (
  filePath: string,
  maxBytes = MAX_ACHIEVEMENT_FILE_BYTES
): Promise<Candidate | null> => {
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
    return null;
  }

  return { filePath, mtimeMs: info.mtimeMs };
};

const listProfileDirectories = async (root: string) => {
  if (!(await isDirectory(root))) return [];

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(root, entry.name));
};

const findNemirtingasCandidates = async (
  roamingRoot: string,
  namespace: string
) => {
  const profiles = await listProfileDirectories(
    path.join(roamingRoot, "NemirtingasEpicEmu")
  );

  return Promise.all(
    profiles.map(async (profile) => {
      const namespaceDirectory = path.join(profile, namespace);
      if (!(await isDirectory(namespaceDirectory))) return null;

      return getFileCandidate(
        path.join(namespaceDirectory, "achievements.json")
      );
    })
  );
};

const isAlanWake2AchievementContainer = async (directory: string) => {
  const displayNamePath = path.join(directory, "--containerDisplayName.chunk");
  const candidate = await getFileCandidate(
    displayNamePath,
    ALAN_WAKE_2_CONTAINER_NAME.length
  );
  if (!candidate) return false;

  const displayName = await readFile(displayNamePath).catch(() => null);
  return displayName?.toString("ascii") === ALAN_WAKE_2_CONTAINER_NAME;
};

const findAlanWake2Candidates = async (appDataRoot: string) => {
  const profiles = await listProfileDirectories(
    path.join(appDataRoot, "Remedy", "AlanWake2")
  );

  return Promise.all(
    profiles.map(async (profile) => {
      const containerDirectory = path.join(profile, "achievements");
      if (
        !(await isDirectory(containerDirectory)) ||
        !(await isAlanWake2AchievementContainer(containerDirectory))
      ) {
        return null;
      }

      return getFileCandidate(path.join(containerDirectory, "data.chunk"));
    })
  );
};

/**
 * Each install keeps progress under a user folder whose name varies. The
 * most recently written file belongs to the profile the game is using, and
 * merging several profiles could mix progress from different players.
 */
const pickMostRecent = (candidates: (Candidate | null)[]) =>
  candidates
    .filter((candidate): candidate is Candidate => candidate !== null)
    .reduce<Candidate | null>(
      (latest, candidate) =>
        !latest || candidate.mtimeMs > latest.mtimeMs ? candidate : latest,
      null
    );

export const findEpicAchievementFilesInRoots = async (
  objectId: string,
  roots: EpicAchievementRoots
): Promise<AchievementFile[]> => {
  const namespace = getEpicNamespace(objectId);
  if (!namespace) return [];

  const nemirtingas = pickMostRecent(
    (
      await Promise.all(
        roots.nemirtingas.map((root) =>
          findNemirtingasCandidates(root, namespace)
        )
      )
    ).flat()
  );

  const alanWake2 =
    namespace === ALAN_WAKE_2_NAMESPACE
      ? pickMostRecent(
          (
            await Promise.all(roots.alanWake2.map(findAlanWake2Candidates))
          ).flat()
        )
      : null;

  const files: AchievementFile[] = [];

  if (nemirtingas) {
    files.push({ type: Cracker.nemirtingas, filePath: nemirtingas.filePath });
  }

  if (alanWake2) {
    files.push({ type: Cracker.alanWake2, filePath: alanWake2.filePath });
  }

  return files;
};
