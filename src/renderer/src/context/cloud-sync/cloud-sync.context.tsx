import { gameBackupsTable } from "@renderer/dexie";
import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type { LudusaviBackup, GameArtifact, GameShop } from "@types";
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
  showCloudSyncModal: boolean;
  showCloudSyncFilesModal: boolean;
  backupState: CloudSyncState;
  setShowCloudSyncModal: React.Dispatch<React.SetStateAction<boolean>>;
  downloadGameArtifact: (gameArtifactId: string) => Promise<void>;
  uploadSaveGame: (downloadOptionTitle: string | null) => Promise<void>;
  deleteGameArtifact: (gameArtifactId: string) => Promise<void>;
  setShowCloudSyncFilesModal: React.Dispatch<React.SetStateAction<boolean>>;
  getGameBackupPreview: () => Promise<void>;
  restoringBackup: boolean;
  uploadingBackup: boolean;
}

export const cloudSyncContext = createContext<CloudSyncContext>({
  backupPreview: null,
  showCloudSyncModal: false,
  backupState: CloudSyncState.Unknown,
  setShowCloudSyncModal: () => {},
  downloadGameArtifact: async () => {},
  uploadSaveGame: async () => {},
  artifacts: [],
  deleteGameArtifact: async () => {},
  showCloudSyncFilesModal: false,
  setShowCloudSyncFilesModal: () => {},
  getGameBackupPreview: async () => {},
  restoringBackup: false,
  uploadingBackup: false,
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
  const [showCloudSyncModal, setShowCloudSyncModal] = useState(false);
  const [backupPreview, setBackupPreview] = useState<LudusaviBackup | null>(
    null
  );
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [uploadingBackup, setUploadingBackup] = useState(false);
  const [showCloudSyncFilesModal, setShowCloudSyncFilesModal] = useState(false);

  const { showSuccessToast } = useToast();

  const downloadGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      setRestoringBackup(true);
      window.electron.downloadGameArtifact(objectId, shop, gameArtifactId);
    },
    [objectId, shop]
  );

  const getGameBackupPreview = useCallback(async () => {
    await Promise.allSettled([
      window.electron.getGameArtifacts(objectId, shop).then((results) => {
        setArtifacts(results);
      }),
      window.electron
        .getGameBackupPreview(objectId, shop)
        .then((preview) => {
          if (preview && Object.keys(preview.games).length) {
            setBackupPreview(preview);
          }
        })
        .catch((err) => {
          logger.error(
            "Failed to get game backup preview",
            objectId,
            shop,
            err
          );
        }),
    ]);
  }, [objectId, shop]);

  const uploadSaveGame = useCallback(
    async (downloadOptionTitle: string | null) => {
      setUploadingBackup(true);
      window.electron.uploadSaveGame(objectId, shop, downloadOptionTitle);
    },
    [objectId, shop]
  );

  useEffect(() => {
    const removeUploadCompleteListener = window.electron.onUploadComplete(
      objectId,
      shop,
      () => {
        showSuccessToast(t("backup_uploaded"));

        setUploadingBackup(false);
        gameBackupsTable.add({
          objectId,
          shop,
          createdAt: new Date(),
        });

        getGameBackupPreview();
      }
    );

    const removeDownloadCompleteListener =
      window.electron.onBackupDownloadComplete(objectId, shop, () => {
        showSuccessToast(t("backup_restored"));

        setRestoringBackup(false);
        getGameBackupPreview();
      });

    return () => {
      removeUploadCompleteListener();
      removeDownloadCompleteListener();
    };
  }, [objectId, shop, showSuccessToast, t, getGameBackupPreview]);

  const deleteGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      return window.electron.deleteGameArtifact(gameArtifactId).then(() => {
        getGameBackupPreview();
      });
    },
    [getGameBackupPreview]
  );

  useEffect(() => {
    setBackupPreview(null);
    setArtifacts([]);
    setShowCloudSyncModal(false);
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
        showCloudSyncModal,
        artifacts,
        backupState,
        restoringBackup,
        uploadingBackup,
        showCloudSyncFilesModal,
        setShowCloudSyncModal,
        uploadSaveGame,
        downloadGameArtifact,
        deleteGameArtifact,
        setShowCloudSyncFilesModal,
        getGameBackupPreview,
      }}
    >
      {children}
    </Provider>
  );
}
