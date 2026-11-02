import { existsSync } from "node:fs";

export const requireRetroArchExecutablePath = (
  executablePath: string | null
): string => {
  if (!executablePath) {
    throw new Error("cloud_save_retroarch_not_configured");
  }
  if (!existsSync(executablePath)) {
    throw new Error("cloud_save_retroarch_executable_missing");
  }
  return executablePath;
};
