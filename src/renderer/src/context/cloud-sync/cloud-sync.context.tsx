import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type {
  LudusaviBackup,
  GameArtifact,
  GameShop,
  SharedGameArtifact,
} from "@types";
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

export enum CloudSyncState {
  New,
  Different,
  Same,
  Unknown,
}

export interface CloudSyncContext {
  backupPreview: LudusaviBackup | null;
  artifacts: GameArtifact[];
  sharedArtifacts: SharedGameArtifact[];
  showCloudSyncFilesModal: boolean;
  backupState: CloudSyncState;
  downloadGameArtifact: (gameArtifactId: string) => Promise<void>;
  uploadSaveGame: (downloadOptionTitle: string | null) => Promise<void>;
  deleteGameArtifact: (gameArtifactId: string) => Promise<void>;
  setShowCloudSyncFilesModal: React.Dispatch<React.SetStateAction<boolean>>;
  getGameBackupPreview: () => Promise<void>;
  getGameArtifacts: () => Promise<void>;
  getSharedArtifacts: () => Promise<void>;
  shareGameArtifact: (
    gameArtifactId: string,
    recipientId: string
  ) => Promise<void>;
  unshareGameArtifact: (
    gameArtifactId: string,
    recipientId: string
  ) => Promise<void>;
  toggleArtifactFreeze: (
    gameArtifactId: string,
    freeze: boolean
  ) => Promise<void>;
  restoringBackup: boolean;
  uploadingBackup: boolean;
  loadingPreview: boolean;
  freezingArtifact: boolean;
}

export const cloudSyncContext = createContext<CloudSyncContext>({
  backupPreview: null,
  backupState: CloudSyncState.Unknown,
  downloadGameArtifact: async () => {},
  uploadSaveGame: async () => {},
  artifacts: [],
  sharedArtifacts: [],
  deleteGameArtifact: async () => {},
  showCloudSyncFilesModal: false,
  setShowCloudSyncFilesModal: () => {},
  getGameBackupPreview: async () => {},
  toggleArtifactFreeze: async () => {},
  getGameArtifacts: async () => {},
  getSharedArtifacts: async () => {},
  shareGameArtifact: async () => {},
  unshareGameArtifact: async () => {},
  restoringBackup: false,
  uploadingBackup: false,
  loadingPreview: false,
  freezingArtifact: false,
});

const { Provider } = cloudSyncContext;
export const { Consumer: CloudSyncContextConsumer } = cloudSyncContext;

export interface CloudSyncContextProviderProps {
  children: React.ReactNode;
  objectId: string;
  shop: GameShop;
}

