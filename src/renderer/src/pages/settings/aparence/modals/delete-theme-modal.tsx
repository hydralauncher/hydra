import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import { useTranslation } from "react-i18next";
import "./modals.scss";
import { removeCustomCss } from "@renderer/helpers";

interface DeleteThemeModalProps {
  visible: boolean;
  onClose: () => void;
  themeId: string;
  isActive: boolean;
  onThemeDeleted: () => void;
  themeName: string;
}

export const DeleteThemeModal = ({
  visible,
  onClose,
  themeId,
  isActive,
  onThemeDeleted,
  themeName,
}: DeleteThemeModalProps) => {
  const { t } = useTranslation("settings");

  const handleDeleteTheme = async () => {
    if (isActive) {
      removeCustomCss();
    }

    await window.electron.deleteCustomTheme(themeId);
    onThemeDeleted();
  };

  return (
    <Modal
      visible={visible}
      title={t("delete_theme")}
      description={t("delete_theme_description", { theme: themeName })}
      onClose={onClose}
    >
      <div className="delete-all-themes-modal__container">
        <Button theme="outline" onClick={handleDeleteTheme}>
          {t("delete_theme")}
        </Button>

        <Button theme="primary" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
};
