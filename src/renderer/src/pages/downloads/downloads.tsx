import { useTranslation } from "react-i18next";
import {
  useAppSelector,
  useDownload,
  useDownloadLayout,
  useLibrary,
} from "@renderer/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import { DeleteGameModal } from "./delete-game-modal";
import { DownloadsHero } from "./downloads-hero";
import { DownloadsSection } from "./downloads-section";
import { DownloadsQueueItem } from "./downloads-queue-item";
import { DownloadsCompletedItem } from "./downloads-completed-item";
import { TrashIcon } from "@primer/octicons-react";
import {
  getDownloadId,
  getRendererDownloadBucket,
  type GameShop,
  type LibraryGame,
  type SeedingStatus,
} from "../../../../types";
import { orderBy } from "lodash-es";
import "./downloads.scss";

export default function Downloads() {
  const { library, updateLibrary } = useLibrary();
  const { layoutState } = useDownloadLayout();
  const extraction = useAppSelector((state) => state.download.extraction);
  const { t } = useTranslation("downloads");
  const gameToBeDeleted = useRef<[GameShop, string] | null>(null);

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const [seedingStatus, setSeedingStatus] = useState<SeedingStatus[]>([]);

  const [networkHistory, setNetworkHistory] = useState<number[]>(() =>
    Array(30).fill(0)
  );
  const [diskHistory, setDiskHistory] = useState<number[]>(() =>
    Array(30).fill(0)
  );
  const [peakSpeed, setPeakSpeed] = useState<number>(0);

  const {
    lastPacket,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    removeGameInstaller,
    pauseSeeding,
  } = useDownload();

  useEffect(() => {
    window.electron.onSeedingStatus((value) => setSeedingStatus(value));
    const unsubscribeExtraction = window.electron.onExtractionComplete(() => {
      updateLibrary();
    });
    return () => unsubscribeExtraction();
  }, [updateLibrary]);

  const libraryGroup = useMemo(() => {
    const initial: {
      downloading: LibraryGame[];
      queued: LibraryGame[];
      complete: LibraryGame[];
    } = { downloading: [], queued: [], complete: [] };

    const queueOrderIndex = new Map(
      layoutState.queueOrder.map((id, index) => [id, index])
    );
    const result = library.reduce((prev, next) => {
      if (!next.download) return prev;
      const bucket = getRendererDownloadBucket(next.download, {
        hasLiveProgress:
          lastPacket?.gameId === next.id && next.download.status === "active",
        isExtracting: extraction?.visibleId === next.id,
      });

      if (bucket === "hidden") return prev;
      if (bucket === "inProgress")
        return { ...prev, downloading: [...prev.downloading, next] };
      if (bucket === "queued")
        return { ...prev, queued: [...prev.queued, next] };
      return { ...prev, complete: [...prev.complete, next] };
    }, initial);

    const queued = [...result.queued].sort((a, b) => {
      const aIdx = queueOrderIndex.get(getDownloadId(a.download!));
      const bIdx = queueOrderIndex.get(getDownloadId(b.download!));
      if (aIdx != null && bIdx != null) return aIdx - bIdx;
      if (aIdx != null) return -1;
      if (bIdx != null) return 1;
      return (a.download?.timestamp ?? 0) - (b.download?.timestamp ?? 0);
    });

    return {
      ...result,
      queued,
      complete: orderBy(result.complete, (g) =>
        g.download?.progress === 1 ? 0 : 1
      ),
    };
  }, [extraction?.visibleId, lastPacket?.gameId, layoutState, library]);

  const activeGame = libraryGroup.downloading[0] ?? null;

  useEffect(() => {
    if (!activeGame) {
      setNetworkHistory(Array(30).fill(0));
      setDiskHistory(Array(30).fill(0));
      setPeakSpeed(0);
      return;
    }

    const isCurrentActive = lastPacket?.gameId === activeGame.id;
    const netSpeed = isCurrentActive ? (lastPacket?.downloadSpeed ?? 0) : 0;
    const diskSpeed = extraction?.progress
      ? 1024 * 1024 * 35
      : netSpeed > 0
        ? netSpeed * (0.85 + Math.random() * 0.25)
        : 0;

    setNetworkHistory((prev) => [...prev.slice(1), netSpeed]);
    setDiskHistory((prev) => [...prev.slice(1), diskSpeed]);
    if (netSpeed > 0 || diskSpeed > 0) {
      setPeakSpeed((prev) => Math.max(prev, netSpeed, diskSpeed));
    }
  }, [lastPacket, extraction?.progress, activeGame]);

  const currentNetworkSpeed =
    activeGame && lastPacket?.gameId === activeGame.id
      ? (lastPacket?.downloadSpeed ?? 0)
      : 0;

  const currentDiskSpeed = activeGame
    ? extraction?.progress
      ? 1024 * 1024 * 35
      : lastPacket?.gameId === activeGame.id &&
          (lastPacket?.downloadSpeed ?? 0) > 0
        ? (lastPacket?.downloadSpeed ?? 0) * 0.9
        : 0
    : 0;

  return (
    <div className="downloads-page">
      <BinaryNotFoundModal
        visible={showBinaryNotFoundModal}
        onClose={() => setShowBinaryNotFoundModal(false)}
      />

      <DeleteGameModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        deleteGame={async () => {
          if (gameToBeDeleted.current) {
            const [shop, objectId] = gameToBeDeleted.current;
            await pauseSeeding(shop, objectId);
            await removeGameInstaller(shop, objectId);
          }
        }}
      />

      <DeleteGameModal
        visible={showClearHistoryModal}
        onClose={() => setShowClearHistoryModal(false)}
        deleteGame={async () => {
          for (const game of libraryGroup.complete) {
            try {
              await pauseSeeding(game.shop, game.objectId);
              await removeGameInstaller(game.shop, game.objectId);
            } catch {
              // ignore
            }
          }
          updateLibrary();
        }}
        title={t("clear_history_modal_title", {
          defaultValue: "Excluir histórico de downloads?",
        })}
        description={t("clear_history_modal_description", {
          defaultValue:
            "Isso removerá todos os arquivos de instalação e registros dos downloads concluídos e pausados do seu computador.",
        })}
      />

      <DownloadsHero
        activeGame={activeGame}
        networkHistory={networkHistory}
        diskHistory={diskHistory}
        peakSpeed={activeGame ? peakSpeed : 0}
        currentNetworkSpeed={currentNetworkSpeed}
        currentDiskSpeed={currentDiskSpeed}
        onPause={(g) => pauseDownload(g.shop, g.objectId)}
        onResume={(g) => resumeDownload(g.shop, g.objectId)}
        onCancel={(g) => cancelDownload(g.shop, g.objectId)}
      />

      <div className="downloads-page__body">
        <DownloadsSection
          title={t("up_next", { defaultValue: "A seguir" })}
          count={libraryGroup.queued.length}
          subtext={t("auto_updates_enabled", {
            defaultValue: "Atualizações automáticas ativadas",
          })}
          emptyText={t("no_queued_downloads", {
            defaultValue: "Não há downloads na fila",
          })}
        >
          {libraryGroup.queued.map((game, index) => (
            <DownloadsQueueItem
              key={game.id}
              game={game}
              onResume={(g) => resumeDownload(g.shop, g.objectId)}
              onCancel={(g) => cancelDownload(g.shop, g.objectId)}
              isFirst={index === 0}
              isLast={index === libraryGroup.queued.length - 1}
            />
          ))}
        </DownloadsSection>

        <DownloadsSection
          title={t("completed_and_paused", {
            defaultValue: "Concluídos & Pausados",
          })}
          count={libraryGroup.complete.length}
          action={
            libraryGroup.complete.length > 0 ? (
              <button
                type="button"
                className="downloads-section__clear-btn"
                onClick={() => setShowClearHistoryModal(true)}
                title={t("clear_history", {
                  defaultValue: "Excluir histórico",
                })}
              >
                <TrashIcon size={14} />
                <span>
                  {t("clear_history", { defaultValue: "Excluir histórico" })}
                </span>
              </button>
            ) : undefined
          }
        >
          {libraryGroup.complete.map((game) => (
            <DownloadsCompletedItem
              key={game.id}
              game={game}
              seedingStatus={seedingStatus}
              onResume={(g) => resumeDownload(g.shop, g.objectId)}
              onOpenInstaller={(s, id) =>
                window.electron.openGameInstaller(s, id).then((opened) => {
                  if (!opened) setShowBinaryNotFoundModal(true);
                  updateLibrary();
                })
              }
              onOpenDeleteModal={(s, id) => {
                gameToBeDeleted.current = [s, id];
                setShowDeleteModal(true);
              }}
              onLaunchGame={(g) => {
                if (g.executablePath) {
                  window.electron.openGame(
                    g.shop,
                    g.objectId,
                    g.executablePath,
                    g.launchOptions
                  );
                }
              }}
            />
          ))}
        </DownloadsSection>
      </div>
    </div>
  );
}
