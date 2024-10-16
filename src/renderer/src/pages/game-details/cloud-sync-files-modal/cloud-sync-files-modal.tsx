import { Modal, ModalProps } from "@renderer/components";
import { useContext, useMemo } from "react";
import { cloudSyncContext } from "@renderer/context";

export interface CloudSyncFilesModalProps
  extends Omit<ModalProps, "children" | "title"> {}

export function CloudSyncFilesModal({
  visible,
  onClose,
}: CloudSyncFilesModalProps) {
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

      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Arquivo</th>
            <th style={{ textAlign: "left" }}>Hash</th>
            <th style={{ textAlign: "left" }}>Tamanho</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.path}>
              <td style={{ textAlign: "left" }}>{file.path}</td>
              <td style={{ textAlign: "left" }}>{file.change}</td>
              <td style={{ textAlign: "left" }}>{file.path}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
