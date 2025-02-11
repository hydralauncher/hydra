import { useTranslation } from "react-i18next";

import { useDownload, useLibrary } from "@renderer/hooks";

import { useEffect, useMemo, useRef, useState } from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import "./downloads.scss";
import { DeleteGameModal } from "./delete-game-modal";
import { DownloadGroup } from "./download-group";
import type { GameShop, LibraryGame, SeedingStatus } from "@types";
import { orderBy, sortBy } from "lodash-es";
import { ArrowDownIcon } from "@primer/octicons-react";

export default function Downloads() {
  const { library, updateLibrary } = useLibrary();

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
  }, []);

  const handleOpenGameInstaller = (shop: GameShop, objectId: string) =>
    window.electron.openGameInstaller(shop, objectId).then((isBinaryInPath) => {
      if (!isBinaryInPath) setShowBinaryNotFoundModal(true);
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

    const result = sortBy(library, (game) => game.download?.timestamp).reduce(
      (prev, next) => {
        /* Game has been manually added to the library or has been canceled */
        if (!next.download?.status || next.download?.status === "removed")
          return prev;

        /* Is downloading */
        if (lastPacket?.gameId === next.id)
          return { ...prev, downloading: [...prev.downloading, next] };

        /* Is either queued or paused */
        if (next.download.queued || next.download?.status === "paused")
          return { ...prev, queued: [...prev.queued, next] };

        return { ...prev, complete: [...prev.complete, next] };
      },
      initialValue
    );

    const queued = orderBy(result.queued, (game) => game.download?.timestamp, [
      "desc",
    ]);

    const complete = orderBy(result.complete, (game) =>
      game.download?.progress === 1 ? 0 : 1
    );

    return {
      ...result,
      queued,
      complete,
    };
  }, [library, lastPacket?.gameId]);

  const downloadGroups = [
    {
      title: t("download_in_progress"),
      library: libraryGroup.downloading,
    },
    {
      title: t("queued_downloads"),
      library: libraryGroup.queued,
    },
    {
      title: t("downloads_completed"),
      library: libraryGroup.complete,
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
                library={orderBy(group.library, ["updatedAt"], ["desc"])}
                openDeleteGameModal={handleOpenDeleteGameModal}
                openGameInstaller={handleOpenGameInstaller}
                seedingStatus={seedingStatus}
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
