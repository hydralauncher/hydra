import { Modal, ModalProps } from "@renderer/components";
import { useContext, useMemo } from "react";
import { cloudSyncContext } from "@renderer/context";
// import { useTranslation } from "react-i18next";

export interface CloudSyncFilesModalProps
  extends Omit<ModalProps, "children" | "title"> {}

export function CloudSyncFilesModal({
  visible,
  onClose,
}: CloudSyncFilesModalProps) {
  const { backupPreview } = useContext(cloudSyncContext);

  // const { t } = useTranslation("game_details");

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
      {/* <div>
        {["AUTOMATIC", "CUSTOM"].map((downloader) => (
          <Button
            key={downloader}
            // className={styles.downloaderOption}
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

      {/* <TextField
        // value={game.executablePath || ""}
        readOnly
        theme="dark"
        disabled
        placeholder={t("no_directory_selected")}
        rightContent={
          <Button
            type="button"
            theme="outline"
            onClick={handleChangeExecutableLocation}
          >
            {t("select_directory")}
          </Button>
        }
      /> */}

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
