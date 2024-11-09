import { useTranslation } from "react-i18next";

import { useDownload, useLibrary } from "@renderer/hooks";

import { useEffect, useMemo, useRef, useState } from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import * as styles from "./downloads.css";
import { DeleteGameModal } from "./delete-game-modal";
import { DownloadGroup } from "./download-group";
import type { LibraryGame, SeedingStatus } from "@types";
import { orderBy } from "lodash-es";
import { ArrowDownIcon } from "@primer/octicons-react";

export default function Downloads() {
  const { library, updateLibrary } = useLibrary();

  const { t } = useTranslation("downloads");

  const gameToBeDeleted = useRef<number | null>(null);

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { removeGameInstaller, pauseSeeding } = useDownload();

  const handleDeleteGame = async () => {
    if (gameToBeDeleted.current) {
      await pauseSeeding(gameToBeDeleted.current);
      await removeGameInstaller(gameToBeDeleted.current);
    }
  };

  const { lastPacket } = useDownload();

  const [seedingStatus, setSeedingStatus] = useState<SeedingStatus[]>([]);

  useEffect(() => {
    window.electron.onSeedingStatus((value) => setSeedingStatus(value));
  }, []);

  const handleOpenGameInstaller = (gameId: number) =>
    window.electron.openGameInstaller(gameId).then((isBinaryInPath) => {
      if (!isBinaryInPath) setShowBinaryNotFoundModal(true);
      updateLibrary();
    });

  const handleOpenDeleteGameModal = (gameId: number) => {
    gameToBeDeleted.current = gameId;
    setShowDeleteModal(true);
  };

  const libraryGroup: Record<string, LibraryGame[]> = useMemo(() => {
    const initialValue: Record<string, LibraryGame[]> = {
      downloading: [],
      queued: [],
      complete: [],
    };

    const result = library.reduce((prev, next) => {
      /* Game has been manually added to the library or has been canceled */
      if (!next.status || next.status === "removed") return prev;

      /* Is downloading */
      if (lastPacket?.game.id === next.id)
        return { ...prev, downloading: [...prev.downloading, next] };

      /* Is either queued or paused */
      if (next.downloadQueue || next.status === "paused")
        return { ...prev, queued: [...prev.queued, next] };

      return { ...prev, complete: [...prev.complete, next] };
    }, initialValue);

    const queued = orderBy(
      result.queued,
      (game) => game.downloadQueue?.id ?? -1,
      ["desc"]
    );

    const complete = orderBy(result.complete, (game) =>
      game.progress === 1 ? 0 : 1
    );

    return {
      ...result,
      queued,
      complete,
    };
  }, [library, lastPacket?.game.id]);

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
        <section className={styles.downloadsContainer}>
          <div className={styles.downloadGroups}>
            {downloadGroups.map((group) => (
              <DownloadGroup
                key={group.title}
                title={group.title}
                library={group.library}
                openDeleteGameModal={handleOpenDeleteGameModal}
                openGameInstaller={handleOpenGameInstaller}
                seedingStatus={seedingStatus}
              />
            ))}
          </div>
        </section>
      ) : (
        <div className={styles.noDownloads}>
          <div className={styles.arrowIcon}>
            <ArrowDownIcon size={24} />
          </div>
          <h2>{t("no_downloads_title")}</h2>
          <p>{t("no_downloads_description")}</p>
        </div>
      )}
    </>
  );
}
