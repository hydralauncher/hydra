import type { EpicConnectedConnection } from "../../../types/epic-integration.types";
import type { EpicAuthContext } from "./integration-core";
import type { EpicSessionProvider } from "./session-provider";
import {
  EPIC_PLAYTIME_CACHE_MS,
  EPIC_PLAYTIME_ORIGIN,
  EPIC_SOURCE_TIMEOUT_MS,
  EPIC_SYNC_TIMEOUT_MS,
} from "./constants.js";
import { normalizeEpicPlaytime } from "./library-normalizer.js";
import { epicAbort, fetchEpicWithRetry } from "./source-retry.js";
import { EpicIntegrationError } from "./auth-protocol.js";

interface Flight {
  controller: AbortController;
  task: Promise<Map<string, number>>;
  consumers: number;
}
export class EpicPlaytimeSource {
  private cache = new Map<
    string,
    { time: number; value: Map<string, number> }
  >();
  private flights = new Map<string, Flight>();
  constructor(
    private readonly session: Pick<EpicSessionProvider, "token">,
    private readonly fetchImpl = fetch
  ) {}
  clearCache() {
    this.cache.clear();
  }
  invalidate() {
    this.clearCache();
    for (const flight of this.flights.values()) flight.controller.abort();
  }
  private consume(
    flight: Flight,
    signal: AbortSignal
  ): Promise<Map<string, number>> {
    epicAbort(signal);
    flight.consumers++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, value?: Map<string, number>) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", abort);
        if (--flight.consumers === 0) flight.controller.abort();
        if (error) reject(error);
        else resolve(new Map(value));
      };
      const abort = () =>
        finish(new EpicIntegrationError("operation-cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      void flight.task.then((value) => finish(undefined, value), finish);
      if (signal.aborted) abort();
    });
  }
  async get(
    context: EpicAuthContext,
    connection: EpicConnectedConnection,
    signal: AbortSignal,
    fresh = false
  ): Promise<Map<string, number>> {
    epicAbort(signal);
    const key = JSON.stringify([
      context.environment,
      context.userId,
      context.generation,
      connection.connectionId,
      connection.epicAccountId,
    ]);
    const previous = this.flights.get(key);
    if (previous) {
      if (!fresh) return this.consume(previous, signal);
      try {
        await this.consume(previous, signal);
      } catch {
        epicAbort(signal);
      }
    }
    epicAbort(signal);
    const cached = this.cache.get(key);
    if (!fresh && cached && Date.now() - cached.time < EPIC_PLAYTIME_CACHE_MS)
      return new Map(cached.value);
    // Another fresh consumer may have started while the previous request finished.
    const current = this.flights.get(key);
    if (current) return this.consume(current, signal);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EPIC_SYNC_TIMEOUT_MS);
    const flight: Flight = {
      controller,
      consumers: 0,
      task: Promise.resolve(new Map()),
    };
    flight.task = (async () => {
      let token = await this.session.token(
        context,
        connection,
        controller.signal
      );
      const response = await fetchEpicWithRetry(
        () =>
          this.fetchImpl(
            `${EPIC_PLAYTIME_ORIGIN}/library/api/public/playtime/account/${connection.epicAccountId}/all`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
              redirect: "error",
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(EPIC_SOURCE_TIMEOUT_MS),
              ]),
            }
          ),
        controller.signal,
        async () => {
          this.cache.delete(key);
          token = await this.session.token(
            context,
            connection,
            controller.signal,
            true
          );
        }
      );
      let input: unknown;
      try {
        input = await response.json();
      } catch {
        throw new EpicIntegrationError("invalid-response");
      }
      const value = normalizeEpicPlaytime(input, connection.epicAccountId);
      epicAbort(controller.signal);
      this.cache.set(key, { time: Date.now(), value });
      return value;
    })().finally(() => {
      clearTimeout(timer);
      if (this.flights.get(key) === flight) this.flights.delete(key);
    });
    this.flights.set(key, flight);
    return this.consume(flight, signal);
  }
}
