import { spawnSync } from "node:child_process";
import { registerEvent } from "../register-event";

interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

const DRIVE_SEPARATOR = String.fromCharCode(92);
const WINDOWS_DEFAULT_ROOT = ["C:", "Windows"].join(DRIVE_SEPARATOR);
const WINDOWS_POWERSHELL_PATH = [
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
].join(DRIVE_SEPARATOR);
const POWERSHELL_TIMEOUT_MS = 10_000;
const POWERSHELL_DRIVES_COMMAND =
  'Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, FreeSpace, Size | ConvertTo-Csv -NoTypeInformation';

function toInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseDriveLine(line: string): DriveInfo | null {
  if (!line.trim()) return null;

  const [deviceId = "", freeSpace = "", size = ""] = line
    .split(",")
    .map((value) => value.replaceAll('"', "").trim());

  const total = toInteger(size);
  if (!deviceId || total <= 0) return null;

  return {
    root: `${deviceId}${DRIVE_SEPARATOR}`,
    label: deviceId,
    free: toInteger(freeSpace),
    total,
  };
}

function parseDriveCsv(output: string): DriveInfo[] {
  const lines = output.split(/\r?\n/);
  if (lines.length < 2) return [];

  return lines
    .slice(1)
    .map(parseDriveLine)
    .filter((drive): drive is DriveInfo => drive !== null);
}

function getPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot ?? WINDOWS_DEFAULT_ROOT;
  const normalizedRoot = systemRoot.endsWith(DRIVE_SEPARATOR)
    ? systemRoot.slice(0, -1)
    : systemRoot;
  return `${normalizedRoot}${DRIVE_SEPARATOR}${WINDOWS_POWERSHELL_PATH}`;
}

function queryWindowsDrives(): DriveInfo[] {
  const result = spawnSync(
    getPowerShellPath(),
    ["-NoProfile", "-Command", POWERSHELL_DRIVES_COMMAND],
    {
      encoding: "utf8",
      shell: false,
      timeout: POWERSHELL_TIMEOUT_MS,
    }
  );

  if (result.error) {
    console.error("PowerShell spawn error:", result.error);
    throw result.error;
  }

  if (result.status !== 0) {
    console.error(
      "PowerShell exit code:",
      result.status,
      "stderr:",
      result.stderr
    );
    throw new Error(`PowerShell exited with code ${result.status}`);
  }

  console.log("Raw output length:", result.stdout.length);
  return parseDriveCsv(result.stdout);
}

const getAvailableDrives = async (): Promise<DriveInfo[]> => {
  console.log("getAvailableDrives called, platform:", process.platform);
  if (process.platform !== "win32") return [];

  try {
    const drives = queryWindowsDrives();
    console.log("Parsed drives:", drives.length, "drives found");
    return drives;
  } catch (error) {
    console.error("PowerShell failed:", error);
    return [];
  }
};

registerEvent("getAvailableDrives", getAvailableDrives);
