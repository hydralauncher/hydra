import { useTranslation } from "react-i18next";

import {
  useAppSelector,
  useDownload,
  useDownloadLayout,
  useLibrary,
} from "@renderer/hooks";

import { useEffect, useMemo, useRef, useState } from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import "./downloads.scss";
import { DeleteGameModal } from "./delete-game-modal";
import { DownloadGroup } from "./download-group";
import {
  getDownloadId,
  getRendererDownloadBucket,
  type GameShop,
  type LibraryGame,
  type SeedingStatus,
} from "../../../../types";
import { orderBy } from "lodash-es";
import { ArrowDownIcon } from "@primer/octicons-react";

export default function Downloads() {
  const { library, updateLibrary } = useLibrary();
  const { layoutState } = useDownloadLayout();
  const extraction = useAppSelector((state) => state.download.extraction);

  const { t } = useTranslation("downloads");

  const gameToBeDeleted = useRef<[GameShop, string] | null>(null);

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { removeGameInstaller, pauseSeeding } = useDownload();

  const handleDeleteGame = async () => {
    if (gameToBeDeleted.current) {
      const [shop, objectId] = gameToBeDeleted.current;

      await pauseSeeding(shop, objectId);
      await removeGameInstaller(shop, objectId);
    }
  };

  const { lastPacket } = useDownload();

  const [seedingStatus, setSeedingStatus] = useState<SeedingStatus[]>([]);

  useEffect(() => {
    window.electron.onSeedingStatus((value) => setSeedingStatus(value));

    const unsubscribeExtraction = window.electron.onExtractionComplete(() => {
      updateLibrary();
    });

    return () => {
      unsubscribeExtraction();
    };
  }, [updateLibrary]);

  const handleOpenGameInstaller = (shop: GameShop, objectId: string) =>
    window.electron.openGameInstaller(shop, objectId).then((wasOpened) => {
      if (!wasOpened) {
        setShowBinaryNotFoundModal(true);
      }

      updateLibrary();
    });

  const handleOpenDeleteGameModal = (shop: GameShop, objectId: string) => {
    gameToBeDeleted.current = [shop, objectId];
    setShowDeleteModal(true);
  };

  const libraryGroup: Record<string, LibraryGame[]> = useMemo(() => {
    const initialValue: Record<string, LibraryGame[]> = {
      downloading: [],
      queued: [],
      complete: [],
    };

    const queueOrder = layoutState.queueOrder;
    const pausedOrder = layoutState.pausedOrder;
    const queueOrderIndex = new Map(queueOrder.map((id, index) => [id, index]));
    const pausedOrderIndex = new Map(
      pausedOrder.map((id, index) => [id, index])
    );

    const result = library.reduce((prev, next) => {
      if (!next.download) return prev;

      const bucket = getRendererDownloadBucket(next.download, {
        hasLiveProgress:
          lastPacket?.gameId === next.id && next.download.status === "active",
        isExtracting: extraction?.visibleId === next.id,
      });

      if (bucket === "hidden") return prev;
      if (bucket === "inProgress") {
        return { ...prev, downloading: [...prev.downloading, next] };
      }

      if (bucket === "queued") {
        return { ...prev, queued: [...prev.queued, next] };
      }

      return { ...prev, complete: [...prev.complete, next] };
    }, initialValue);

    const queued = [...result.queued].sort((left, right) => {
      const leftDownload = left.download!;
      const rightDownload = right.download!;
      const leftId = getDownloadId(leftDownload);
      const rightId = getDownloadId(rightDownload);
      const leftInQueue = queueOrderIndex.get(leftId);
      const rightInQueue = queueOrderIndex.get(rightId);
      const leftInPaused = pausedOrderIndex.get(leftId);
      const rightInPaused = pausedOrderIndex.get(rightId);

      if (leftInQueue != null && rightInQueue != null) {
        return leftInQueue - rightInQueue;
      }

      if (leftInQueue != null) return -1;
      if (rightInQueue != null) return 1;

      if (leftInPaused != null && rightInPaused != null) {
        return leftInPaused - rightInPaused;
      }

      return (leftDownload.timestamp ?? 0) - (rightDownload.timestamp ?? 0);
    });

    const complete = orderBy(result.complete, (game) =>
      game.download?.progress === 1 ? 0 : 1
    );

    return {
      ...result,
      queued,
      complete,
    };
  }, [extraction?.visibleId, lastPacket?.gameId, layoutState, library]);

  const queuedGameIds = useMemo(
    () => libraryGroup.queued.map((game) => game.id),
    [libraryGroup.queued]
  );

  const downloadGroups = [
    {
      title: t("download_in_progress"),
      library: libraryGroup.downloading,
      queuedGameIds: [] as string[],
    },
    {
      title: t("queued_downloads"),
      library: libraryGroup.queued,
      queuedGameIds,
    },
    {
      title: t("downloads_completed"),
      library: libraryGroup.complete,
      queuedGameIds: [] as string[],
    },
  ];

  const hasItemsInLibrary = useMemo(() => {
    return Object.values(libraryGroup).some((group) => group.length > 0);
  }, [libraryGroup]);

  return (
    <>
      <BinaryNotFoundModal
        visible={showBinaryNotFoundModal}
        onClose={() => setShowBinaryNotFoundModal(false)}
      />

      <DeleteGameModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        deleteGame={handleDeleteGame}
      />

      {hasItemsInLibrary ? (
        <section className="downloads__container">
          <div className="downloads__groups">
            {downloadGroups.map((group) => (
              <DownloadGroup
                key={group.title}
                title={group.title}
                library={group.library}
                openDeleteGameModal={handleOpenDeleteGameModal}
                openGameInstaller={handleOpenGameInstaller}
                seedingStatus={seedingStatus}
                queuedGameIds={group.queuedGameIds}
              />
            ))}
          </div>
        </section>
      ) : (
        <div className="downloads__no-downloads">
          <div className="downloads__arrow-icon">
            <ArrowDownIcon size={24} />
          </div>
          <h2>{t("no_downloads_title")}</h2>
          <p>{t("no_downloads_description")}</p>
        </div>
      )}
    </>
  );
}
