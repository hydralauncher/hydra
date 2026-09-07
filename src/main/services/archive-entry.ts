import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ArchiveEntry {
  name: string;
  size: number;
  encrypted?: boolean;
}

export const listArchiveEntries = async (
  binaryPath: string,
  archivePath: string
): Promise<ArchiveEntry[]> => {
  const { stdout } = await execFileAsync(
    binaryPath,
    ["l", "-slt", "-ba", "-sccUTF-8", "-p-", "--", archivePath],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    }
  );
  return stdout.split(/\r?\n\r?\n/).flatMap((block) => {
    const fields = new Map(
      block.split(/\r?\n/).map((line) => {
        const separator = line.indexOf(" = ");
        return [line.slice(0, separator), line.slice(separator + 3)];
      })
    );
    const name = fields.get("Path");
    const size = Number(fields.get("Size"));
    if (
      !name ||
      fields.get("Folder") === "+" ||
      fields.get("Attributes")?.includes("D") ||
      !Number.isSafeInteger(size) ||
      size < 0
    )
      return [];
    return [
      {
        name,
        size,
        ...(fields.get("Encrypted") === "+" ? { encrypted: true } : {}),
      },
    ];
  });
};

// Read to stdout so archive paths can never create files on disk.
export const readArchiveEntry = async (
  binaryPath: string,
  archivePath: string,
  entryName: string,
  maxBytes: number
): Promise<Buffer> => {
  const { stdout } = await execFileAsync(
    binaryPath,
    ["x", "-so", "-spd", "-p-", `-i!${entryName}`, "--", archivePath],
    {
      encoding: "buffer",
      maxBuffer: maxBytes,
      timeout: 30_000,
      windowsHide: true,
    }
  );
  return stdout;
};
