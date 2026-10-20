import { clipboard, nativeImage, net } from "electron";
import { registerEvent } from "../register-event";
import { logger } from "@main/services";

const clipboardWriteImage = async (
  _event: Electron.IpcMainInvokeEvent,
  imageUrl: string
): Promise<boolean> => {
  if (!imageUrl?.startsWith("https://") && !imageUrl?.startsWith("http://")) {
    return false;
  }

  try {
    const response = await net.fetch(imageUrl);
    if (!response.ok) return false;

    const image = nativeImage.createFromBuffer(
      Buffer.from(await response.arrayBuffer())
    );
    if (image.isEmpty()) return false;

    clipboard.writeImage(image);
    return true;
  } catch (error) {
    logger.error("Failed to copy image to clipboard", error);
    return false;
  }
};

registerEvent("clipboardWriteImage", clipboardWriteImage);
