import { PencilIcon, TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import type { Theme } from "@types";
import { useNavigate } from "react-router-dom";
import "./theme-card.scss";
import { useState } from "react";
import { DeleteThemeModal } from "../modals/delete-theme-modal";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";

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

      onListUpdated();
    } catch (error) {
      console.error(error);
    }
  };

  const handleUnsetTheme = async () => {
    try {
      removeCustomCss();
      await window.electron.updateCustomTheme(theme.id, {
        ...theme,
        isActive: false,
      });

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
                theme.code.startsWith("https://hydrathemes.shop/")
                  ? "theme-card__actions__right--external"
                  : ""
              }
              onClick={() => window.electron.openEditorWindow(theme.id)}
              title={t("edit_theme")}
              theme="outline"
            >
              <PencilIcon />
            </Button>

            <Button
              onClick={() => setDeleteThemeModalVisible(true)}
              title={t("delete_theme")}
              theme="outline"
            >
              <TrashIcon />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};
