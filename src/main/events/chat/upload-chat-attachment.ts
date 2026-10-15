import axios, { AxiosError } from "axios";
import { ipcMain } from "electron";

import { HydraApi } from "@main/services";
import type {
  ChatAttachmentContentType,
  ChatAttachmentReservation,
  ChatAttachmentUploadProgress,
  ChatAttachmentUploadRequest,
} from "@types";

// Friend ids are interpolated into an API path, so only hashids get through.
const FRIEND_ID_PATTERN = /^[A-Za-z0-9]{8}$/;
const UPLOAD_ID_MAX_LENGTH = 128;
const PROGRESS_STEP = 0.02;
// The upload URL expires after five minutes, so a slower upload can't succeed.
const UPLOAD_DEADLINE_MS = 5 * 60 * 1_000;
const UPLOAD_STALL_TIMEOUT_MS = 30_000;

// Mirrors the API's limits, so a file it would refuse never leaves the machine.
const MAX_BYTES: Record<ChatAttachmentContentType, number> = {
  "image/jpeg": 2 * 1024 * 1024,
  "image/png": 2 * 1024 * 1024,
  "image/gif": 8 * 1024 * 1024,
};

const isContentType = (value: unknown): value is ChatAttachmentContentType =>
  typeof value === "string" && value in MAX_BYTES;

const toErrorMessage = (error: unknown) => {
  if (error instanceof AxiosError) {
    const message = (error.response?.data as { message?: unknown } | undefined)
      ?.message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error && error.message
    ? error.message
    : "chat-attachment-upload-failed";
};

const uploadChatAttachment = async (
  event: Electron.IpcMainInvokeEvent,
  request: ChatAttachmentUploadRequest
): Promise<{ id: string }> => {
  const { friendId, uploadId, contentType, bytes } = request ?? {};
  if (
    typeof friendId !== "string" ||
    !FRIEND_ID_PATTERN.test(friendId) ||
    typeof uploadId !== "string" ||
    uploadId.length === 0 ||
    uploadId.length > UPLOAD_ID_MAX_LENGTH ||
    !isContentType(contentType) ||
    !(bytes instanceof ArrayBuffer) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_BYTES[contentType]
  ) {
    throw new Error("chat-attachment-invalid");
  }

  const size = bytes.byteLength;
  const sendProgress = (loaded: number) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send("on-chat-attachment-upload-progress", {
      uploadId,
      loaded,
      total: size,
    } satisfies ChatAttachmentUploadProgress);
  };

  try {
    const reservation = await HydraApi.post<ChatAttachmentReservation>(
      `/profile/chats/${friendId}/attachments`,
      { contentType, size }
    );

    let lastReported = 0;
    await axios.put(reservation.uploadUrl, Buffer.from(bytes), {
      headers: { "Content-Type": contentType },
      maxBodyLength: Infinity,
      timeout: UPLOAD_STALL_TIMEOUT_MS,
      signal: AbortSignal.timeout(UPLOAD_DEADLINE_MS),
      onUploadProgress: ({ loaded }) => {
        if (loaded - lastReported < size * PROGRESS_STEP && loaded < size) {
          return;
        }
        lastReported = loaded;
        sendProgress(loaded);
      },
    });
    sendProgress(size);

    return { id: reservation.id };
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
};

ipcMain.handle("uploadChatAttachment", uploadChatAttachment);
