import { EpicIntegrationError } from "./auth-protocol.js";

/** Cancel queued work promptly without releasing a running credential lease. */
export function queueEpicOperation<T>(
  previous: Promise<unknown> | undefined,
  task: () => Promise<T>,
  signal?: AbortSignal
) {
  let cancel: (() => void) | undefined;
  let started = false;
  const queued = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      if (signal?.aborted)
        throw new EpicIntegrationError("operation-cancelled");
      started = true;
      if (cancel) signal?.removeEventListener("abort", cancel);
      return task();
    });
  const result = signal
    ? new Promise<T>((resolve, reject) => {
        cancel = () => {
          if (!started) reject(new EpicIntegrationError("operation-cancelled"));
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
