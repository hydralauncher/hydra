import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MACHINE_GUID_PATTERN = /MachineGuid\s+REG_SZ\s+(\S+)/;

const readWindowsMachineGuid = async () => {
  const { stdout } = await execFileAsync(
    "reg.exe",
    [
      "query",
      String.raw`HKLM\SOFTWARE\Microsoft\Cryptography`,
      "/v",
      "MachineGuid",
      "/reg:64",
    ],
    { windowsHide: true }
  );
  return MACHINE_GUID_PATTERN.exec(stdout)?.[1] ?? null;
};

const readMacHardwareUuid = async () => {
  const { stdout } = await execFileAsync("ioreg", [
    "-rd1",
    "-c",
    "IOPlatformExpertDevice",
  ]);
  const match = /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]+)"/.exec(stdout);
  return match ? match[1].replaceAll("-", "").toLowerCase() : null;
};

export const readDuckStationMachineKey = async (): Promise<Buffer | null> => {
  try {
    if (process.platform === "win32") {
      const guid = await readWindowsMachineGuid();
      return guid
        ? Buffer.concat([Buffer.from(guid, "latin1"), Buffer.from([0])])
        : null;
    }

    if (process.platform === "linux") {
      const machineId = await fs.promises.readFile("/etc/machine-id");
      return machineId.length > 0 ? machineId : null;
    }

    if (process.platform === "darwin") {
      const uuid = await readMacHardwareUuid();
      return uuid ? Buffer.from(uuid, "latin1") : null;
    }
  } catch {
    return null;
  }

  return null;
};
