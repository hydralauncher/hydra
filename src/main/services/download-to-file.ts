import fs from "node:fs";
import path from "node:path";

import axios from "axios";

const PROGRESS_EMIT_BYTES = 512 * 1024;

export const downloadToFile = async (
  url: string,
  dest: string,
  onProgress: (loaded: number, total: number | null) => void
): Promise<{ lastModified: string | null }> => {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });

  const response = await axios.get(url, {
    responseType: "stream",
    headers: { "User-Agent": "HydraLauncher" },
  });

  const lengthHeader = Number(response.headers["content-length"]);
  const total = Number.isFinite(lengthHeader) ? lengthHeader : null;
  const lastModified = response.headers["last-modified"] ?? null;
  let received = 0;
  let lastEmit = 0;

  const writer = fs.createWriteStream(dest);

  await new Promise<void>((resolve, reject) => {
    response.data.on("data", (chunk: Buffer) => {
      received += chunk.length;
      const done = total !== null && received >= total;
      if (received - lastEmit >= PROGRESS_EMIT_BYTES || done) {
        lastEmit = received;
        onProgress(received, total);
      }
    });
    response.data.on("error", reject);
    writer.on("error", reject);
    writer.on("close", resolve);
    response.data.pipe(writer);
  });

  return { lastModified };
};
