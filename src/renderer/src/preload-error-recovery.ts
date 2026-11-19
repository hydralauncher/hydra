const PRELOAD_RETRY_KEY = "hydra:preload-retry-at";
const PRELOAD_RETRY_COOLDOWN_MS = 60_000;

interface PreloadErrorRecoveryOptions {
  eventTarget?: EventTarget;
  storage?: Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  now?: () => number;
}

export const installPreloadErrorRecovery = ({
  eventTarget = globalThis as EventTarget,
  storage = globalThis.sessionStorage,
  reload = () => globalThis.location.reload(),
  now = Date.now,
}: PreloadErrorRecoveryOptions = {}) => {
  const handlePreloadError = (event: Event) => {
    const lastRetry = Number(storage.getItem(PRELOAD_RETRY_KEY) ?? 0);

    if (now() - lastRetry < PRELOAD_RETRY_COOLDOWN_MS) {
      return;
    }

    storage.setItem(PRELOAD_RETRY_KEY, String(now()));
    event.preventDefault();
    reload();
  };

  eventTarget.addEventListener("vite:preloadError", handlePreloadError);

  return () => {
    eventTarget.removeEventListener("vite:preloadError", handlePreloadError);
  };
};
