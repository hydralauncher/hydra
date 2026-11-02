import type { EpicInstallError } from "../../../types/epic-managed.types";

export function epicManagedInstallationSupport(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch
): { available: boolean; reason?: EpicInstallError } {
  if (platform !== "win32" && platform !== "linux")
    return { available: false, reason: "unsupported-platform" };
  if (
    (architecture !== "x64" && architecture !== "arm64") ||
    (platform === "linux" && architecture !== "x64")
  )
    return { available: false, reason: "unsupported-architecture" };
  return { available: true };
}
