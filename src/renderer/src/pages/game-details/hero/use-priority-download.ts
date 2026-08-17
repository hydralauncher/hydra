import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector, useDownload, useToast } from "@renderer/hooks";
import { levelDBService } from "@renderer/services/leveldb.service";
import {
  getBestDownloaderForRepack,
  getPriorityRepack,
} from "@renderer/helpers";
import type { DownloadSource, GameRepack, GameShop } from "@types";

interface UsePriorityDownloadParams {
  shop: GameShop;
  objectId?: string;
  gameTitle: string;
  repacks: GameRepack[];
  updateGame: () => Promise<void> | void;
  setShowRepacksModal: (visible: boolean) => void;
}

export function usePriorityDownload({
  shop,
  objectId,
  gameTitle,
  repacks,
  updateGame,
  setShowRepacksModal,
}: UsePriorityDownloadParams) {
  const { t } = useTranslation("game_details");
  const { startDownload } = useDownload();
  const { showSuccessToast, showErrorToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

  useEffect(() => {
    levelDBService
      .values("downloadSources")
      .then((sources) =>
        setDownloadSources((sources as DownloadSource[]) || [])
      )
      .catch(() => setDownloadSources([]));
  }, []);

  const isAutoDownloadEnabled = Boolean(
    userPreferences?.autoDownloadBySourcePriority
  );

  const priorityRepack = useMemo(() => {
    if (!isAutoDownloadEnabled || !repacks.length) return null;
    return getPriorityRepack(
      repacks,
      downloadSources,
      userPreferences?.downloadSourcesPriority
    );
  }, [
    isAutoDownloadEnabled,
    repacks,
    downloadSources,
    userPreferences?.downloadSourcesPriority,
  ]);

  const buttonLabel = useMemo(() => {
    if (priorityRepack) {
      return t("download_with_source", {
        source: priorityRepack.downloadSourceName,
        defaultValue: `Baixar (${priorityRepack.downloadSourceName})`,
      });
    }
    return t("download_via_hydra", { defaultValue: "Baixar" });
  }, [priorityRepack, t]);

  const triggerDownload = useCallback(async () => {
    if (!priorityRepack) {
      setShowRepacksModal(true);
      return;
    }

    let targetPath = userPreferences?.downloadsPath;
    if (!targetPath || userPreferences?.alwaysAskDownloadLocation) {
      const dialog = await window.electron.showOpenDialog({
        properties: ["openDirectory"],
        defaultPath: targetPath || undefined,
      });
      if (dialog.canceled || !dialog.filePaths?.[0]) return;
      targetPath = dialog.filePaths[0];
    }

    const best = getBestDownloaderForRepack(
      priorityRepack,
      userPreferences ?? undefined
    );
    if (!best || !targetPath) {
      setShowRepacksModal(true);
      return;
    }

    const automaticallyExtract =
      userPreferences?.alwaysAutoExtract ??
      userPreferences?.extractFilesByDefault ??
      true;
    const automaticallyDeleteArchiveFiles =
      userPreferences?.alwaysDeleteArchiveAfterExtraction ??
      userPreferences?.deleteArchiveFilesAfterExtractionByDefault ??
      false;

    try {
      const res = await startDownload({
        objectId: objectId!,
        title: gameTitle,
        shop,
        downloader: best.downloader,
        downloadPath: targetPath,
        uri: best.uri,
        automaticallyExtract,
        automaticallyDeleteArchiveFiles,
        fileSize: priorityRepack.fileSize ?? undefined,
      });

      if (res.ok) {
        await updateGame();
        showSuccessToast(
          t("download_started", { defaultValue: "Download iniciado!" })
        );
      }
    } catch {
      showErrorToast(
        t("download_start_failed", {
          defaultValue: "Falha ao iniciar download",
        })
      );
    }
  }, [
    priorityRepack,
    userPreferences,
    objectId,
    gameTitle,
    shop,
    startDownload,
    updateGame,
    setShowRepacksModal,
    showSuccessToast,
    showErrorToast,
    t,
  ]);

  return {
    isAutoDownloadEnabled,
    priorityRepack,
    buttonLabel,
    triggerDownload,
  };
}
