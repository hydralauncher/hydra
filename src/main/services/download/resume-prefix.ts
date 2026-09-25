import type { FileHandle } from "node:fs/promises";

export class ResumePrefixMismatchError extends Error {
  constructor() {
    super("The remote archive changed since the partial download was saved.");
    this.name = "ResumePrefixMismatchError";
  }
}

export async function verifyResumePrefixChunk(
  file: FileHandle,
  remoteChunk: Uint8Array,
  offset: number,
  length: number
): Promise<void> {
  const localChunk = Buffer.allocUnsafe(length);
  let bytesRead = 0;

  while (bytesRead < length) {
    const result = await file.read(
      localChunk,
      bytesRead,
      length - bytesRead,
      offset + bytesRead
    );
    if (result.bytesRead === 0) throw new ResumePrefixMismatchError();
    bytesRead += result.bytesRead;
  }

  if (!localChunk.equals(Buffer.from(remoteChunk.subarray(0, length)))) {
    throw new ResumePrefixMismatchError();
  }
}
