import psList from "ps-list";
import path from "node:path";
import childProcess from "node:child_process";
import { promisify } from "node:util";

const TEN_MEGABYTES = 1000 * 1000 * 10;
const execFile = promisify(childProcess.execFile);

export const getProcesses = async (isPackaged: boolean) => {
  if (process.platform == "win32") {
    const binaryPath = isPackaged
      ? path.join(process.resourcesPath, "fastlist.exe")
      : path.join(__dirname, "..", "..", "resources", "fastlist.exe");

    const { stdout } = await execFile(binaryPath, {
      maxBuffer: TEN_MEGABYTES,
      windowsHide: true,
    });

    return stdout
      .trim()
      .split("\r\n")
      .map((line) => line.split("\t"))
      .map(([pid, ppid, name]) => ({
        pid: Number.parseInt(pid, 10),
        ppid: Number.parseInt(ppid, 10),
        name,
      }));
  } else {
    return psList();
  }
};
