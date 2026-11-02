import type { UmuProcessHandle } from "../umu-supervised-process";
import type { UmuStatusListener } from "../umu-launch-monitor";
import { EPIC_LINUX_LAUNCH_OBSERVATION_MS } from "./linux-runtime-constants.js";

export async function observeEpicLinuxLaunch(
  handle: UmuProcessHandle,
  options: {
    signal?: AbortSignal;
    onStatus?: UmuStatusListener;
    wasGameDetected?: () => boolean;
    hasGameProcesses(): Promise<boolean>;
  }
) {
  const failure = (code: string) => Object.assign(new Error(code), { code });
  if (options.signal?.aborted) throw failure("operation-cancelled");
  const reportFailure = async (exit: Awaited<UmuProcessHandle["exited"]>) => {
    if (
      options.signal?.aborted ||
      options.wasGameDetected?.() ||
      (exit.code === 0 && exit.signal === null)
    )
      return false;
    // Wrapper failure alone cannot establish that the actual game failed.
    // Incomplete process inspection conservatively preserves the live session.
    try {
      if (await options.hasGameProcesses()) return false;
    } catch {
      return false;
    }
    if (options.signal?.aborted || options.wasGameDetected?.()) return false;
    options.onStatus?.({
      type: "failed",
      message: "compatibility-launch-failed",
    });
    return true;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const exited = handle.exited.then((exit) => ({ exit }));
  let early: { exit: Awaited<UmuProcessHandle["exited"]> } | null;
  try {
    early = await Promise.race([
      exited,
      new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          EPIC_LINUX_LAUNCH_OBSERVATION_MS
        );
        abort = () => resolve(null);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
  }
  if (options.signal?.aborted) throw failure("operation-cancelled");
  if (early) {
    if (await reportFailure(early.exit))
      throw failure("compatibility-launch-failed");
  } else {
    void exited.then(({ exit }) => reportFailure(exit)).catch(() => undefined);
  }
}
