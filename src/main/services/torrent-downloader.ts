import {
  TorrentDownloader,
  TorrentSession,
  TorrentStatus,
} from "./hydra-native";
import { logger } from "./logger";

// Global torrent session - matches Python's torrent_session
let torrentSession: TorrentSession | null = null;
const torrentDownloaders = new Map<string, TorrentDownloader>();

export class TorrentDownloadService {
  private static readonly BITTORRENT_PORT = 5881;
  private static readonly UPLOAD_MODE_FLAG = 0x00000002; // upload_mode flag

  static initializeSession(port: number = this.BITTORRENT_PORT): void {
    try {
      if (!torrentSession) {
        torrentSession = new TorrentSession(port);
        logger.log("Torrent session initialized");
      }
    } catch (error) {
      logger.error("Failed to initialize torrent session", error);
      throw error;
    }
  }

  static getSession(): TorrentSession | null {
    return torrentSession;
  }

  static createDownloader(
    downloadId: string,
    uploadMode: boolean = false
  ): TorrentDownloader | null {
    try {
      if (!torrentSession) {
        this.initializeSession();
      }

      if (!torrentSession) {
        logger.error("Failed to create torrent session");
        return null;
      }

      const session = torrentSession.getSession();
      const downloader = new TorrentDownloader(session, uploadMode);
      torrentDownloaders.set(downloadId, downloader);
      return downloader;
    } catch (error) {
      logger.error(
        `Failed to create torrent downloader for ${downloadId}`,
        error
      );
      return null;
    }
  }

  static async startDownload(
    downloadId: string,
    magnet: string,
    savePath: string,
    uploadMode: boolean = false
  ): Promise<void> {
    try {
      let downloader = torrentDownloaders.get(downloadId);

      if (!downloader) {
        downloader = this.createDownloader(downloadId, uploadMode);
        if (!downloader) {
          throw new Error("Failed to create torrent downloader");
        }
      }

      downloader.startDownload(magnet, savePath);
      logger.log(`Started torrent download for ${downloadId}`);
    } catch (error) {
      logger.error(`Failed to start torrent download for ${downloadId}`, error);
      throw error;
    }
  }

  static pauseDownload(downloadId: string): void {
    try {
      const downloader = torrentDownloaders.get(downloadId);
      if (downloader) {
        downloader.pauseDownload();
        logger.log(`Paused torrent download for ${downloadId}`);
      }
    } catch (error) {
      logger.error(`Failed to pause torrent download for ${downloadId}`, error);
      throw error;
    }
  }

  static cancelDownload(downloadId: string): void {
    try {
      const downloader = torrentDownloaders.get(downloadId);
      if (downloader) {
        downloader.cancelDownload();
        torrentDownloaders.delete(downloadId);
        logger.log(`Cancelled torrent download for ${downloadId}`);
      }
    } catch (error) {
      logger.error(
        `Failed to cancel torrent download for ${downloadId}`,
        error
      );
      throw error;
    }
  }

  static getDownloadStatus(downloadId: string): TorrentStatus | null {
    try {
      const downloader = torrentDownloaders.get(downloadId);
      if (!downloader) {
        return null;
      }

      const status = downloader.getDownloadStatus();
      return status || null;
    } catch (error) {
      logger.error(
        `Failed to get torrent download status for ${downloadId}`,
        error
      );
      return null;
    }
  }
}
