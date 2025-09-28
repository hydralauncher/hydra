import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import { useTranslation } from "react-i18next";
import "./modals.scss";
import { removeCustomCss } from "@renderer/helpers";

interface DeleteAllThemesModalProps {
  visible: boolean;
  onClose: () => void;
  onThemesDeleted: () => void;
}

export const DeleteAllThemesModal = ({
  visible,
  onClose,
  onThemesDeleted,
}: DeleteAllThemesModalProps) => {
  const { t } = useTranslation("settings");

  const handleDeleteAllThemes = async () => {
    const activeTheme = await window.electron.getActiveCustomTheme();

    if (activeTheme) {
      removeCustomCss();
    }

    await window.electron.deleteAllCustomThemes();
    await window.electron.closeEditorWindow();
    onClose();
    onThemesDeleted();
  };

  return (
    <Modal
      visible={visible}
      title={t("delete_all_themes")}
      description={t("delete_all_themes_description")}
      onClose={onClose}
    >
      <div className="delete-all-themes-modal__container">
        <Button theme="outline" onClick={onClose}>
          {t("cancel")}
        </Button>

        <Button theme="primary" onClick={handleDeleteAllThemes}>
          {t("delete_all_themes")}
        </Button>
      </div>
    </Modal>
  );
};
