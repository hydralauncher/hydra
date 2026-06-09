import { net } from "electron";
import path from "node:path";
import { registerEvent } from "../register-event";
import { logger } from "@main/services";

const mimeTypesByExtension: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
};

const getImageDataUrl = async (
  _event: Electron.IpcMainInvokeEvent,
  imageUrl: string
): Promise<string | null> => {
  try {
    if (!imageUrl?.startsWith("http://") && !imageUrl?.startsWith("https://")) {
      return null;
    }

    const response = await net.fetch(imageUrl);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];
    const extension = path
      .extname(new URL(imageUrl).pathname)
      .toLowerCase()
      .slice(1);
    const mimeType =
      contentType && contentType.startsWith("image/")
        ? contentType
        : mimeTypesByExtension[extension] || "image/png";

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    logger.error("Failed to proxy image as data URL", { imageUrl, error });
    return null;
  }
};

registerEvent("getImageDataUrl", getImageDataUrl);
