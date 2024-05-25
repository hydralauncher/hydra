import { parentPort } from "worker_threads";
import parseTorrent from "parse-torrent";

const port = parentPort;
if (!port) throw new Error("IllegalState");

port.on("message", async (buffer: Buffer) => {
  try {
    const torrent = await parseTorrent(buffer);
    port.postMessage(torrent);
  } catch (err) {
    port.postMessage(null);
  }
});
