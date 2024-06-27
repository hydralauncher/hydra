import fs from "node:fs";
import path from "node:path";
import { Game } from "@main/entity";
import { RealDebridClient } from "../real-debrid";
import axios, { AxiosProgressEvent } from "axios";
import { gameRepository } from "@main/repository";
import { calculateETA } from "./helpers";
import { DownloadProgress } from "@types";

export class RealDebridDownloader {
  private static downloadingGame: Game | null = null;

  private static realDebridTorrentId: string | null = null;
  private static lastProgressEvent: AxiosProgressEvent | null = null;
  private static abortController: AbortController | null = null;

  private static async getRealDebridDownloadUrl() {
    if (this.realDebridTorrentId) {
      const torrentInfo = await RealDebridClient.getTorrentInfo(
        this.realDebridTorrentId
      );

      const { status, links } = torrentInfo;

      if (status === "waiting_files_selection") {
        await RealDebridClient.selectAllFiles(this.realDebridTorrentId);
        return null;
      }

      if (status === "downloaded") {
        const [link] = links;
        const { download } = await RealDebridClient.unrestrictLink(link);
        return decodeURIComponent(download);
      }
    }

    return null;
  }

  public static async getStatus() {
    if (this.lastProgressEvent) {
      await gameRepository.update(
        { id: this.downloadingGame!.id },
        {
          bytesDownloaded: this.lastProgressEvent.loaded,
          fileSize: this.lastProgressEvent.total,
          progress: this.lastProgressEvent.progress,
          status: "active",
        }
      );

      const progress = {
        numPeers: 0,
        numSeeds: 0,
        downloadSpeed: this.lastProgressEvent.rate,
        timeRemaining: calculateETA(
          this.lastProgressEvent.total ?? 0,
          this.lastProgressEvent.loaded,
          this.lastProgressEvent.rate ?? 0
        ),
        isDownloadingMetadata: false,
        isCheckingFiles: false,
        progress: this.lastProgressEvent.progress,
        gameId: this.downloadingGame!.id,
      } as DownloadProgress;

      if (this.lastProgressEvent.progress === 1) {
        this.pauseDownload();
      }

      return progress;
    }

    if (this.realDebridTorrentId && this.downloadingGame) {
      const torrentInfo = await RealDebridClient.getTorrentInfo(
        this.realDebridTorrentId
      );

      const { status } = torrentInfo;

      if (status === "downloaded") {
        this.startDownload(this.downloadingGame);
      }

      const progress = torrentInfo.progress / 100;
      const totalDownloaded = progress * torrentInfo.bytes;

      return {
        numPeers: 0,
        numSeeds: torrentInfo.seeders,
        downloadSpeed: torrentInfo.speed,
        timeRemaining: calculateETA(
          torrentInfo.bytes,
          totalDownloaded,
          torrentInfo.speed
        ),
        isDownloadingMetadata: status === "magnet_conversion",
      } as DownloadProgress;
    }

    return null;
  }

  static async pauseDownload() {
    if (this.abortController) {
      this.abortController.abort();
    }

    this.abortController = null;
    this.realDebridTorrentId = null;
    this.lastProgressEvent = null;
    this.downloadingGame = null;
  }

  static async startDownload(game: Game) {
    this.realDebridTorrentId = await RealDebridClient.getTorrentId(game!.uri!);
    this.downloadingGame = game;

    const downloadUrl = await this.getRealDebridDownloadUrl();

    if (downloadUrl) {
      this.realDebridTorrentId = null;
      this.abortController = new AbortController();

      const response = await axios.get(downloadUrl, {
        responseType: "stream",
        signal: this.abortController.signal,
        onDownloadProgress: (progressEvent) => {
          this.lastProgressEvent = progressEvent;
        },
      });

      const filename = path.win32.basename(downloadUrl);

      const downloadPath = path.join(game.downloadPath!, filename);

      await gameRepository.update(
        { id: this.downloadingGame.id },
        { folderName: filename }
      );

      response.data.pipe(fs.createWriteStream(downloadPath));
    }
  }

  static async cancelDownload() {
    return this.pauseDownload();
  }
}
