import { useCallback, useEffect, useRef, useState } from "react";
import { getEpicGameUpdate } from "@shared";
import type {
  EpicGameInstallOption,
  EpicManagedOperationResult,
  LibraryGame,
} from "@types";

/**
 * Compares the installed Epic build with the published one. Opening the page
 * reuses the main process's cached install preview, so no extra Epic request
 * is made while that preview is warm.
 */
export function useEpicGameUpdate(game: LibraryGame | null, enabled: boolean) {
  const [update, setUpdate] = useState<EpicGameInstallOption | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const generation = useRef(0);
  const requestId = useRef<string | null>(null);
  const installation = game?.epicInstallation;
  const objectId =
    enabled &&
    game?.shop === "epic" &&
    !game.isDeleted &&
    !!game.executablePath &&
    !!installation
      ? game.objectId
      : null;
  const artifactId = installation?.artifactId;
  const platform = installation?.platform;

  const cancelRequest = useCallback(() => {
    const current = requestId.current;
    requestId.current = null;
    if (current)
      void window.electron
        .cancelEpicGameInstallOptions?.(current)
        .catch(() => {});
  }, []);

  const invalidate = useCallback(() => {
    generation.current++;
    cancelRequest();
  }, [cancelRequest]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    cancelRequest();
    if (
      !objectId ||
      !artifactId ||
      !platform ||
      typeof window.electron.getEpicGameInstallOptions !== "function" ||
      typeof window.electron.startEpicGameUpdate !== "function"
    ) {
      setUpdate(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const id = globalThis.crypto.randomUUID();
    requestId.current = id;
    try {
      const result = await window.electron.getEpicGameInstallOptions(
        objectId,
        id
      );
      if (generation.current !== current) return;
      // Opening a page never reports Epic errors; Play keeps working as before.
      setConnectionId(result?.connectionId ?? null);
      setUpdate(
        result && !result.error
          ? getEpicGameUpdate(result.options, { artifactId, platform })
          : null
      );
    } catch {
      if (generation.current === current) setUpdate(null);
    } finally {
      if (requestId.current === id) requestId.current = null;
      if (generation.current === current) setChecking(false);
    }
  }, [objectId, artifactId, platform, cancelRequest]);

  useEffect(() => {
    void refresh();
    if (!objectId) return;
    const stop = window.electron.onEpicConnectionChanged?.(() => {
      void refresh();
    });
    return () => {
      invalidate();
      stop?.();
    };
  }, [objectId, refresh, invalidate]);

  const start = useCallback(
    async (addToQueueOnly = false): Promise<EpicManagedOperationResult> => {
      if (!objectId || !update || !connectionId)
        return { ok: false, error: "stale-connection" };
      if (starting) return { ok: false, error: "operation-in-progress" };
      setStarting(true);
      try {
        const response = await window.electron.startEpicGameUpdate?.({
          epicObjectId: objectId,
          connectionId,
          artifactId: update.artifactId,
          platform: update.platform,
          ...(update.preparationId
            ? { preparationId: update.preparationId }
            : {}),
          addToQueueOnly,
        });
        return response ?? { ok: false, error: "api-unavailable" };
      } catch {
        return { ok: false, error: "process-failed" };
      } finally {
        setStarting(false);
      }
    },
    [objectId, update, connectionId, starting]
  );

  return { update, checking, starting, start, refresh };
}
