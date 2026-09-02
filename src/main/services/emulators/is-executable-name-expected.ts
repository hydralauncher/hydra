import path from "node:path";

export const isExecutableNameExpectedForBinary = (
  executablePath: string,
  binary: { binary: string },
  platform: NodeJS.Platform = process.platform
): boolean => {
  if (binary.binary !== "ppsspp" && binary.binary !== "dolphin") {
    return true;
  }

  const basename =
    platform === "win32"
      ? path.win32.basename(executablePath)
      : path.posix.basename(executablePath);
  const normalizedName = basename.toLowerCase();

  if (!normalizedName.includes(binary.binary)) return false;

  return !(
    platform === "linux" &&
    binary.binary === "dolphin" &&
    normalizedName === "dolphin"
  );
};
