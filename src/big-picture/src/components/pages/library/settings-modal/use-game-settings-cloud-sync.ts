import type { GameArtifact, LibraryGame, LudusaviBackup } from "@types";
import type { AxiosProgressEvent } from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";

interface UseGameSettingsCloudSyncProps {
  visible: boolean;
  game: LibraryGame | null;
  hasActiveSubscription: boolean;
  onFeedback: (type: "success" | "error" | "info", message: string) => void;
}

export enum GameSettingsCloudSyncState {
  New,
  Different,
  Same,
  Unknown,
}

export function useGameSettingsCloudSync({
  visible,
  game,
  hasActiveSubscription,
  onFeedback,
}: UseGameSettingsCloudSyncProps) {
  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [backupPreview, setBackupPreview] = useState<LudusaviBackup | null>(
    null
  );
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [uploadingBackup, setUploadingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [freezingArtifact, setFreezingArtifact] = useState(false);
  const [deletingArtifact, setDeletingArtifact] = useState(false);
  const [backupDownloadProgress, setBackupDownloadProgress] =
    useState<AxiosProgressEvent | null>(null);

  const getGameArtifacts = useCallback(async () => {
    if (!game || game.shop === "custom" || !hasActiveSubscription) {
      setArtifacts([]);
      return;
    }

    const params = new URLSearchParams({
      objectId: game.objectId,
      shop: game.shop,
    });

    const { electron } = globalThis as typeof globalThis & Window;

    const results = await electron.hydraApi
      .get<GameArtifact[]>(`/profile/games/artifacts?${params.toString()}`, {
        needsSubscription: true,
      })
      .catch(() => []);

    setArtifacts(results);
  }, [game, hasActiveSubscription]);

  const getGameBackupPreview = useCallback(async () => {
    if (!game || game.shop === "custom" || !hasActiveSubscription) {
      setBackupPreview(null);
      return;
    }

    setLoadingPreview(true);
    try {
      const preview = await globalThis.window.electron.getGameBackupPreview(
        game.objectId,
        game.shop
      );
      setBackupPreview(preview);
    } catch {
      setBackupPreview(null);
      onFeedback("error", "Could not load backup preview");
    } finally {
      setLoadingPreview(false);
    }
  }, [game, hasActiveSubscription, onFeedback]);

  const refreshCloudSync = useCallback(async () => {
    await Promise.all([getGameBackupPreview(), getGameArtifacts()]);
  }, [getGameArtifacts, getGameBackupPreview]);

  useEffect(() => {
    if (!visible || !game || game.shop === "custom" || !hasActiveSubscription) {
      setArtifacts([]);
      setBackupPreview(null);
      return;
    }

    void refreshCloudSync();
  }, [game, hasActiveSubscription, refreshCloudSync, visible]);

  useEffect(() => {
    if (!visible || !game) return;

    const removeUploadCompleteListener =
      globalThis.window.electron.onUploadComplete(
        game.objectId,
        game.shop,
        () => {
          setUploadingBackup(false);
          onFeedback("success", "Backup uploaded");
          void refreshCloudSync();
        }
      );

    const removeDownloadCompleteListener =
      globalThis.window.electron.onBackupDownloadComplete(
        game.objectId,
        game.shop,
        () => {
          setRestoringBackup(false);
          setBackupDownloadProgress(null);
          onFeedback("success", "Backup restored");
          void refreshCloudSync();
        }
      );

    const removeDownloadProgressListener =
      globalThis.window.electron.onBackupDownloadProgress(
        game.objectId,
        game.shop,
        setBackupDownloadProgress
      );

    return () => {
      removeUploadCompleteListener();
      removeDownloadCompleteListener();
      removeDownloadProgressListener();
    };
  }, [game, onFeedback, refreshCloudSync, visible]);

  useEffect(() => {
    setArtifacts([]);
    setBackupPreview(null);
    setUploadingBackup(false);
    setRestoringBackup(false);
    setBackupDownloadProgress(null);
  }, [game?.id]);

  const uploadSaveGame = useCallback(async () => {
    if (!game) return;

    setUploadingBackup(true);
    try {
      await globalThis.window.electron.uploadSaveGame(
        game.objectId,
        game.shop,
        null
      );
    } catch {
      setUploadingBackup(false);
      onFeedback("error", "Backup failed");
    }
  }, [game, onFeedback]);

  const downloadGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      if (!game) return;

      setRestoringBackup(true);
      setBackupDownloadProgress(null);
      try {
        await globalThis.window.electron.downloadGameArtifact(
          game.objectId,
          game.shop,
          gameArtifactId
        );
      } catch {
        setRestoringBackup(false);
        onFeedback("error", "Could not restore backup");
      }
    },
    [game, onFeedback]
  );

  const deleteGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      setDeletingArtifact(true);
      try {
        await globalThis.window.electron.hydraApi.delete(
          `/profile/games/artifacts/${gameArtifactId}`
        );
        await refreshCloudSync();
        onFeedback("success", "Backup deleted");
      } catch {
        onFeedback("error", "Could not delete backup");
      } finally {
        setDeletingArtifact(false);
      }
    },
    [onFeedback, refreshCloudSync]
  );

  const renameGameArtifact = useCallback(
    async (gameArtifactId: string, label: string) => {
      await globalThis.window.electron.hydraApi.put(
        `/profile/games/artifacts/${gameArtifactId}`,
        {
          data: {
            label,
          },
        }
      );
      await getGameArtifacts();
      onFeedback("success", "Backup renamed");
    },
    [getGameArtifacts, onFeedback]
  );

  const toggleArtifactFreeze = useCallback(
    async (gameArtifactId: string, freeze: boolean) => {
      setFreezingArtifact(true);
      try {
        const endpoint = freeze ? "freeze" : "unfreeze";
        await globalThis.window.electron.hydraApi.put(
          `/profile/games/artifacts/${gameArtifactId}/${endpoint}`
        );
        await getGameArtifacts();
        onFeedback("success", freeze ? "Backup frozen" : "Backup unfrozen");
      } catch {
        onFeedback("error", "Could not update backup");
      } finally {
        setFreezingArtifact(false);
      }
    },
    [getGameArtifacts, onFeedback]
  );

  const setBackupPath = useCallback(
    async (backupPath: string | null) => {
      if (!game) return;

      await globalThis.window.electron.selectGameBackupPath(
        game.shop,
        game.objectId,
        backupPath
      );
      await getGameBackupPreview();
      onFeedback(
        "success",
        backupPath ? "Custom backup location set" : "Automatic mapping enabled"
      );
    },
    [game, getGameBackupPreview, onFeedback]
  );

  const backupState = useMemo(() => {
    if (!backupPreview) return GameSettingsCloudSyncState.Unknown;
    if (backupPreview.overall.changedGames.new)
      return GameSettingsCloudSyncState.New;
    if (backupPreview.overall.changedGames.different)
      return GameSettingsCloudSyncState.Different;
    if (backupPreview.overall.changedGames.same)
      return GameSettingsCloudSyncState.Same;

    return GameSettingsCloudSyncState.Unknown;
  }, [backupPreview]);

  return {
    artifacts,
    backupPreview,
    backupState,
    loadingPreview,
    uploadingBackup,
    restoringBackup,
    freezingArtifact,
    deletingArtifact,
    backupDownloadProgress,
    getGameArtifacts,
    getGameBackupPreview,
    refreshCloudSync,
    uploadSaveGame,
    downloadGameArtifact,
    deleteGameArtifact,
    renameGameArtifact,
    toggleArtifactFreeze,
    setBackupPath,
  };
}

export type GameSettingsCloudSync = ReturnType<typeof useGameSettingsCloudSync>;
