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
      // Using spawnSync with shell: false (the compliant pattern)
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance -ClassName Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID, FreeSpace, Size | ConvertTo-Csv -NoTypeInformation"
        ],
        {
          encoding: "utf8",
          shell: false, // Explicitly no shell
        }
      );

      if (result.error) throw result.error;
      
      const out = result.stdout;
      console.log("Raw output:", out);

      const drives: DriveInfo[] = [];
      const lines = out.split(/\r?\n/);
      
      if (lines.length < 2) return [];
      
      // Parse CSV: DeviceID,FreeSpace,Size
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        const [deviceId, freeSpace, size] = lines[i].split(',').map(s => s.replace(/"/g, '').trim());
        
        if (deviceId && size && parseInt(size) > 0) {
          drives.push({
            root: deviceId + "\\",
            label: deviceId,
            free: parseInt(freeSpace) || 0,
            total: parseInt(size),
          });
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