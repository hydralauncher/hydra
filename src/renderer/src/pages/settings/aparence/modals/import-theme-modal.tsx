import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import { useTranslation } from "react-i18next";
import "./modals.scss";
import { Theme } from "@types";
import {
  injectCustomCss,
  removeCustomCss,
  generateUUID,
} from "@renderer/helpers";
import { useToast } from "@renderer/hooks";
import { THEME_WEB_STORE_URL } from "@renderer/constants";
import { logger } from "@renderer/logger";
import { levelDBService } from "@renderer/services/leveldb.service";

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
      id: generateUUID(),
      name: themeName,
      isActive: false,
      author: authorId,
      authorName: authorName,
      code: `${THEME_WEB_STORE_URL}/themes/${themeName.toLowerCase()}/theme.css`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await levelDBService.put(theme.id, theme, "themes");

      const currentTheme = (await levelDBService.get(
        theme.id,
        "themes"
      )) as Theme | null;

      if (!currentTheme) return;

      try {
        await window.electron.importThemeSoundFromStore(
          theme.id,
          themeName,
          THEME_WEB_STORE_URL
        );
      } catch (soundError) {
        logger.error("Failed to import theme sound", soundError);
      }

      const allThemes = (await levelDBService.values("themes")) as {
        id: string;
        isActive?: boolean;
      }[];
      const activeTheme = allThemes.find((t) => t.isActive);

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
