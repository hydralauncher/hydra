import fs from "node:fs";

const DOS_SIGNATURE = 0x5a4d; // "MZ"
const PE_SIGNATURE = 0x00004550; // "PE\0\0"
const IMAGE_FILE_MACHINE_I386 = 0x014c;
const IMAGE_FILE_MACHINE_AMD64 = 0x8664;

export const detectExecutableArchitecture = async (
  exePath: string
): Promise<"32" | "64" | null> => {
  let handle: fs.promises.FileHandle | null = null;

  try {
    handle = await fs.promises.open(exePath, "r");

    const dosHeader = Buffer.alloc(64);
    await handle.read(dosHeader, 0, dosHeader.length, 0);

    if (dosHeader.readUInt16LE(0) !== DOS_SIGNATURE) return null;

    const peHeaderOffset = dosHeader.readUInt32LE(0x3c);

    const peHeader = Buffer.alloc(6);
    await handle.read(peHeader, 0, peHeader.length, peHeaderOffset);

    if (peHeader.readUInt32LE(0) !== PE_SIGNATURE) return null;

    const machine = peHeader.readUInt16LE(4);

    if (machine === IMAGE_FILE_MACHINE_AMD64) return "64";
    if (machine === IMAGE_FILE_MACHINE_I386) return "32";

    return null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
};
