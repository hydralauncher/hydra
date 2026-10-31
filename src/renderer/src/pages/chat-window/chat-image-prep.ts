import {
  CHAT_GIF_MAX_BYTES,
  CHAT_IMAGE_MAX_SIDE,
  CHAT_STILL_MAX_BYTES,
  fitWithin,
  isGif,
  type ChatDraftImage,
  type ChatDraftImageError,
} from "./chat-attachments";

// JPEG has no alpha: transparent pixels land on the chat's background.
const STILL_BACKGROUND = "#121212";
const JPEG_QUALITIES = [0.85, 0.75, 0.65, 0.5];

export class ChatImagePrepError extends Error {
  constructor(readonly reason: ChatDraftImageError) {
    super(reason);
  }
}

const readSize = async (file: Blob) => {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
};

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );

/**
 * Redraws a still upright, at most CHAT_IMAGE_MAX_SIDE on its longest side, as
 * a JPEG. Redrawing also drops the file's metadata, location included.
 */
const prepareStill = async (file: File) => {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const { width, height } = fitWithin(
    bitmap.width,
    bitmap.height,
    CHAT_IMAGE_MAX_SIDE
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new ChatImagePrepError("unreadable");
  }

  context.fillStyle = STILL_BACKGROUND;
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of JPEG_QUALITIES) {
    const blob = await toJpeg(canvas, quality);
    if (blob && blob.size <= CHAT_STILL_MAX_BYTES) {
      return { blob, width, height };
    }
  }
  throw new ChatImagePrepError("too_large");
};

/** Turns a picked, pasted or dropped file into an image ready to send. */
export const prepareChatImage = async (
  file: File
): Promise<Omit<ChatDraftImage, "id" | "spoiler">> => {
  try {
    // GIFs go as they are, so they stay animated.
    if (isGif(file.type)) {
      if (file.size > CHAT_GIF_MAX_BYTES) {
        throw new ChatImagePrepError("gif_too_large");
      }
      const { width, height } = await readSize(file);
      return {
        name: file.name,
        blob: file,
        contentType: "image/gif",
        width,
        height,
        url: URL.createObjectURL(file),
      };
    }

    const { blob, width, height } = await prepareStill(file);
    return {
      name: file.name,
      blob,
      contentType: "image/jpeg",
      width,
      height,
      url: URL.createObjectURL(blob),
    };
  } catch (error) {
    if (error instanceof ChatImagePrepError) throw error;
    throw new ChatImagePrepError("unreadable");
  }
};
