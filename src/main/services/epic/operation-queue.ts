import { EpicIntegrationError } from "./auth-protocol.js";
import {
  startEpicTiming,
  withEpicTiming,
  type EpicTimingDetails,
} from "./timing.js";

/** Cancel queued work promptly without releasing a running credential lease. */
export function queueEpicOperation<T>(
  previous: Promise<unknown> | undefined,
  task: () => Promise<T>,
  signal?: AbortSignal,
  timing?: EpicTimingDetails
) {
  let cancel: (() => void) | undefined;
  let started = false;
  const wait = startEpicTiming("queue.wait", timing);
  const queued = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      if (signal?.aborted) {
        wait.end("cancelled");
        throw new EpicIntegrationError("operation-cancelled");
      }
      wait.end();
      started = true;
      if (cancel) signal?.removeEventListener("abort", cancel);
      return withEpicTiming("queue.execute", task, timing);
    });
  const result = signal
    ? new Promise<T>((resolve, reject) => {
        cancel = () => {
          if (!started) {
            wait.end("cancelled");
            reject(new EpicIntegrationError("operation-cancelled"));
          }
        };
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
        queued.then(resolve, reject).finally(() => {
          if (cancel) signal.removeEventListener("abort", cancel);
        });
      })
    : queued;
  return { queued, result };
}
