import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import { useTranslation } from "react-i18next";
import "./modals.scss";
import { Theme } from "@types";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { useToast } from "@renderer/hooks";

interface ImportThemeModalProps {
  visible: boolean;
  onClose: () => void;
  onThemeImported: () => void;
  themeName: string;
  authorCode: string;
}

export const ImportThemeModal = ({
  visible,
  onClose,
  onThemeImported,
  themeName,
  authorCode,
}: ImportThemeModalProps) => {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const handleImportTheme = async () => {
    const theme: Theme = {
      id: crypto.randomUUID(),
      name: themeName,
      isActive: false,
      author: authorCode,
      authorName: "spectre",
      code: `https://hydrathemes.shop/themes/${themeName}.css`,
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
        await window.electron.updateCustomTheme(activeTheme.id, {
          ...activeTheme,
          isActive: false,
        });
      }

      if (currentTheme.code) {
        injectCustomCss(currentTheme.code);
      }

      await window.electron.updateCustomTheme(currentTheme.id, {
        ...currentTheme,
        isActive: true,
      });
      onThemeImported();
      showSuccessToast(t("theme_imported"));
      onClose();
    } catch (error) {
      console.error(error);
      showErrorToast(t("error_importing_theme"));
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("import_theme")}
      description={t("import_theme_description")}
      onClose={onClose}
    >
      <div className="delete-all-themes-modal__container">
        <Button theme="outline" onClick={handleImportTheme}>
          {t("import_theme")}
        </Button>

        <Button theme="primary" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
};
