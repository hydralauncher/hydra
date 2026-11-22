import type { RecompilationReleaseAsset } from "@types";

const isLinux = () => window.electron.platform === "linux";

/** A Windows build picked on Linux, which Hydra runs through Proton. */
export const isProtonAsset = (asset: RecompilationReleaseAsset | null) =>
  isLinux() && asset?.os === "windows";

export const isProtonInstall = (executablePath: string | null | undefined) =>
  isLinux() && Boolean(executablePath?.toLowerCase().endsWith(".exe"));
