import fs from "node:fs";
import path from "node:path";

export const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

export const isLinuxShellScript = (executablePath: string) =>
  path.extname(executablePath).toLowerCase() === ".sh";

export const isElfBinary = (executablePath: string): boolean => {
  try {
    const fd = fs.openSync(executablePath, "r");
    try {
      const header = Buffer.alloc(4);
      const bytesRead = fs.readSync(fd, header, 0, 4, 0);
      return bytesRead === 4 && header.equals(ELF_MAGIC);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
};

export const isLinuxNativeExecutable = (executablePath: string): boolean => {
  if (process.platform !== "linux") return false;
  if (path.extname(executablePath).toLowerCase() === ".exe") return false;
  if (isLinuxShellScript(executablePath)) return true;
  return isElfBinary(executablePath);
};
