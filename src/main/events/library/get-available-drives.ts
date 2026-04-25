import { spawnSync } from "node:child_process";
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
      // Use absolute path to PowerShell (works on all Windows versions)
      const systemRoot = process.env.SystemRoot || "C:\\Windows";
      const powershellPath = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
      
      const result = spawnSync(
        powershellPath,
        [
          "-NoProfile",
          "-Command",
          'Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, FreeSpace, Size | ConvertTo-Csv -NoTypeInformation',
        ],
        {
          encoding: "utf8",
          shell: false,
          timeout: 10000, // 10 second timeout
        }
      );

      if (result.error) {
        console.error("PowerShell spawn error:", result.error);
        throw result.error;
      }

      if (result.status !== 0) {
        console.error("PowerShell exit code:", result.status, "stderr:", result.stderr);
        throw new Error(`PowerShell exited with code ${result.status}`);
      }

      const out = result.stdout;
      console.log("Raw output length:", out.length);

      const drives: DriveInfo[] = [];
      const lines = out.split(/\r?\n/);

      if (lines.length < 2) return [];

      // Parse CSV: DeviceID,FreeSpace,Size
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        const [deviceId, freeSpace, size] = lines[i]
          .split(",")
          .map((s) => s.replace(/"/g, "").trim());

        if (deviceId && size && parseInt(size) > 0) {
          drives.push({
            root: deviceId + "\\",
            label: deviceId,
            free: parseInt(freeSpace) || 0,
            total: parseInt(size),
          });
        }
      }

      console.log("Parsed drives:", drives.length, "drives found");
      return drives;
    } catch (error) {
      console.error("PowerShell failed:", error);
      return [];
    }
  }

  return [];
};

registerEvent("getAvailableDrives", getAvailableDrives);