import { createParser } from "eventsource-parser";
import { UserNotLoggedInError } from "@shared";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { friendRequestEvent } from "./events/friend-request";
import { friendGameSessionEvent } from "./events/friend-game-session";
import { friendPresenceEvent } from "./events/friend-presence";
import { notificationEvent } from "./events/notification";
import { resyncAfterReconnect } from "./resync";
import type {
  FriendGameSession,
  FriendPresence,
  FriendRequest,
  Notification,
} from "./types";

export class SSEClient {
  private static readonly initialReconnectDelay = 1_000;
  private static readonly maxReconnectDelay = 30_000;
  private static readonly droppedStreamReconnectSpread = 30_000;
  /* Server heartbeats every 20s; 60s without a single byte means the
     connection is dead even if the socket still looks open. */
  private static readonly stallTimeout = 60_000;

  /* Every connect() bumps the epoch so stale run loops (possibly parked on a
     backoff sleep) notice they were superseded and exit instead of racing the
     new loop — the bug that permanently stalled the old WS client. */
  private static epoch = 0;
  private static masterAbort: AbortController | null = null;
  /* Whatever the run loop is currently blocked on (in-flight attempt or
     backoff sleep). reconnectNow() aborts it so the SAME loop re-mints and
     reconnects — tearing the loop down via connect() would reset
     hasConnectedBefore and skip the post-reconnect resync. */
  private static currentAttemptAbort: AbortController | null = null;
  private static forceReconnectRequested = false;

  static connect() {
    this.close();

    this.masterAbort = new AbortController();
    void this.runLoop(this.epoch, this.masterAbort.signal);
  }

  static close() {
    this.epoch++;
    this.masterAbort?.abort();
    this.masterAbort = null;
    this.forceReconnectRequested = false;
  }

  /* Forces an immediate reconnect (e.g. on OS resume); no-op while idle.
     Only the current attempt/backoff is aborted — the run loop survives so
     resyncAfterReconnect() still fires when the stream comes back. */
  static reconnectNow() {
    if (!this.masterAbort) return;

    this.forceReconnectRequested = true;
    this.currentAttemptAbort?.abort();
  }

  private static async runLoop(epoch: number, signal: AbortSignal) {
    let attempt = 0;
    let hasConnectedBefore = false;

    while (epoch === this.epoch && !signal.aborted) {
      if (this.forceReconnectRequested) {
        this.forceReconnectRequested = false;
        attempt = 0;
      }

      const attemptAbort = new AbortController();
      const abortAttempt = () => attemptAbort.abort();
      signal.addEventListener("abort", abortAttempt, { once: true });
      this.currentAttemptAbort = attemptAbort;

      let reconnectRequested = false;
      let streamedThisAttempt = false;

      try {
        reconnectRequested = await this.streamOnce(attemptAbort, () => {
          attempt = 0;
          streamedThisAttempt = true;

          if (hasConnectedBefore) {
            void resyncAfterReconnect(attemptAbort.signal);
          }

          hasConnectedBefore = true;
        });
      } catch (err) {
        if (err instanceof UserNotLoggedInError) {
          logger.info("SSE connect skipped: user is not logged in");

          /* Leave the client genuinely idle so reconnectNow() no-ops until
             the next connect() — without this, masterAbort lingers and an OS
             resume would launch a futile mint attempt. */
          if (epoch === this.epoch) {
            this.masterAbort = null;
            this.forceReconnectRequested = false;
          }

          return;
        }

        if (!attemptAbort.signal.aborted) {
          logger.error("SSE stream error:", err);
        }
      } finally {
        signal.removeEventListener("abort", abortAttempt);
        attemptAbort.abort();

        if (this.currentAttemptAbort === attemptAbort) {
          this.currentAttemptAbort = null;
        }
      }

      if (epoch !== this.epoch || signal.aborted) return;

      if (reconnectRequested || this.forceReconnectRequested) {
        this.forceReconnectRequested = false;
        attempt = 0;
        continue;
      }

      attempt++;
      const delay = streamedThisAttempt
        ? this.getDroppedStreamReconnectDelay()
        : this.getReconnectDelay(attempt);

      logger.info(`SSE reconnecting in ${Math.round(delay / 1000)}s...`);

      /* The backoff sleep must also be cut short by reconnectNow(), so it
         gets its own controller linked to the master signal. */
      const sleepAbort = new AbortController();
      const abortSleep = () => sleepAbort.abort();
      signal.addEventListener("abort", abortSleep, { once: true });
      this.currentAttemptAbort = sleepAbort;

      await this.sleep(delay, sleepAbort.signal);

      signal.removeEventListener("abort", abortSleep);

      if (this.currentAttemptAbort === sleepAbort) {
        this.currentAttemptAbort = null;
      }
    }
  }

