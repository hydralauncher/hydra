import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSelector } from "./redux";
import {
  afterEpicInstallReadyPaint,
  epicInstallTiming,
} from "../helpers/epic-install-timing";
import type {
  EpicGameInstallOptions,
  EpicSaveError,
  LibraryGame,
} from "@types";

export function useEpicInstall(
  game: LibraryGame | null,
  onStarted: () => void
) {
  const downloadsPath = useAppSelector(
    (state) => state.userPreferences.value?.downloadsPath
  );
  const [result, setResult] = useState<EpicGameInstallOptions | null>(null);
  const [selected, setSelected] = useState("");
  const [path, setPath] = useState("");
  const [diskFreeSpace, setDiskFreeSpace] = useState<number | null>(null);
  const [diskChecking, setDiskChecking] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<EpicSaveError | null>(null);
  const generation = useRef(0);
  const directoryGeneration = useRef(0);
  const directoryChosen = useRef(false);
  const directoryScope = useRef("");
  const startGeneration = useRef<number | null>(null);
  const optionsRequestId = useRef<string | null>(null);
  const objectId = game?.objectId;
  const scopeConnectionId = game?.epicImportScope?.connectionId;
  const scopeUserId = game?.epicImportScope?.userId;
  const scopeEnvironment = game?.epicImportScope?.environment;
  const invalidateDirectory = useCallback(() => {
    directoryGeneration.current++;
  }, []);
  const cancelOptionsRequest = useCallback(() => {
    const requestId = optionsRequestId.current;
    optionsRequestId.current = null;
    if (requestId)
      void window.electron
        .cancelEpicGameInstallOptions?.(requestId)
        .catch(() => {});
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    invalidateDirectory();
    cancelOptionsRequest();
  }, [invalidateDirectory, cancelOptionsRequest]);

  const retry = useCallback(async () => {
    const current = ++generation.current;
    cancelOptionsRequest();
    setResult(null);
    setSelected("");
    setError(null);
    setStarting(false);
    startGeneration.current = null;
    if (
      !objectId ||
      typeof window.electron.getEpicGameInstallOptions !== "function" ||
      typeof window.electron.startEpicGameDownload !== "function"
    ) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const requestId = globalThis.crypto.randomUUID();
    optionsRequestId.current = requestId;
    try {
      const options = await window.electron.getEpicGameInstallOptions?.(
        objectId,
        requestId
      );
      if (generation.current !== current) return;
      if (!options) {
        setError("api-unavailable");
        return;
      }
      setResult(options);
      if (options.options.length === 1) setSelected("0");
      setError(options.error ?? null);
    } catch {
      if (generation.current === current) setError("network");
    } finally {
      if (optionsRequestId.current === requestId)
        optionsRequestId.current = null;
      if (generation.current === current) setLoading(false);
    }
  }, [objectId, cancelOptionsRequest]);

  useEffect(() => {
    void retry();
    if (!objectId) return;
    const stopConnection = window.electron.onEpicConnectionChanged?.(
      (connection) => {
        invalidate();
        setContextRevision((previous) => previous + 1);
        setDiskFreeSpace(null);
        setResult(null);
        setStarting(false);
        startGeneration.current = null;
        if (
          connection.verification !== "confirmed" ||
          !connection.connection?.connected ||
          connection.hydraUserId !== scopeUserId ||
          connection.connection.connectionId !== scopeConnectionId
        ) {
          setLoading(false);
          setError("stale-connection");
        } else void retry();
      }
    );
    return () => {
      invalidate();
      stopConnection?.();
    };
  }, [
    objectId,
    scopeConnectionId,
    scopeUserId,
    scopeEnvironment,
    invalidate,
    retry,
  ]);

  useEffect(() => {
    const current = ++directoryGeneration.current;
    const scope = JSON.stringify([
      objectId,
      scopeConnectionId,
      scopeUserId,
      scopeEnvironment,
    ]);
    if (directoryScope.current !== scope) {
      directoryScope.current = scope;
      directoryChosen.current = false;
    }
    if (!directoryChosen.current) {
      setPath(downloadsPath ?? "");
      setDiskFreeSpace(null);
      if (objectId && !downloadsPath)
        void window.electron
          .getDefaultDownloadsPath?.()
          .then((defaultPath) => {
            if (
              directoryGeneration.current === current &&
              !directoryChosen.current
            )
              setPath(defaultPath);
          })
          .catch(() => {});
    }
    return invalidateDirectory;
  }, [
    objectId,
    scopeConnectionId,
    scopeUserId,
    scopeEnvironment,
    downloadsPath,
    contextRevision,
    invalidateDirectory,
  ]);

  useEffect(() => {
    let cancelled = false;
    const current = directoryGeneration.current;
    setDiskFreeSpace(null);
    if (!path || !objectId) {
      setDiskChecking(false);
      return;
    }
    if (epicInstallTiming.enabled) setDiskChecking(true);
    void window.electron
      .getDiskFreeSpace?.(path)
      .then((space) => {
        if (!cancelled && directoryGeneration.current === current)
          setDiskFreeSpace(space?.free ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled && directoryGeneration.current === current)
          setDiskChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    path,
    objectId,
    scopeConnectionId,
    scopeUserId,
    scopeEnvironment,
    downloadsPath,
    contextRevision,
  ]);

  const chooseDirectory = useCallback(async () => {
    const current = directoryGeneration.current;
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: path,
      properties: ["openDirectory"],
    });
    if (directoryGeneration.current === current && filePaths[0]) {
      directoryChosen.current = true;
      setPath(filePaths[0]);
    }
  }, [path]);

  const option =
    selected === "" ? null : (result?.options[Number(selected)] ?? null);
  useEffect(() => {
    if (
      objectId &&
      !loading &&
      !starting &&
      option &&
      result?.connectionId &&
      path
    )
      return afterEpicInstallReadyPaint(
        objectId,
        epicInstallTiming,
        !diskChecking
      );
    return;
  }, [
    objectId,
    loading,
    starting,
    diskChecking,
    option,
    result?.connectionId,
    path,
  ]);
  const start = async (addToQueueOnly: boolean) => {
    if (
      !game ||
      !option ||
      !result?.connectionId ||
      !path.trim() ||
      startGeneration.current !== null
    )
      return;
    const current = generation.current;
    const timing = epicInstallTiming.beginSubmit();
    startGeneration.current = current;
    setStarting(true);
    setError(null);
    try {
      const response = await window.electron.startEpicGameDownload?.({
        epicObjectId: game.objectId,
        connectionId: result.connectionId,
        artifactId: option.artifactId,
        platform: option.platform,
        ...(option.preparationId
          ? { preparationId: option.preparationId }
          : {}),
        downloadPath: path.trim(),
        addToQueueOnly,
      });
      if (current !== generation.current) return;
      if (response?.ok) {
        onStarted();
        epicInstallTiming.accepted(timing);
      } else setError(response?.error ?? "api-unavailable");
    } catch {
      if (current === generation.current) setError("process-failed");
    } finally {
      if (current === generation.current) {
        startGeneration.current = null;
        setStarting(false);
      }
    }
  };
  return {
    result,
    selected,
    setSelected,
    path,
    diskFreeSpace,
    loading,
    starting,
    error,
    option,
    chooseDirectory,
    retry,
    start,
  };
}
