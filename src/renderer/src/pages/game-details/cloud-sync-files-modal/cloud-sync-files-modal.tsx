import { Button, Modal, ModalProps, TextField } from "@renderer/components";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { CheckCircleFillIcon, FileDirectoryIcon } from "@primer/octicons-react";

import "./cloud-sync-files-modal.scss";
import { formatBytes } from "@shared";
import { useToast } from "@renderer/hooks";
import { useForm } from "react-hook-form";

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
  const { backupPreview, getGameBackupPreview } = useContext(cloudSyncContext);
  const { shop, objectId } = useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");

  const { showSuccessToast } = useToast();

  const { register, setValue } = useForm<{
    customBackupPath: string | null;
  }>({
    defaultValues: {
      customBackupPath: null,
    },
  });

  useEffect(() => {
    if (backupPreview?.customBackupPath) {
      setSelectedFileMappingMethod(FileMappingMethod.Manual);
    } else {
      setSelectedFileMappingMethod(FileMappingMethod.Automatic);
    }

    setValue("customBackupPath", backupPreview?.customBackupPath ?? null);
  }, [visible, setValue, backupPreview]);

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

  const handleAddCustomPathClick = useCallback(async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];
      setValue("customBackupPath", path);

      await window.electron.selectGameBackupPath(shop, objectId!, path);
      showSuccessToast(t("custom_backup_location_set"));
      getGameBackupPreview();
    }
  }, [objectId, setValue, shop, showSuccessToast, getGameBackupPreview, t]);

  const handleFileMappingMethodClick = useCallback(
    (mappingOption: FileMappingMethod) => {
      if (mappingOption === FileMappingMethod.Automatic) {
        getGameBackupPreview();
        window.electron.selectGameBackupPath(shop, objectId!, null);
      }

      setSelectedFileMappingMethod(mappingOption);
    },
    [getGameBackupPreview, shop, objectId]
  );

  return (
    <Modal
      visible={visible}
      title={t("manage_files")}
      description={t("manage_files_description")}
      onClose={onClose}
    >
      <div className="cloud-sync-files-modal__container">
        <span className="cloud-sync-files-modal__mapping-label">
          {t("mapping_method_label")}
        </span>

        <div className="cloud-sync-files-modal__mapping-methods">
          {Object.values(FileMappingMethod).map((mappingMethod) => (
            <Button
              key={mappingMethod}
              theme={
                selectedFileMappingMethod === mappingMethod
                  ? "primary"
                  : "outline"
              }
              onClick={() => handleFileMappingMethodClick(mappingMethod)}
            >
              {selectedFileMappingMethod === mappingMethod && (
                <CheckCircleFillIcon />
              )}
              {t(`mapping_method_${mappingMethod.toLowerCase()}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="cloud-sync-files-modal__custom-path">
        {selectedFileMappingMethod === FileMappingMethod.Automatic ? (
          <p>{t("files_automatically_mapped")}</p>
        ) : (
          <TextField
            {...register("customBackupPath")}
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
          />
        )}

        <ul className="cloud-sync-files-modal__file-list">
          {files.map((file) => (
            <li key={file.path} className="cloud-sync-files-modal__file-item">
              <button
                className="cloud-sync-files-modal__file-item"
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
