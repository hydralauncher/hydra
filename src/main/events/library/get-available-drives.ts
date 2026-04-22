import { execSync } from "node:child_process";
import { registerEvent } from "../register-event";

interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

const getAvailableDrives = async (): Promise<DriveInfo[]> => {
  if (process.platform === "win32") {
    try {
      const out = execSync(
        "wmic logicaldisk get DeviceID,FreeSpace,Size,VolumeName /format:csv",
        { encoding: "utf8" }
      );
      const lines = out.trim().split(/\r?\n/).filter(Boolean).slice(1);
      return lines
        .map((line) => {
          const [, deviceId, free, size, label] = line.split(",");
          return {
            root: deviceId?.trim() + "\\",
            label: label?.trim() || deviceId?.trim(),
            free: parseInt(free?.trim() || "0") || 0,
            total: parseInt(size?.trim() || "0") || 0,
          };
        })
        .filter((d) => d.total > 0);
    } catch {
      return [];
    }
  }
  // Linux/macOS — parse df output
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync("df -Pk", { encoding: "utf8" });
    const lines = out.trim().split("\n").slice(1);
    return lines
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        const mountpoint = parts[parts.length - 1];
        const total = parseInt(parts[1]) * 1024;
        const free = parseInt(parts[3]) * 1024;
        return { root: mountpoint, label: mountpoint, free, total };
      })
      .filter((d) => d.root.startsWith("/") && d.total > 0)
      .slice(0, 8);
  } catch {
    return [];
  }
};

registerEvent("getAvailableDrives", getAvailableDrives);
