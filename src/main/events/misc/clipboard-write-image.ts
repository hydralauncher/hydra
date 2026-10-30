import { clipboard, nativeImage, net } from "electron";
import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { buildUserScreenshotPath } from "@shared";
import type { ProfileScreenshot } from "@types";

const MAX_CLIPBOARD_IMAGE_BYTES = 32 * 1024 * 1024;

const isFetchableImageUrl = (imageUrl: string) => {
  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:" && url.port === "";
  } catch {
    return false;
  }
};

const resolveScreenshotImageUrl = async (
  ownerId: string,
  screenshotId: string
) => {
  const screenshot = await HydraApi.get<ProfileScreenshot>(
    buildUserScreenshotPath(ownerId, screenshotId),
    undefined,
    { needsAuth: HydraApi.isLoggedIn() }
  );
  return screenshot?.imageUrl ?? null;
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
  ownerId: string,
  screenshotId: string
): Promise<boolean> => {
  if (typeof ownerId !== "string" || typeof screenshotId !== "string") {
    return false;
  }

  try {
    const imageUrl = await resolveScreenshotImageUrl(ownerId, screenshotId);
    if (!imageUrl || !isFetchableImageUrl(imageUrl)) return false;

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
