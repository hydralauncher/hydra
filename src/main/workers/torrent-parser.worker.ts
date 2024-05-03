import { parentPort } from "worker_threads";
import parseTorrent from "parse-torrent";
import { getFileBuffer } from "@main/helpers";

const port = parentPort;
if (!port) throw new Error("IllegalState");

port.on("message", async (url: string) => {
  const buffer = await getFileBuffer(url);
  const torrent = await parseTorrent(buffer);

  port.postMessage(torrent);
});
