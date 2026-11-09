import type { ChatAttachmentContentType } from "@types";

// Mirror the API's limits, so a file it would refuse is caught before upload.
export const CHAT_ATTACHMENTS_PER_MESSAGE = 4;
export const CHAT_STILL_MAX_BYTES = 2 * 1024 * 1024;
export const CHAT_GIF_MAX_BYTES = 8 * 1024 * 1024;
export const CHAT_MESSAGE_ATTACHMENTS_MAX_BYTES = 16 * 1024 * 1024;
/** Longest side of a still after it is scaled down for sending. */
export const CHAT_IMAGE_MAX_SIDE = 1568;

const SINGLE_IMAGE_MAX_SIZE = 280;
const SINGLE_IMAGE_MIN_WIDTH = 96;
const SINGLE_IMAGE_MIN_HEIGHT = 64;
const GROUP_WIDTH = 280;
const DEFAULT_ASPECT_RATIO = 16 / 9;
const PAIR_CELL_HEIGHT = 160;
const TRIO_WIDE_CELL_HEIGHT = 156;
const TRIO_CELL_HEIGHT = 104;
const QUAD_CELL_HEIGHT = 120;

/** An image in the composer, ready to send. */
export interface ChatDraftImage {
  id: string;
  name: string;
  blob: Blob;
  contentType: ChatAttachmentContentType;
  width: number;
  height: number;
  /** An object URL of `blob`, for the previews. */
  url: string;
  spoiler: boolean;
}

export type ChatDraftImageError =
  | "too_many"
  | "unsupported"
  | "gif_too_large"
  | "too_large"
  | "unreadable";

export const isGif = (type: string) => type === "image/gif";

/**
 * The files to add to a composer that already holds `heldCount` images:
 * images only, up to the per-message count. `error` says why any were left
 * out.
 */
export const selectImageFiles = <T extends { type: string }>(
  files: T[],
  heldCount: number
): { files: T[]; error: ChatDraftImageError | null } => {
  const images = files.filter((file) => file.type.startsWith("image/"));
  const room = Math.max(CHAT_ATTACHMENTS_PER_MESSAGE - heldCount, 0);

  if (images.length > room) {
    return { files: images.slice(0, room), error: "too_many" };
  }
  return {
    files: images,
    error: images.length < files.length ? "unsupported" : null,
  };
};

/** Whether `size` more bytes still fit in one message with `held`. */
export const fitsMessageBudget = (held: { blob: Blob }[], size: number) =>
  held.reduce((total, image) => total + image.blob.size, 0) + size <=
  CHAT_MESSAGE_ATTACHMENTS_MAX_BYTES;

/** Scales `width` × `height` down so neither side exceeds `maxSide`. */
export const fitWithin = (width: number, height: number, maxSide: number) => {
  const scale = Math.min(maxSide / width, maxSide / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export interface ChatImageCell {
  height: number;
  /** Spans both columns. */
  isWide: boolean;
}

export interface ChatImageLayout {
  width: number;
  columns: 1 | 2;
  cells: ChatImageCell[];
}

/**
 * How a message's images sit in the bubble: one keeps its shape, two to four
 * fill a fixed-width grid, with the first of three spanning the top.
 */
export const getChatImageLayout = (
  sizes: { width: number | null; height: number | null }[]
): ChatImageLayout => {
  if (sizes.length <= 1) {
    const { width, height } = sizes[0] ?? { width: null, height: null };
    const fitted =
      width && height
        ? fitWithin(width, height, SINGLE_IMAGE_MAX_SIZE)
        : {
            width: SINGLE_IMAGE_MAX_SIZE,
            height: Math.round(SINGLE_IMAGE_MAX_SIZE / DEFAULT_ASPECT_RATIO),
          };

    return {
      width: Math.max(fitted.width, SINGLE_IMAGE_MIN_WIDTH),
      columns: 1,
      cells: [
        {
          height: Math.max(fitted.height, SINGLE_IMAGE_MIN_HEIGHT),
          isWide: false,
        },
      ],
    };
  }

  if (sizes.length === 2) {
    return {
      width: GROUP_WIDTH,
      columns: 2,
      cells: sizes.map(() => ({ height: PAIR_CELL_HEIGHT, isWide: false })),
    };
  }

  if (sizes.length === 3) {
    return {
      width: GROUP_WIDTH,
      columns: 2,
      cells: [
        { height: TRIO_WIDE_CELL_HEIGHT, isWide: true },
        { height: TRIO_CELL_HEIGHT, isWide: false },
        { height: TRIO_CELL_HEIGHT, isWide: false },
      ],
    };
  }

  return {
    width: GROUP_WIDTH,
    columns: 2,
    cells: sizes.map(() => ({ height: QUAD_CELL_HEIGHT, isWide: false })),
  };
};

/** Bytes sent over bytes to send, across every image of a message. */
export const getUploadProgress = (loaded: number[], sizes: number[]) => {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total === 0) return 0;

  const sent = loaded.reduce(
    (sum, bytes, index) => sum + Math.min(bytes, sizes[index] ?? 0),
    0
  );
  return Math.min(sent / total, 1);
};
