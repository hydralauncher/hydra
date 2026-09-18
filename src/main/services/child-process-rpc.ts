import type { Readable } from "node:stream";

export type RpcResponseEnvelope<T = unknown> =
  | {
      id: number;
      result: T;
    }
  | {
      id: number;
      error: {
        code: string;
        message: string;
      };
    };

export interface PendingRpcRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export const logReadable = (
  readable: Readable | null,
  log: (chunk: string) => void
): void => {
  if (!readable) return;

  readable.setEncoding("utf-8");
  readable.on("data", log);
};

/**
 * Both RPC children answer with newline-delimited JSON, so chunks have to be
 * reassembled into whole lines before the payload can be parsed.
 */
export const createStdoutLineBuffer = (onLine: (line: string) => void) => {
  let buffer = "";

  return {
    reset(): void {
      buffer = "";
    },
    append(chunk: string): void {
      buffer += chunk;

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        onLine(rawLine);
        newlineIndex = buffer.indexOf("\n");
      }
    },
  };
};

export const rejectPendingRequests = (
  pendingRequests: Map<number, PendingRpcRequest>,
  error: unknown
): void => {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  pendingRequests.clear();
};

/**
 * Tracks the "child process signalled ready" handshake: `reset` arms a new
 * promise before spawn, `markReady` resolves it, `clear` drops it once the
 * process is gone.
 */
export class ReadyState {
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolver: (() => void) | null = null;
  private readyRejecter: ((error: unknown) => void) | null = null;

  public isReady(): boolean {
    return this.ready;
  }

  public markReady(): void {
    if (this.ready) return;

    this.ready = true;
    if (this.readyResolver) {
      this.readyResolver();
    }

    this.readyResolver = null;
    this.readyRejecter = null;
  }

  public reset(): void {
    this.ready = false;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });
  }

  public rejectIfNotReady(error: unknown): void {
    if (this.readyRejecter && !this.ready) {
      this.readyRejecter(error);
    }
  }

  public clear(): void {
    this.readyPromise = null;
    this.readyResolver = null;
    this.readyRejecter = null;
    this.ready = false;
  }

  public async wait(
    timeoutMs: number,
    notRunningMessage: string,
    timeoutMessage: string
  ): Promise<void> {
    if (this.ready) return;

    if (this.readyPromise === null) {
      throw new Error(notRunningMessage);
    }

    await Promise.race([
      this.readyPromise,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  }
}
