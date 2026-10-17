import type { RealDebridTorrentInfo, TorBoxTorrentInfo } from "@types";
import { buildTorBoxDownloadManifest } from "./torbox-files.js";

/** RD paths start with a slash; local paths include the original torrent folder. */
export function getRealDebridFiles(info: RealDebridTorrentInfo) {
  try {
    const name = info.original_filename || info.filename;
    if (/[\\/]/.test(name))
      throw new Error("Real-Debrid returned an unsafe torrent name.");
    const manifest = buildTorBoxDownloadManifest({
      id: 0,
      name,
      files: info.files.map((file) => ({
        id: file.id,
        name: (() => {
          const relative = file.path.replace(/^\//, "");
          if (relative.startsWith("/") || relative.startsWith("\\"))
            throw new Error("Real-Debrid returned an unsafe file path.");
          return info.files.length > 1 && relative.split(/[\\/]/)[0] !== name
            ? `${name}/${relative}`
            : relative;
        })(),
        size: file.bytes,
      })),
    } as TorBoxTorrentInfo);
    return manifest.files.map((file, index) => ({
      index: file.id,
      path:
        info.files.length === 1 &&
        !/[\\/]/.test(info.files[index].path.replace(/^\//, ""))
          ? file.path.split("/").slice(1).join("/")
          : file.path,
      size: file.size,
      sourcePath: info.files[index].path,
    }));
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message.replaceAll("TorBox", "Real-Debrid")
        : "Real-Debrid returned invalid files."
    );
  }
}
