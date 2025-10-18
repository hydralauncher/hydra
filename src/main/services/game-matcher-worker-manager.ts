import { Worker } from "worker_threads";
import workerPath from "../workers/game-matcher-worker?modulePath";

interface WorkerMessage {
  id: string;
  data: unknown;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export type TitleHashMapping = Record<string, number[]>;

export type FormattedSteamGame = {
  id: string;
  name: string;
  formattedName: string;
};
export type FormattedSteamGamesByLetter = Record<string, FormattedSteamGame[]>;

interface DownloadToMatch {
  title: string;
  uris: string[];
  uploadDate: string;
  fileSize: string;
}

interface MatchedDownload {
  title: string;
  uris: string[];
  uploadDate: string;
  fileSize: string;
  objectIds: string[];
  usedHashMatch: boolean;
}

interface MatchResponse {
  matchedDownloads: MatchedDownload[];
  stats: {
    hashMatchCount: number;
    fuzzyMatchCount: number;
    noMatchCount: number;
  };
}

export class GameMatcherWorkerManager {
  private static worker: Worker | null = null;
  private static messageId = 0;
  private static pendingMessages = new Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();

  public static initialize() {
    if (this.worker) {
      return;
    }

    try {
      console.log(
        "[GameMatcherWorker] Initializing worker with path:",
        workerPath
      );

      this.worker = new Worker(workerPath);

      this.worker.on("message", (response: WorkerResponse) => {
        const pending = this.pendingMessages.get(response.id);
        if (pending) {
          if (response.success) {
            pending.resolve(response.result);
          } else {
            pending.reject(new Error(response.error || "Unknown error"));
          }
          this.pendingMessages.delete(response.id);
        }
      });

      this.worker.on("error", (error) => {
        console.error("[GameMatcherWorker] Worker error:", error);
        for (const [id, pending] of this.pendingMessages.entries()) {
          pending.reject(error);
          this.pendingMessages.delete(id);
        }
      });

      this.worker.on("exit", (code) => {
        if (code !== 0) {
          console.error(
            `[GameMatcherWorker] Worker stopped with exit code ${code}`
          );
        }
        this.worker = null;
        for (const [id, pending] of this.pendingMessages.entries()) {
          pending.reject(new Error("Worker exited unexpectedly"));
          this.pendingMessages.delete(id);
        }
      });

      console.log("[GameMatcherWorker] Worker initialized successfully");
    } catch (error) {
      console.error("[GameMatcherWorker] Failed to initialize worker:", error);
      throw error;
    }
  }

  private static sendMessage<T>(data: unknown): Promise<T> {
    if (!this.worker) {
      return Promise.reject(new Error("Worker not initialized"));
    }

    const id = `msg_${++this.messageId}`;
    const message: WorkerMessage = { id, data };

    return new Promise<T>((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.worker!.postMessage(message);
    });
  }

  public static async matchDownloads(
    downloads: DownloadToMatch[],
    steamGames: FormattedSteamGamesByLetter,
    titleHashMapping: TitleHashMapping
  ): Promise<MatchResponse> {
    return this.sendMessage<MatchResponse>({
      downloads,
      steamGames,
      titleHashMapping,
    });
  }

  public static terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.pendingMessages.clear();
    }
  }
}
