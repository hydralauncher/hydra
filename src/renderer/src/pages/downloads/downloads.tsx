import { useTranslation } from "react-i18next";

import { useDownload, useLibrary } from "@renderer/hooks";

import { useMemo, useRef, useState } from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import * as styles from "./downloads.css";
import { DeleteGameModal } from "./delete-game-modal";
import { DownloadList } from "./download-list";
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

  const libraryGroup: Record<string, LibraryGame[]> = useMemo(() => {
    const initialValue: Record<string, LibraryGame[]> = {
      downloading: [],
      queued: [],
      complete: [],
    };

    const result = library.reduce((prev, next) => {
      if (lastPacket?.game.id === next.id) {
        return { ...prev, downloading: [...prev.downloading, next] };
      }

      if (next.downloadQueue) {
        return { ...prev, queued: [...prev.queued, next] };
      }

      return { ...prev, complete: [...prev.complete, next] };
    }, initialValue);

    return {
      ...result,
      queued: orderBy(result.queued, (game) => game.downloadQueue?.id, [
        "desc",
      ]),
    };
  }, [library, lastPacket?.game.id]);

  console.log(libraryGroup);

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
        {libraryGroup.downloading.length > 0 && (
          <div className={styles.downloadGroup}>
            <h2>{t("download_in_progress")}</h2>
            <DownloadList library={libraryGroup.downloading} />
          </div>
        )}

        {libraryGroup.queued.length > 0 && (
          <div className={styles.downloadGroup}>
            <h2>{t("queued_downloads")}</h2>
            <DownloadList library={libraryGroup.queued} />
          </div>
        )}

        {libraryGroup.complete.length > 0 && (
          <div className={styles.downloadGroup}>
            <h2>{t("downloads_complete")}</h2>
            <DownloadList library={libraryGroup.complete} />
          </div>
        )}
      </div>
    </section>
  );
}
