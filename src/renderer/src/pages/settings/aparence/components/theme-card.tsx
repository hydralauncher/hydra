import { PathTool, Trash } from "iconsax-reactjs";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import type { Theme } from "@types";
import { useNavigate } from "react-router-dom";
import "./theme-card.scss";
import { useState } from "react";
import { DeleteThemeModal } from "../modals/delete-theme-modal";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { THEME_WEB_STORE_URL } from "@renderer/constants";
import { levelDBService } from "@renderer/services/leveldb.service";

interface ThemeCardProps {
  theme: Theme;
  onListUpdated: () => void;
}

export const ThemeCard = ({ theme, onListUpdated }: ThemeCardProps) => {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();

  const [deleteThemeModalVisible, setDeleteThemeModalVisible] = useState(false);

  const handleSetTheme = async () => {
    try {
      const currentTheme = (await levelDBService.get(
        theme.id,
        "themes"
      )) as Theme | null;

      if (!currentTheme) return;

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

      onListUpdated();
    } catch (error) {
      console.error(error);
    }
  };

  const handleUnsetTheme = async () => {
    try {
      removeCustomCss();
      await window.electron.toggleCustomTheme(theme.id, false);

      onListUpdated();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <>
      <DeleteThemeModal
        visible={deleteThemeModalVisible}
        onClose={() => setDeleteThemeModalVisible(false)}
        onThemeDeleted={onListUpdated}
        themeId={theme.id}
        themeName={theme.name}
        isActive={theme.isActive}
      />

      <div
        className={`theme-card ${theme.isActive ? "theme-card--active" : ""}`}
        key={theme.name}
      >
        <div className="theme-card__header">
          <div className="theme-card__header__title">{theme.name}</div>
        </div>

        {theme.authorName && (
          <p className="theme-card__author">
            {t("by")}

            <button
              className="theme-card__author__name"
              onClick={() => navigate(`/profile/${theme.author}`)}
            >
              {theme.authorName}
            </button>
          </p>
        )}

        <div className="theme-card__actions">
          <div className="theme-card__actions__left">
            {theme.isActive ? (
              <Button onClick={handleUnsetTheme} theme="dark">
                {t("unset_theme")}
              </Button>
            ) : (
              <Button onClick={handleSetTheme} theme="outline">
                {t("set_theme")}
              </Button>
            )}
          </div>

          <div className="theme-card__actions__right">
            <Button
              className={
                theme.code.startsWith(THEME_WEB_STORE_URL)
                  ? "theme-card__actions__right--external"
                  : ""
              }
              onClick={() => window.electron.openEditorWindow(theme.id)}
              title={t("edit_theme")}
              theme="outline"
            >
              <PathTool size={20} variant="Linear" />
            </Button>

            <Button
              onClick={() => setDeleteThemeModalVisible(true)}
              title={t("delete_theme")}
              theme="outline"
            >
              <Trash size={20} variant="Linear" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};
