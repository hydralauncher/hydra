import path from "node:path";

export const isExecutableNameExpectedForBinary = (
  executablePath: string,
  binary: { binary: string },
  platform: NodeJS.Platform = process.platform
): boolean => {
  if (platform !== "linux" || binary.binary !== "dolphin") return true;

  return path.basename(executablePath).toLowerCase() !== "dolphin";
};
