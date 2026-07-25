import axios, { type AxiosProgressEvent } from "axios";
import { Readable } from "node:stream";
import fs from "node:fs";
import { getAccessToken } from "./drive-oauth.js";
import { logger } from "../logger";

// Minimal typed wrapper over the Google Drive v3 REST API. We only use the
// slices the hybrid flow needs: create-file (multipart upload), download by
// id, list, delete, and set a public-anyone permission.
//
// All requests go through `authorized()` so a stale access token gets
// refreshed once and the call is retried. Anything else surfaces as an
// AxiosError to the caller.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webContentLink?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function authorized<T>(
  fn: (headers: Record<string, string>) => Promise<T>
): Promise<T> {
  const headers = await authHeaders();
  try {
    return await fn(headers);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      // Force a refresh by clearing the cached access token via a call that
      // triggers refresh (getAccessToken already re-fetches when expired).
      const retryHeaders = await authHeaders();
      return fn(retryHeaders);
    }
    throw err;
  }
}

export async function findOrCreateFolder(
  name: string,
  parentId: string | null
): Promise<string> {
  return authorized(async (headers) => {
    const query = [
      `name = '${escapeQuery(name)}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      parentId ? `'${parentId}' in parents` : "'root' in parents",
    ].join(" and ");
    const { data } = await axios.get<{ files: DriveFile[] }>(
      `${DRIVE_API}/files`,
      { headers, params: { q: query, fields: "files(id,name)" } }
    );
    if (data.files.length > 0) return data.files[0].id;
    const { data: created } = await axios.post<DriveFile>(
      `${DRIVE_API}/files`,
      {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : ["root"],
      },
      { headers: { ...headers, "Content-Type": "application/json" } }
    );
    return created.id;
  });
}

function escapeQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export interface UploadOptions {
  name: string;
  mimeType: string;
  parentId: string;
  appProperties?: Record<string, string>;
  onProgress?: (event: AxiosProgressEvent) => void;
}

export async function uploadFileFromDisk(
  filePath: string,
  opts: UploadOptions
): Promise<DriveFile> {
  const stat = fs.statSync(filePath);
  return uploadFileFromStream(fs.createReadStream(filePath), stat.size, opts);
}

export async function uploadFileFromBuffer(
  data: Buffer,
  opts: UploadOptions
): Promise<DriveFile> {
  return uploadFileFromStream(Readable.from(data), data.length, opts);
}

async function uploadFileFromStream(
  stream: Readable,
  size: number,
  opts: UploadOptions
): Promise<DriveFile> {
  return authorized(async (headers) => {
    // Multipart upload: one HTTP request with a metadata part and a media part.
    // Google's docs call this "Multipart Upload" and it's the simplest way to
    // create a file with both content and metadata in one round trip. For
    // files bigger than ~5 MB the "resumable" upload protocol is preferred,
    // but for save-game tars up to a few hundred MB multipart still works;
    // upgrade to resumable later if users hit reliability issues.
    const boundary = `----HydraDriveBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
    const metadata: Record<string, unknown> = {
      name: opts.name,
      parents: [opts.parentId],
    };
    if (opts.appProperties) metadata.appProperties = opts.appProperties;

    const preamble =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${opts.mimeType}\r\n\r\n`;
    const trailer = `\r\n--${boundary}--\r\n`;

    // Build a single Readable that chains preamble + stream + trailer.
    const composite = Readable.from(
      (async function* () {
        yield Buffer.from(preamble, "utf8");
        for await (const chunk of stream) {
          yield chunk as Buffer;
        }
        yield Buffer.from(trailer, "utf8");
      })()
    );

    const contentLength =
      Buffer.byteLength(preamble, "utf8") + size + Buffer.byteLength(trailer, "utf8");

    const { data } = await axios.post<DriveFile>(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime,modifiedTime,parents,webContentLink,webViewLink,appProperties`,
      composite,
      {
        headers: {
          ...headers,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(contentLength),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        onUploadProgress: opts.onProgress,
      }
    );
    return data;
  });
}

export async function downloadFileToDisk(
  fileId: string,
  destPath: string,
  onProgress?: (event: AxiosProgressEvent) => void
): Promise<void> {
  await authorized(async (headers) => {
    const response = await axios.get(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers,
      responseType: "stream",
      onDownloadProgress: onProgress,
    });
    const writer = fs.createWriteStream(destPath);
    await new Promise<void>((resolve, reject) => {
      response.data.pipe(writer);
      writer.on("finish", () => resolve());
      writer.on("error", reject);
      response.data.on("error", reject);
    });
  });
}

export async function downloadFileToBuffer(fileId: string): Promise<Buffer> {
  return authorized(async (headers) => {
    const { data } = await axios.get<ArrayBuffer>(
      `${DRIVE_API}/files/${fileId}?alt=media`,
      { headers, responseType: "arraybuffer" }
    );
    return Buffer.from(data);
  });
}

export async function deleteFile(fileId: string): Promise<void> {
  await authorized(async (headers) => {
    await axios.delete(`${DRIVE_API}/files/${fileId}`, {
      headers,
      validateStatus: (s) => s === 204 || s === 404,
    });
  });
}

export async function makePublic(fileId: string): Promise<string> {
  return authorized(async (headers) => {
    await axios.post(
      `${DRIVE_API}/files/${fileId}/permissions`,
      { role: "reader", type: "anyone" },
      { headers: { ...headers, "Content-Type": "application/json" } }
    );
    // Prefer `webContentLink` (direct binary) over `webViewLink` (HTML page)
    // for use in <img> tags. The public URL survives token rotation because
    // permission was set to anyone-with-link.
    const { data } = await axios.get<DriveFile>(
      `${DRIVE_API}/files/${fileId}?fields=webContentLink,webViewLink`,
      { headers }
    );
    // Google's webContentLink includes `&export=download` which forces the
    // file to be served as an attachment; strip it so browsers render inline.
    const link = data.webContentLink?.replace(/&export=download/, "") ??
      `https://drive.google.com/uc?id=${fileId}`;
    return link;
  });
}

export async function listFilesInFolder(
  parentId: string,
  extraQuery = ""
): Promise<DriveFile[]> {
  return authorized(async (headers) => {
    const q = [
      `'${parentId}' in parents`,
      "trashed = false",
      extraQuery,
    ].filter(Boolean).join(" and ");
    const { data } = await axios.get<{ files: DriveFile[] }>(
      `${DRIVE_API}/files`,
      {
        headers,
        params: {
          q,
          fields:
            "files(id,name,mimeType,size,createdTime,modifiedTime,parents,appProperties)",
          pageSize: 1000,
        },
      }
    );
    return data.files;
  });
}

export async function about(): Promise<{
  storageQuota: { limit?: string; usage?: string };
  user: { emailAddress: string; displayName: string };
} | null> {
  try {
    return await authorized(async (headers) => {
      const { data } = await axios.get(
        `${DRIVE_API}/about?fields=storageQuota,user`,
        { headers }
      );
      return data;
    });
  } catch (err) {
    logger.warn("[drive] about() failed", err);
    return null;
  }
}
