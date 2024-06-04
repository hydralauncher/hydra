import { useTranslation } from "react-i18next";

import { useDownload, useLibrary } from "@renderer/hooks";

import { useMemo, useRef, useState } from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import * as styles from "./downloads.css";
import { DeleteGameModal } from "./delete-game-modal";
import { DownloadGroup } from "./download-group";
import { LibraryGame } from "@types";
import { orderBy } from "lodash-es";

export function Downloads() {
  const { library, updateLibrary } = useLibrary();

  const { t } = useTranslation("downloads");

  const gameToBeDeleted = useRef<number | null>(null);

  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { removeGameInstaller } = useDownload();

  const handleDeleteGame = async () => {
    if (gameToBeDeleted.current)
      await removeGameInstaller(gameToBeDeleted.current);
  };

  const { lastPacket } = useDownload();

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

    const result = library
      .filter((game) => {
        return game.downloadPath;
      })
      .reduce((prev, next) => {
        if (lastPacket?.game.id === next.id) {
          return { ...prev, downloading: [...prev.downloading, next] };
        }

        if (next.downloadQueue || next.status === "paused") {
          return { ...prev, queued: [...prev.queued, next] };
        }

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

  return (
    <section className={styles.downloadsContainer}>
      <BinaryNotFoundModal
        visible={showBinaryNotFoundModal}
        onClose={() => setShowBinaryNotFoundModal(false)}
      />

      <DeleteGameModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        deleteGame={handleDeleteGame}
      />

      <div className={styles.downloadGroups}>
        {downloadGroups.map((group) => (
          <DownloadGroup
            key={group.title}
            title={group.title}
            library={group.library}
            openDeleteGameModal={handleOpenDeleteGameModal}
            openGameInstaller={handleOpenGameInstaller}
          />
        ))}
      </div>
    </section>
  );
}
