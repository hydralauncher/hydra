import { execSync } from "node:child_process";
import { registerEvent } from "../register-event";

interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

const getAvailableDrives = async (): Promise<DriveInfo[]> => {
  console.log("getAvailableDrives called, platform:", process.platform);

  if (process.platform === "win32") {
    try {
      // Simpler PowerShell command
      const psCommand = `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Format-List DeviceID, VolumeName, FreeSpace, Size`;
      const out = execSync(`powershell -Command "${psCommand}"`, {
        encoding: "utf8",
        shell: "powershell.exe",
      });

      console.log("Raw output:", out);

      const drives: DriveInfo[] = [];
      let currentDrive: Partial<DriveInfo> = {};

      const lines = out.split(/\r?\n/);
      for (const line of lines) {
        if (line.includes("DeviceID")) {
          const match = line.match(/DeviceID\s+:\s+(.+)/);
          if (match) currentDrive.root = match[1].trim() + "\\";
        } else if (line.includes("FreeSpace")) {
          const match = line.match(/FreeSpace\s+:\s+(\d+)/);
          if (match) currentDrive.free = parseInt(match[1]);
        } else if (line.includes("Size")) {
          const match = line.match(/Size\s+:\s+(\d+)/);
          if (match) currentDrive.total = parseInt(match[1]);
        } else if (
          line.trim() === "" &&
          currentDrive.root &&
          currentDrive.total
        ) {
          drives.push({
            root: currentDrive.root,
            label: currentDrive.root,
            free: currentDrive.free || 0,
            total: currentDrive.total,
          });
          currentDrive = {};
        }
      }

      console.log("Parsed drives:", drives);
      return drives;
    } catch (error) {
      console.error("PowerShell failed:", error);
      return [];
    }
  }

  return [];
};

registerEvent("getAvailableDrives", getAvailableDrives);
