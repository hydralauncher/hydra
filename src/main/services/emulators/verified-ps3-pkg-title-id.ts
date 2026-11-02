import { promises as fs } from "node:fs";

import { normalize } from "./sku-normalize.js";

/** Only the PKG header's content ID is authoritative for Cloud Save. */
export const readVerifiedPs3PkgTitleId = async (
  pkgPath: string
): Promise<string | null> => {
  const file = await fs.open(pkgPath, "r").catch(() => null);
  if (!file) return null;
  try {
    const header = Buffer.alloc(0x80);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead < 0x54 || header.readUInt32BE(0) !== 0x7f504b47) return null;
    const contentId = header.subarray(0x30, 0x30 + 36).toString("latin1");
    const match = /[A-Z]{4}\d{5}/.exec(contentId);
    return match ? normalize(match[0]) : null;
  } finally {
    await file.close();
  }
};
