import type { DownloadDirectoryPreference } from "@types";
import { Button, Modal, SelectField } from "@renderer/components";
import { getDownloadDirectoryTitle } from "@shared";
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
  const replacementOptions = directories.map((directory) => ({
    key: directory.path,
    value: directory.path,
    label: `${getDownloadDirectoryTitle(directory.path)} — ${directory.path}`,
  }));

  return (
    <Modal
      visible={visible}
      title="Replace Download Directory"
      description="Your Big Picture download directory list is full. Choose which saved directory to replace with the new default path."
      onClose={onClose}
    >
      <div className="download-directory-replacement-modal">
        <div className="download-directory-replacement-modal__summary">
          <p className="download-directory-replacement-modal__label">
            New default path
          </p>
          <p className="download-directory-replacement-modal__path">
            {nextPath}
          </p>
        </div>

        <div className="download-directory-replacement-modal__controls">
          <SelectField
            className="download-directory-replacement-modal__select"
            label="Replace this saved Big Picture directory"
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
            Replace and Use New Path
          </Button>
        </div>
      </div>
    </Modal>
  );
}