  /**
   * Runs a single connection attempt: mints a stream token, opens the SSE
   * stream and pumps it until it ends or is aborted. Returns true when the
   * server asked for an immediate reconnect (pre-deploy drain).
   */
  private static async streamOnce(
    attemptAbort: AbortController,
    onFirstBytes: () => void
  ) {
    const { token } = await HydraApi.post<{ token: string }>("/auth/stream");

    let reconnectRequested = false;
    let stallTimer: NodeJS.Timeout | null = null;

    try {
      const response = await fetch(
        `${import.meta.env.MAIN_VITE_API_URL}/realtime/events`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: attemptAbort.signal,
        }
      );

      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`SSE request failed with status ${response.status}`);
      }

      const parser = createParser({
        onEvent: (event) => {
          if (event.event === "reconnect") {
            reconnectRequested = true;
            attemptAbort.abort();
            return;
          }

          this.dispatchEvent(event.event, event.data);
        },
      });

      /* Heartbeats are SSE comments and never reach onEvent, so the watchdog
         must be fed by raw bytes, not by parsed events. */
      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);

        stallTimer = setTimeout(() => {
          logger.warn("SSE stream stalled, aborting attempt");
          attemptAbort.abort();
        }, this.stallTimeout);
      };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let receivedBytes = false;

      resetStallTimer();

      let chunk = await reader.read();

      while (!chunk.done) {
        resetStallTimer();

        if (!receivedBytes) {
          receivedBytes = true;
          logger.info("SSE connected");
          onFirstBytes();
        }

        parser.feed(decoder.decode(chunk.value, { stream: true }));

        chunk = await reader.read();
      }

      logger.warn("SSE stream ended by server");
    } catch (err) {
      if (!reconnectRequested) throw err;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }

    return reconnectRequested;
  }

  private static dispatchEvent(eventName: string | undefined, data: string) {
    try {
      switch (eventName) {
        case "friendRequest":
          friendRequestEvent(JSON.parse(data) as FriendRequest).catch((err) =>
            logger.error("Failed to handle friendRequest event:", err)
          );
          break;
        case "friendGameSession":
          friendGameSessionEvent(JSON.parse(data) as FriendGameSession).catch(
            (err) =>
              logger.error("Failed to handle friendGameSession event:", err)
          );
          break;
        case "friendPresence":
          friendPresenceEvent(JSON.parse(data) as FriendPresence);
          break;
        case "notification":
          notificationEvent(JSON.parse(data) as Notification);
          break;
        default:
          /* "connected" and any events added later need no client action */
          break;
      }
    } catch (err) {
      logger.error(`Failed to parse SSE ${eventName} event:`, err);
    }
  }

  private static getDroppedStreamReconnectDelay() {
    return (
      this.initialReconnectDelay +
      Math.random() * this.droppedStreamReconnectSpread
    );
  }

  private static getReconnectDelay(attempt: number) {
    const exponential = Math.min(
      this.initialReconnectDelay * 2 ** (attempt - 1),
      this.maxReconnectDelay
    );

    /* Random point in [exponential / 2, exponential] so simultaneous clients
       don't reconnect in lockstep */
    return exponential / 2 + Math.random() * (exponential / 2);
  }

  private static sleep(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }

      const onAbort = () => {
        clearTimeout(timeout);
        resolve();
      };

      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
