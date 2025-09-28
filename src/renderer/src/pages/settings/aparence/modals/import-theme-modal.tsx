import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import { useTranslation } from "react-i18next";
import "./modals.scss";
import { Theme } from "@types";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { useToast } from "@renderer/hooks";
import { THEME_WEB_STORE_URL } from "@renderer/constants";
import { logger } from "@renderer/logger";

interface ImportThemeModalProps {
  visible: boolean;
  onClose: () => void;
  onThemeImported: () => void;
  themeName: string;
  authorId: string;
  authorName: string;
}

export const ImportThemeModal = ({
  visible,
  onClose,
  onThemeImported,
  themeName,
  authorId,
  authorName,
}: ImportThemeModalProps) => {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const handleImportTheme = async () => {
    const theme: Theme = {
      id: crypto.randomUUID(),
      name: themeName,
      isActive: false,
      author: authorId,
      authorName: authorName,
      code: `${THEME_WEB_STORE_URL}/themes/${themeName.toLowerCase()}/theme.css`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await window.electron.addCustomTheme(theme);

      const currentTheme = await window.electron.getCustomThemeById(theme.id);

      if (!currentTheme) return;

      const activeTheme = await window.electron.getActiveCustomTheme();

      if (activeTheme) {
        removeCustomCss();
        await window.electron.toggleCustomTheme(activeTheme.id, false);
      }

      if (currentTheme.code) {
        injectCustomCss(currentTheme.code);
      }

      await window.electron.toggleCustomTheme(currentTheme.id, true);
      onThemeImported();
      showSuccessToast(t("theme_imported"));
      onClose();
    } catch (error) {
      logger.error(error);
      showErrorToast(t("error_importing_theme"));
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("import_theme")}
      description={t("import_theme_description", { theme: themeName })}
      onClose={onClose}
    >
      <div className="delete-all-themes-modal__container">
        <Button theme="outline" onClick={onClose}>
          {t("cancel")}
        </Button>

        <Button theme="primary" onClick={handleImportTheme}>
          {t("import_theme")}
        </Button>
      </div>
    </Modal>
  );
};
