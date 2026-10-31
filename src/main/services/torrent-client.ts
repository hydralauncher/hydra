const DEFAULT_TORRENT_PORT = 5881;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MIN_REQUEST_TIMEOUT_MS = 1_000;

export type TorrentMethod =
  | "status"
  | "seed_status"
  | "torrent_files"
  | "action";

export interface TorrentBackend {
  initialize: (port: number) => Promise<void>;
  request: (method: string, paramsJson: string) => Promise<string>;
  shutdown: () => Promise<void>;
}

export class TorrentError extends Error {
  public readonly response: { data: { error: string } };

  constructor(
    public readonly code: string,
    message = code
  ) {
    super(message);
    this.name = "TorrentError";
    this.response = { data: { error: code } };
  }
}

export class TorrentClient {
  private initialization: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private closing = false;
  private generation = 0;
  private readonly pending = new Set<(error: Error) => void>();

  constructor(private readonly backend: TorrentBackend) {}

  public async initialize(): Promise<void> {
    if (this.shutdownPromise !== null) await this.shutdownPromise;
    this.closing = false;
    this.initialization ??= this.backend
      .initialize(DEFAULT_TORRENT_PORT)
      .catch((error) => {
        this.initialization = null;
        throw error;
      });
    await this.initialization;
  }

  public async call<T>(
    method: TorrentMethod,
    params?: unknown,
    config?: { timeout?: number }
  ): Promise<{ data: T }> {
    if (this.closing) throw new TorrentError("torrent_shutdown");
    const generation = this.generation;
    await this.initialize();
    if (this.closing || generation !== this.generation) {
      throw new TorrentError("torrent_shutdown");
    }
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        clearTimeout(timer);
        this.pending.delete(fail);
        reject(error);
      };
      const timer = setTimeout(
        () =>
          fail(
            new TorrentError(
              "torrent_timeout",
              `Torrent timeout for method '${method}'`
            )
          ),
        Math.max(
          config?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS,
          MIN_REQUEST_TIMEOUT_MS
        )
      );
      this.pending.add(fail);
      Promise.resolve()
        .then(() => this.backend.request(method, JSON.stringify(params ?? {})))
        .then((raw) => {
          if (!this.pending.has(fail)) return;
          const payload = JSON.parse(raw) as
            | { result: T }
            | { error: { code: string; message: string } };
          if ("error" in payload) {
            fail(new TorrentError(payload.error.code, payload.error.message));
          } else {
            clearTimeout(timer);
            this.pending.delete(fail);
            resolve({ data: payload.result });
          }
        })
        .catch(fail);
    });
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    this.closing = true;
    this.generation += 1;
    for (const fail of this.pending) fail(new TorrentError("torrent_shutdown"));
    this.shutdownPromise = (async () => {
      await this.initialization?.catch(() => {});
      await this.backend.shutdown();
    })().finally(() => {
      this.initialization = null;
      this.shutdownPromise = null;
    });
    return this.shutdownPromise;
  }
}
