import { Button, Modal, ModalProps, TextField } from "@renderer/components";
import { useContext, useMemo } from "react";
import { cloudSyncContext } from "@renderer/context";

import { useTranslation } from "react-i18next";
import { CheckCircleFillIcon } from "@primer/octicons-react";

export interface CloudSyncFilesModalProps
  extends Omit<ModalProps, "children" | "title"> {}

export function CloudSyncFilesModal({
  visible,
  onClose,
}: CloudSyncFilesModalProps) {
  const { t } = useTranslation("game_details");

  const { backupPreview } = useContext(cloudSyncContext);

  const files = useMemo(() => {
    if (!backupPreview) {
      return [];
    }

    const [game] = Object.values(backupPreview.games);
    const entries = Object.entries(game.files);

    return entries.map(([key, value]) => {
      return { path: key, ...value };
    });
  }, [backupPreview]);

  return (
    <Modal
      visible={visible}
      title="Gerenciar arquivos"
      description="Escolha quais diretórios serão sincronizados"
      onClose={onClose}
    >
      {/* <div className={styles.downloaders}>
        {["AUTOMATIC", "CUSTOM"].map((downloader) => (
          <Button
            key={downloader}
            className={styles.downloaderOption}
            theme={selectedDownloader === downloader ? "primary" : "outline"}
            disabled={
              downloader === Downloader.RealDebrid &&
              !userPreferences?.realDebridApiToken
            }
            onClick={() => setSelectedDownloader(downloader)}
          >
            {selectedDownloader === downloader && (
              <CheckCircleFillIcon className={styles.downloaderIcon} />
            )}
            {DOWNLOADER_NAME[downloader]}
          </Button>
        ))}
      </div> */}

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          gap: 16,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {files.map((file) => (
          <li key={file.path}>
            <TextField value={file.path} readOnly />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
