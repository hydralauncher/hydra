import path from "node:path";

export const isExecutableNameExpectedForBinary = (
  executablePath: string,
  binary: { binary: string }
): boolean => {
  if (binary.binary !== "ppsspp" && binary.binary !== "dolphin") {
    return true;
  }

  const basename =
    process.platform === "win32"
      ? path.win32.basename(executablePath)
      : path.posix.basename(executablePath);
  const normalizedName = basename.toLowerCase();

  if (!normalizedName.includes(binary.binary)) return false;

  return !(
    process.platform === "linux" &&
    binary.binary === "dolphin" &&
    normalizedName === "dolphin"
  );
};
