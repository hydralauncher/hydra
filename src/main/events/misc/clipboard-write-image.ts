import { clipboard, nativeImage, net } from "electron";
import { registerEvent } from "../register-event";
import { logger } from "@main/services";

const SCREENSHOT_IMAGE_HOST_SUFFIX = ".r2.cloudflarestorage.com";
const MAX_CLIPBOARD_IMAGE_BYTES = 32 * 1024 * 1024;

const isScreenshotImageUrl = (imageUrl: string) => {
  try {
    const url = new URL(imageUrl);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      url.hostname.endsWith(SCREENSHOT_IMAGE_HOST_SUFFIX)
    );
  } catch {
    return false;
  }
};

const readBoundedBody = async (response: Response) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_CLIPBOARD_IMAGE_BYTES) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_CLIPBOARD_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
};

const clipboardWriteImage = async (
  _event: Electron.IpcMainInvokeEvent,
  imageUrl: string
): Promise<boolean> => {
  if (typeof imageUrl !== "string" || !isScreenshotImageUrl(imageUrl)) {
    return false;
  }

  try {
    const response = await net.fetch(imageUrl, { redirect: "error" });
    if (!response.ok) return false;
    if (!response.headers.get("content-type")?.startsWith("image/")) {
      return false;
    }

    const body = await readBoundedBody(response);
    if (!body) return false;

    const image = nativeImage.createFromBuffer(body);
    if (image.isEmpty()) return false;

    clipboard.writeImage(image);
    return true;
  } catch (error) {
    logger.error("Failed to copy image to clipboard", error);
    return false;
  }
};

registerEvent("clipboardWriteImage", clipboardWriteImage);
