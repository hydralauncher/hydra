import { parentPort } from "worker_threads";
import parseTorrent from "parse-torrent";

const port = parentPort;
if (!port) throw new Error("IllegalState");

const getTorrentBuffer = (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => Buffer.from(buffer))
  );

port.on("message", async (url: string) => {
  const buffer = await getTorrentBuffer(url);
  const torrent = await parseTorrent(buffer);

  port.postMessage(torrent);
});