export function CloudSyncContextProvider({
  children,
  objectId,
  shop,
}: CloudSyncContextProviderProps) {
  const { t } = useTranslation("game_details");

  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [sharedArtifacts, setSharedArtifacts] = useState<SharedGameArtifact[]>(
    []
  );
  const [backupPreview, setBackupPreview] = useState<LudusaviBackup | null>(
    null
  );
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [uploadingBackup, setUploadingBackup] = useState(false);
  const [showCloudSyncFilesModal, setShowCloudSyncFilesModal] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [freezingArtifact, setFreezingArtifact] = useState(false);

  const { showSuccessToast, showErrorToast } = useToast();

  const downloadGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      setRestoringBackup(true);
      window.electron.downloadGameArtifact(objectId, shop, gameArtifactId);
    },
    [objectId, shop]
  );

  const getGameArtifacts = useCallback(async () => {
    if (shop === "custom") {
      setArtifacts([]);
      return;
    }

    const params = new URLSearchParams({
      objectId,
      shop,
    });

    const results = await window.electron.hydraApi
      .get<GameArtifact[]>(`/profile/games/artifacts?${params.toString()}`, {
        needsSubscription: true,
      })
      .catch(() => {
        return [];
      });
    setArtifacts(results);
  }, [objectId, shop]);

  const getSharedArtifacts = useCallback(async () => {
    if (shop === "custom") {
      setSharedArtifacts([]);
      return;
    }

    const params = new URLSearchParams({
      objectId,
      shop,
    });

    // Save sharing only exists on self-hosted cloud servers; on the official
    // API this endpoint 404s and the section stays empty.
    const results = await window.electron.hydraApi
      .get<
        SharedGameArtifact[]
      >(`/profile/games/artifacts/shared-with-me?${params.toString()}`, { needsSubscription: true })
      .catch(() => []);
    setSharedArtifacts(results);
  }, [objectId, shop]);

  const shareGameArtifact = useCallback(
    async (gameArtifactId: string, recipientId: string) => {
      await window.electron.hydraApi.post(
        `/profile/games/artifacts/${gameArtifactId}/share`,
        { data: { recipientId } }
      );
    },
    []
  );

  const unshareGameArtifact = useCallback(
    async (gameArtifactId: string, recipientId: string) => {
      await window.electron.hydraApi.delete(
        `/profile/games/artifacts/${gameArtifactId}/share/${recipientId}`
      );
    },
    []
  );

  const getGameBackupPreview = useCallback(async () => {
    setLoadingPreview(true);

    try {
      const preview = await window.electron.getGameBackupPreview(
        objectId,
        shop
      );

      setBackupPreview(preview);
    } catch (err) {
      logger.error("Failed to get game backup preview", objectId, shop, err);
    } finally {
      setLoadingPreview(false);
    }
  }, [objectId, shop]);

  const uploadSaveGame = useCallback(
    async (downloadOptionTitle: string | null) => {
      setUploadingBackup(true);
      window.electron
        .uploadSaveGame(objectId, shop, downloadOptionTitle)
        .catch((err) => {
          setUploadingBackup(false);
          logger.error("Failed to upload save game", { objectId, shop, err });
          showErrorToast(t("backup_failed"));
        });
    },
    [objectId, shop, t, showErrorToast]
  );

  const toggleArtifactFreeze = useCallback(
    async (gameArtifactId: string, freeze: boolean) => {
      setFreezingArtifact(true);
      try {
        const endpoint = freeze ? "freeze" : "unfreeze";
        await window.electron.hydraApi.put(
          `/profile/games/artifacts/${gameArtifactId}/${endpoint}`
        );
        getGameArtifacts();
      } catch (err) {
        logger.error("Failed to toggle artifact freeze", objectId, shop, err);
        throw err;
      } finally {
        setFreezingArtifact(false);
      }
    },
    [objectId, shop, getGameArtifacts]
  );

  useEffect(() => {
    const removeUploadCompleteListener = window.electron.onUploadComplete(
      objectId,
      shop,
      () => {
        showSuccessToast(t("backup_uploaded"));
        setUploadingBackup(false);
        getGameArtifacts();
        getGameBackupPreview();
      }
    );

    const removeDownloadCompleteListener =
      window.electron.onBackupDownloadComplete(objectId, shop, () => {
        showSuccessToast(t("backup_restored"));

        setRestoringBackup(false);
        getGameArtifacts();
        getGameBackupPreview();
      });

    return () => {
      removeUploadCompleteListener();
      removeDownloadCompleteListener();
    };
  }, [
    objectId,
    shop,
    showSuccessToast,
    t,
    getGameBackupPreview,
    getGameArtifacts,
  ]);

  const deleteGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      return window.electron.hydraApi
        .delete<{ ok: boolean }>(`/profile/games/artifacts/${gameArtifactId}`)
        .then(() => {
          getGameBackupPreview();
          getGameArtifacts();
        });
    },
    [getGameBackupPreview, getGameArtifacts]
  );

  useEffect(() => {
    setBackupPreview(null);
    setArtifacts([]);
    setSharedArtifacts([]);
    setRestoringBackup(false);
    setUploadingBackup(false);
  }, [objectId, shop]);

  const backupState = useMemo(() => {
    if (!backupPreview) return CloudSyncState.Unknown;
    if (backupPreview.overall.changedGames.new) return CloudSyncState.New;
    if (backupPreview.overall.changedGames.different)
      return CloudSyncState.Different;
    if (backupPreview.overall.changedGames.same) return CloudSyncState.Same;

    return CloudSyncState.Unknown;
  }, [backupPreview]);

  return (
    <Provider
      value={{
        backupPreview,
        artifacts,
        sharedArtifacts,
        backupState,
        restoringBackup,
        uploadingBackup,
        showCloudSyncFilesModal,
        loadingPreview,
        freezingArtifact,
        uploadSaveGame,
        downloadGameArtifact,
        deleteGameArtifact,
        setShowCloudSyncFilesModal,
        getGameBackupPreview,
        getGameArtifacts,
        getSharedArtifacts,
        shareGameArtifact,
        unshareGameArtifact,
        toggleArtifactFreeze,
      }}
    >
      {children}
    </Provider>
  );
}
