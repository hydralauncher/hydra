import fs from "node:fs/promises";
import { registerEvent } from "../register-event";

interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

const DRIVE_SEPARATOR = String.fromCharCode(92);
const DRIVE_LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i)
);
const LINUX_IGNORED_FS_TYPES = new Set([
  "proc",
  "sysfs",
  "tmpfs",
  "devtmpfs",
  "devpts",
  "overlay",
  "squashfs",
  "nsfs",
  "cgroup",
  "cgroup2",
  "pstore",
  "bpf",
  "tracefs",
  "securityfs",
  "configfs",
  "debugfs",
  "mqueue",
  "hugetlbfs",
  "fusectl",
  "ramfs",
  "autofs",
  "binfmt_misc",
]);

function getDriveRoot(letter: string): string {
  return `${letter}:${DRIVE_SEPARATOR}`;
}

async function getDriveInfo(root: string): Promise<DriveInfo | null> {
  if (typeof (fs as any).statfs !== "function") return null;

  try {
    const stats = await (fs as any).statfs(root);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;

    if (total <= 0) return null;

    return {
      root,
      label: root.slice(0, 2),
      free: Math.max(0, free),
      total,
    };
  } catch {
    return null;
  }
}

async function queryWindowsDrives(): Promise<DriveInfo[]> {
  const driveChecks = DRIVE_LETTERS.map((letter) =>
    getDriveInfo(getDriveRoot(letter))
  );
  const drives = await Promise.all(driveChecks);

  return drives.filter((drive): drive is DriveInfo => drive !== null);
}

function decodeLinuxMountPath(value: string): string {
  return value
    .replaceAll("\\040", " ")
    .replaceAll("\\011", "\t")
    .replaceAll("\\012", "\n")
    .replaceAll("\\134", DRIVE_SEPARATOR);
}

async function getLinuxMountPoints(): Promise<string[]> {
  const mounts = await fs.readFile("/proc/mounts", "utf8").catch(() => "");
  if (!mounts.trim()) return ["/"];

  const mountPoints = new Set<string>();

  for (const line of mounts.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const [source = "", target = "", fsType = ""] = line.split(" ");
    if (!target || LINUX_IGNORED_FS_TYPES.has(fsType)) continue;

    const isDeviceMount = source.startsWith("/dev/");
    const isUserSpaceFs = fsType.startsWith("fuse.");
    if (!isDeviceMount && !isUserSpaceFs) continue;

    mountPoints.add(decodeLinuxMountPath(target));
  }

  if (mountPoints.size === 0) mountPoints.add("/");
  return Array.from(mountPoints);
}

async function queryLinuxDrives(): Promise<DriveInfo[]> {
  const mountPoints = await getLinuxMountPoints();
  const driveChecks = mountPoints.map((mountPoint) => getDriveInfo(mountPoint));
  const drives = await Promise.all(driveChecks);

  return drives
    .filter((drive): drive is DriveInfo => drive !== null)
    .map((drive) => ({ ...drive, label: drive.root }));
}

const getAvailableDrives = async (): Promise<DriveInfo[]> => {
  console.log("getAvailableDrives called, platform:", process.platform);

  try {
    if (process.platform === "win32") {
      const drives = await queryWindowsDrives();
      console.log("Parsed drives:", drives.length, "drives found");
      return drives;
    }

    if (process.platform === "linux") {
      const drives = await queryLinuxDrives();
      console.log("Parsed drives:", drives.length, "drives found");
      return drives;
    }

    return [];
  } catch (error) {
    console.error("Failed to fetch drives:", error);
    return [];
  }
};

registerEvent("getAvailableDrives", getAvailableDrives);
