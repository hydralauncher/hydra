import type { DownloadDirectoryPreference } from "@types";
import { Button, Modal, SelectField } from "@renderer/components";
import { getDownloadDirectoryTitle } from "@shared";
import { useTranslation } from "react-i18next";
import "./download-directory-replacement-modal.scss";

interface DownloadDirectoryReplacementModalProps {
  visible: boolean;
  nextPath: string;
  directories: DownloadDirectoryPreference[];
  selectedReplacementPath: string;
  onSelectedReplacementPathChange: (path: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function DownloadDirectoryReplacementModal({
  visible,
  nextPath,
  directories,
  selectedReplacementPath,
  onSelectedReplacementPathChange,
  onClose,
  onConfirm,
}: Readonly<DownloadDirectoryReplacementModalProps>) {
  const { t } = useTranslation("settings");

  const replacementOptions = directories.map((directory) => ({
    key: directory.path,
    value: directory.path,
    label: `${getDownloadDirectoryTitle(directory.path)} — ${directory.path}`,
  }));

  return (
    <Modal
      visible={visible}
      title={t("replace_download_directory")}
      description={t("replace_download_directory_description")}
      onClose={onClose}
    >
      <div className="download-directory-replacement-modal">
        <div className="download-directory-replacement-modal__summary">
          <p className="download-directory-replacement-modal__label">
            {t("new_default_path")}
          </p>
          <p className="download-directory-replacement-modal__path">
            {nextPath}
          </p>
        </div>

        <div className="download-directory-replacement-modal__controls">
          <SelectField
            className="download-directory-replacement-modal__select"
            label={t("replace_saved_big_picture_directory")}
            value={selectedReplacementPath}
            onChange={(event) =>
              onSelectedReplacementPathChange(event.target.value)
            }
            options={replacementOptions}
          />
          <Button
            theme="primary"
            className="download-directory-replacement-modal__confirm"
            disabled={!selectedReplacementPath}
            onClick={onConfirm}
          >
            {t("replace_and_use_new_path")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
