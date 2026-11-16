/**
 * Minimal reader for the Windows version resource (VS_VERSIONINFO) of a PE
 * file. It only extracts what Hydra needs to tell an original GOG Galaxy DLL
 * apart from a UniverseLAN one: the numeric file version and ProductName.
 */

const VS_VERSION_INFO_KEY = Buffer.from("VS_VERSION_INFO\0", "utf16le");
const PRODUCT_NAME_KEY = Buffer.from("ProductName\0", "utf16le");
const FIXED_FILE_INFO_SIGNATURE = 0xfeef04bd;
const FIXED_FILE_INFO_SEARCH_WINDOW = 64;
const MAX_STRING_VALUE_LENGTH = 256;

export interface PeVersionInfo {
  fileVersion: string | null;
  productName: string | null;
}

const readFixedFileVersion = (buffer: Buffer, versionInfoOffset: number) => {
  const searchStart = versionInfoOffset + VS_VERSION_INFO_KEY.length;
  const searchEnd = Math.min(
    buffer.length - 16,
    searchStart + FIXED_FILE_INFO_SEARCH_WINDOW
  );

  for (let offset = searchStart; offset <= searchEnd; offset += 2) {
    if (buffer.readUInt32LE(offset) !== FIXED_FILE_INFO_SIGNATURE) continue;

    const fileVersionMs = buffer.readUInt32LE(offset + 8);
    const fileVersionLs = buffer.readUInt32LE(offset + 12);

    return [
      fileVersionMs >>> 16,
      fileVersionMs & 0xffff,
      fileVersionLs >>> 16,
      fileVersionLs & 0xffff,
    ].join(".");
  }

  return null;
};

const readUtf16Value = (buffer: Buffer, start: number) => {
  let offset = start;

  // Skip the alignment padding between the key and its value.
  while (offset + 1 < buffer.length && buffer.readUInt16LE(offset) === 0) {
    offset += 2;
  }

  const end = Math.min(buffer.length - 1, offset + MAX_STRING_VALUE_LENGTH * 2);
  let valueEnd = offset;

  while (valueEnd < end && buffer.readUInt16LE(valueEnd) !== 0) {
    valueEnd += 2;
  }

  const value = buffer.toString("utf16le", offset, valueEnd).trim();

  return value || null;
};

export const readPeVersionInfo = (buffer: Buffer): PeVersionInfo => {
  const versionInfoOffset = buffer.lastIndexOf(VS_VERSION_INFO_KEY);

  if (versionInfoOffset === -1) {
    return { fileVersion: null, productName: null };
  }

  const productNameOffset = buffer.indexOf(PRODUCT_NAME_KEY, versionInfoOffset);

  return {
    fileVersion: readFixedFileVersion(buffer, versionInfoOffset),
    productName:
      productNameOffset === -1
        ? null
        : readUtf16Value(buffer, productNameOffset + PRODUCT_NAME_KEY.length),
  };
};
