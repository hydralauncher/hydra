import { Button, Modal, ModalProps } from "@renderer/components";
import { useContext, useMemo, useState } from "react";
import { cloudSyncContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { CheckCircleFillIcon } from "@primer/octicons-react";

import * as styles from "./cloud-sync-files-modal.css";
import { formatBytes } from "@shared";
import { vars } from "@renderer/theme.css";
// import { useToast } from "@renderer/hooks";

export interface CloudSyncFilesModalProps
  extends Omit<ModalProps, "children" | "title"> {}

export enum FileMappingMethod {
  Automatic = "AUTOMATIC",
  Manual = "MANUAL",
}

export function CloudSyncFilesModal({
  visible,
  onClose,
}: CloudSyncFilesModalProps) {
  const [selectedFileMappingMethod, setSelectedFileMappingMethod] =
    useState<FileMappingMethod>(FileMappingMethod.Automatic);
  const { backupPreview } = useContext(cloudSyncContext);
  // const { gameTitle } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  // const { showSuccessToast } = useToast();

  const files = useMemo(() => {
    if (!backupPreview) {
      return [];
    }

    const [game] = Object.values(backupPreview.games);
    if (!game) return [];
    const entries = Object.entries(game.files);

    return entries.map(([key, value]) => {
      return { path: key, ...value };
    });
  }, [backupPreview]);

  // const handleAddCustomPathClick = useCallback(async () => {
  //   const { filePaths } = await window.electron.showOpenDialog({
  //     properties: ["openDirectory"],
  //   });

  //   if (filePaths && filePaths.length > 0) {
  //     const path = filePaths[0];
  //     await window.electron.selectGameBackupDirectory(gameTitle, path);
  //     showSuccessToast("custom_backup_location_set");
  //     getGameBackupPreview();
  //   }
  // }, [gameTitle, showSuccessToast, getGameBackupPreview]);

  return (
    <Modal
      visible={visible}
      title="Gerenciar arquivos"
      description="Escolha quais diretórios serão sincronizados"
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span>{t("mapping_method_label")}</span>

        <div className={styles.mappingMethods}>
          {Object.values(FileMappingMethod).map((mappingMethod) => (
            <Button
              key={mappingMethod}
              theme={
                selectedFileMappingMethod === mappingMethod
                  ? "primary"
                  : "outline"
              }
              onClick={() => setSelectedFileMappingMethod(mappingMethod)}
              disabled={mappingMethod === FileMappingMethod.Manual}
            >
              {selectedFileMappingMethod === mappingMethod && (
                <CheckCircleFillIcon />
              )}
              {t(`mapping_method_${mappingMethod.toLowerCase()}`)}
            </Button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {/* <TextField
          readOnly
          theme="dark"
          disabled
          placeholder={t("select_folder")}
          rightContent={
            <Button
              type="button"
              theme="outline"
              onClick={handleAddCustomPathClick}
            >
              <FileDirectoryIcon />
              {t("select_executable")}
            </Button>
          }
        /> */}

        <p>{t("files_automatically_mapped")}</p>

        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 16,
          }}
        >
          {files.map((file) => (
            <li key={file.path} style={{ display: "flex" }}>
              <button
                style={{
                  flex: 1,
                  color: vars.color.muted,
                  textDecoration: "underline",
                  display: "flex",
                  cursor: "pointer",
                }}
                onClick={() => window.electron.showItemInFolder(file.path)}
              >
                {file.path.split("/").at(-1)}
              </button>
              <p>{formatBytes(file.bytes)}</p>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
