import { fileTypeFromBuffer } from "file-type";
import pngToIco from "png-to-ico";
import sharp from "sharp";

export type SteamShortcutAssetFormat = "ico" | "jpeg" | "png";

export const convertSteamShortcutAsset = async (
  source: Buffer,
  format: SteamShortcutAssetFormat
): Promise<Buffer> => {
  const fileType = await fileTypeFromBuffer(source);

  if (format === "ico") {
    if (fileType?.ext === "ico") return source;

    const png = await sharp(source)
      .resize(256, 256, { fit: "cover" })
      .png()
      .toBuffer();
    return pngToIco(png);
  }

  if (format === "png") {
    if (fileType?.ext === "png") return source;
    return sharp(source, { pages: 1 }).png().toBuffer();
  }

  if (fileType?.ext === "jpg") return source;

  return sharp(source, { pages: 1 })
    .flatten({ background: "#000000" })
    .jpeg({ quality: 90 })
    .toBuffer();
};
