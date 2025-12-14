import { useTranslation } from "react-i18next";
import { ConfirmationModal } from "@renderer/components";

interface ArchiveDeletionModalProps {
  visible: boolean;
  archivePaths: string[];
  onClose: () => void;
}

export function ArchiveDeletionModal({
  visible,
  archivePaths,
  onClose,
}: Readonly<ArchiveDeletionModalProps>) {
  const { t } = useTranslation("downloads");

  const fullFileName =
    archivePaths.length > 0 ? (archivePaths[0].split(/[/\\]/).pop() ?? "") : "";

  const maxLength = 40;
  const fileName =
    fullFileName.length > maxLength
      ? `${fullFileName.slice(0, maxLength)}…`
      : fullFileName;

  const handleConfirm = async () => {
    for (const archivePath of archivePaths) {
      await window.electron.deleteArchive(archivePath);
    }
    onClose();
  };

  return (
    <ConfirmationModal
      visible={visible}
      title={t("delete_archive_title", { fileName })}
      descriptionText={t("delete_archive_description")}
      confirmButtonLabel={t("yes")}
      cancelButtonLabel={t("no")}
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}
