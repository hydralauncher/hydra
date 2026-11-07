export type QuitStepOutcome = "settled" | "timed-out";

/**
 * Waits at most `timeoutMs` for a quit step. A rejection propagates; a step
 * that never settles (for example a native shutdown blocked on disk or network
 * IO) resolves as "timed-out" so it cannot keep a half-closed process alive.
 */
export async function settleWithin(
  step: () => Promise<unknown>,
  timeoutMs: number
): Promise<QuitStepOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<QuitStepOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve()
        .then(step)
        .then((): QuitStepOutcome => "settled"),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
