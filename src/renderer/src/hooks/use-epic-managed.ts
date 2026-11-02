import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EpicConnectionState,
  EpicCloudSaveState,
  EpicLocalOwner,
} from "@types";

export function useEpicManagedConnection() {
  const [connection, setConnection] = useState<EpicConnectionState | null>(
    null
  );
  const available =
    typeof globalThis.window?.electron?.getEpicGameInstallOptions ===
      "function" &&
    typeof globalThis.window?.electron?.startEpicGameDownload === "function" &&
    typeof globalThis.window?.electron?.getEpicConnection === "function" &&
    typeof globalThis.window?.electron?.onEpicConnectionChanged === "function";

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    let revision = 0;
    const stop = globalThis.window.electron.onEpicConnectionChanged?.(
      (state) => {
        revision++;
        if (!disposed) setConnection(state);
      }
    );
    void globalThis.window.electron
      .getEpicConnection?.()
      .then((state) => {
        if (!disposed && revision === 0) setConnection(state);
      })
      .catch(() => {
        if (!disposed && revision === 0) setConnection(null);
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [available]);
  const installationAvailable =
    available &&
    (connection?.managedInstallation?.available ??
      globalThis.window?.electron?.platform === "win32");
  return { available, installationAvailable, connection };
}

export function useEpicCloudSaves(
  epicObjectId: string | null,
  expectedOwner?: EpicLocalOwner
) {
  const [state, setState] = useState<EpicCloudSaveState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState(false);
  const generation = useRef(0);
  const eventRevision = useRef(0);
  const readRevision = useRef(0);
  const expectedUserId = expectedOwner?.userId;
  const expectedAccountId = expectedOwner?.epicAccountId;
  const expectedEnvironment = expectedOwner?.environment;
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const available =
    typeof globalThis.window?.electron?.getEpicCloudSaveState === "function" &&
    typeof globalThis.window?.electron?.setEpicCloudSaveSettings ===
      "function" &&
    typeof globalThis.window?.electron?.syncEpicCloudSaves === "function" &&
    typeof globalThis.window?.electron?.resolveEpicCloudSaveConflict ===
      "function" &&
    typeof globalThis.window?.electron?.onEpicCloudSaveStateChanged ===
      "function" &&
    typeof globalThis.window?.electron?.onEpicConnectionChanged === "function";
  const refresh = useCallback(async () => {
    if (!epicObjectId || !available) return;
    const current = generation.current;
    const revision = eventRevision.current;
    const request = ++readRevision.current;
    const isCurrent = () =>
      current === generation.current &&
      revision === eventRevision.current &&
      request === readRevision.current;
    setLoading(true);
    setReadError(false);
    try {
      const next =
        await globalThis.window.electron.getEpicCloudSaveState?.(epicObjectId);
      if (isCurrent()) {
        setState(next ?? null);
        setReadError(!next);
      }
    } catch {
      if (isCurrent()) {
        setState(null);
        setReadError(true);
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [epicObjectId, available]);
  useEffect(() => {
    generation.current++;
    setState(null);
    setBusy(false);
    setLoading(false);
    setReadError(false);
    if (!epicObjectId || !available) return;
    let acceptsEvents = true;
    void refresh();
    const stop = globalThis.window.electron.onEpicCloudSaveStateChanged?.(
      (next) => {
        if (acceptsEvents && next.epicObjectId === epicObjectId) {
          eventRevision.current++;
          setState(next);
          setLoading(false);
          setReadError(false);
        }
      }
    );
    const stopConnection = globalThis.window.electron.onEpicConnectionChanged?.(
      (connection) => {
        // An environment change can have identical public account identifiers.
        // Every main-process context notification invalidates pending work.
        invalidate();
        eventRevision.current++;
        setState(null);
        setBusy(false);
        setLoading(false);
        setReadError(false);
        const ownsConnection =
          connection.connection?.connected === true &&
          (!expectedUserId || connection.hydraUserId === expectedUserId) &&
          (!expectedAccountId ||
            connection.connection.epicAccountId === expectedAccountId);
        acceptsEvents =
          ownsConnection && connection.verification === "confirmed";
        setReadError(!acceptsEvents);
        if (acceptsEvents) void refresh();
      }
    );
    return () => {
      invalidate();
      acceptsEvents = false;
      stop?.();
      stopConnection?.();
    };
  }, [
    epicObjectId,
    available,
    refresh,
    invalidate,
    expectedUserId,
    expectedAccountId,
    expectedEnvironment,
  ]);

  const run = useCallback(
    async (operation: () => Promise<EpicCloudSaveState>) => {
      const current = generation.current;
      const revision = eventRevision.current;
      setBusy(true);
      try {
        const next = await operation();
        if (
          current === generation.current &&
          revision === eventRevision.current
        ) {
          eventRevision.current++;
          setState(next);
          setLoading(false);
          setReadError(false);
        }
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    []
  );
  return {
    state,
    busy: busy || state?.status === "syncing",
    loading,
    readError,
    refresh,
    run,
    available,
    getGeneration: () => generation.current,
  };
}
