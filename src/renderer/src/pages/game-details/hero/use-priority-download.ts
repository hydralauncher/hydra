import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAppSelector,
  useDownload,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { levelDBService } from "@renderer/services/leveldb.service";
import { getOrderedRepackCandidates } from "@renderer/helpers";
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
  const { hasActiveSubscription } = useUserDetails();
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

  const priorityCandidates = useMemo(() => {
    if (!isAutoDownloadEnabled || !repacks.length) return [];
    return getOrderedRepackCandidates(
      repacks,
      downloadSources,
      userPreferences?.downloadSourcesPriority,
      userPreferences ?? undefined,
      hasActiveSubscription
    );
  }, [
    isAutoDownloadEnabled,
    repacks,
    downloadSources,
    userPreferences,
    hasActiveSubscription,
  ]);

  const priorityRepack = priorityCandidates[0]?.repack ?? null;

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
    if (!priorityCandidates.length) {
      setShowRepacksModal(true);
      return;
    }

    let targetPath = userPreferences?.downloadsPath;
    if (!targetPath) {
      targetPath = await window.electron.getDefaultDownloadsPath();
    }

    if (userPreferences?.alwaysAskDownloadLocation) {
      const dialog = await window.electron.showOpenDialog({
        properties: ["openDirectory"],
        defaultPath: targetPath || undefined,
      });
      if (dialog.canceled || !dialog.filePaths?.[0]) return;
      targetPath = dialog.filePaths[0];
    }

    if (!targetPath) {
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

    let lastError: string | undefined;

    for (const candidate of priorityCandidates) {
      try {
        const res = await startDownload({
          objectId: objectId!,
          title: gameTitle,
          shop,
          downloader: candidate.downloader,
          downloadPath: targetPath,
          uri: candidate.uri,
          automaticallyExtract,
          automaticallyDeleteArchiveFiles,
          fileSize: candidate.repack.fileSize ?? undefined,
        });

        if (res.ok) {
          await updateGame();
          showSuccessToast(
            t("download_started", { defaultValue: "Download iniciado!" })
          );
          return;
        }

        lastError = res.error;
      } catch {
        lastError = undefined;
      }
    }

    // Every candidate in priority order failed to start; surface the last
    // error and let the user pick a source manually.
    if (lastError) {
      showErrorToast(
        t("download_start_failed", {
          defaultValue: "Falha ao iniciar download",
        }),
        t(lastError, { defaultValue: lastError })
      );
    } else {
      showErrorToast(
        t("download_start_failed", {
          defaultValue: "Falha ao iniciar download",
        })
      );
    }
    setShowRepacksModal(true);
  }, [
    priorityCandidates,
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
