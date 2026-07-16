import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import axios from "axios";
import { app } from "electron";
import { fileTypeFromBuffer } from "file-type";

import { registerEvent } from "../register-event";

const MAX_ARTWORK_SIZE_IN_BYTES = 1024 * 1024 * 20;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const isSteamGridDbUrl = (value: string) => {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      (url.hostname === "steamgriddb.com" ||
        url.hostname.endsWith(".steamgriddb.com"))
    );
  } catch {
    return false;
  }
};

const downloadGameArtwork = async (
  _event: Electron.IpcMainInvokeEvent,
  artworkUrl: string
): Promise<string> => {
  if (!isSteamGridDbUrl(artworkUrl)) {
    throw new Error("Invalid SteamGridDB artwork URL");
  }

  const response = await axios.get<ArrayBuffer>(artworkUrl, {
    responseType: "arraybuffer",
    maxContentLength: MAX_ARTWORK_SIZE_IN_BYTES,
    maxBodyLength: MAX_ARTWORK_SIZE_IN_BYTES,
    maxRedirects: 0,
    timeout: 30_000,
  });
  const buffer = Buffer.from(response.data);

  if (!buffer.length || buffer.length > MAX_ARTWORK_SIZE_IN_BYTES) {
    throw new Error("Invalid SteamGridDB artwork size");
  }

  const fileType = await fileTypeFromBuffer(buffer);
  const extension = fileType?.mime
    ? EXTENSION_BY_MIME[fileType.mime]
    : undefined;

  if (!extension) {
    throw new Error("Unsupported SteamGridDB artwork type");
  }

  const tempFilePath = path.join(
    app.getPath("temp"),
    `hydra-temp-${randomUUID()}-steamgriddb.${extension}`
  );

  await fs.promises.writeFile(tempFilePath, buffer);

  return tempFilePath;
};

registerEvent("downloadGameArtwork", downloadGameArtwork);
