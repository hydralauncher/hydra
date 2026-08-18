import { CopyIcon, PencilIcon, TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import { Toggle } from "@renderer/components/toggle/toggle";
import type { Theme } from "@types";
import { useNavigate } from "react-router-dom";
import "./theme-card.scss";
import { useState } from "react";
import { DeleteThemeModal } from "../modals/delete-theme-modal";
import {
  injectCustomCss,
  removeCustomCss,
  generateUUID,
} from "@renderer/helpers";
import { THEME_WEB_STORE_URL } from "@renderer/constants";
import { levelDBService } from "@renderer/services/leveldb.service";
import { useUserDetails } from "@renderer/hooks";

interface ThemeCardProps {
  theme: Theme;
  onListUpdated: () => void;
}

export const ThemeCard = ({ theme, onListUpdated }: ThemeCardProps) => {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const { userDetails } = useUserDetails();

  const [deleteThemeModalVisible, setDeleteThemeModalVisible] = useState(false);

  const handleToggleTheme = async (active: boolean) => {
    try {
      if (active) {
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

        if (currentTheme.code) injectCustomCss(currentTheme.code);
        await window.electron.toggleCustomTheme(currentTheme.id, true);
      } else {
        removeCustomCss();
        await window.electron.toggleCustomTheme(theme.id, false);
      }

      onListUpdated();
    } catch (error) {
      // handled silently
    }
  };

  const handleClone = async () => {
    const cloned: Theme = {
      id: generateUUID(),
      name: `${theme.name} (clone)`,
      author: userDetails?.id,
      authorName: userDetails?.username,
      isActive: false,
      code: theme.code.startsWith(THEME_WEB_STORE_URL)
        ? `/* Cloned from: ${theme.name} */\n\n`
        : theme.code,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await levelDBService.put(cloned.id, cloned, "themes");
    onListUpdated();
  };

  const isExternal = theme.code.startsWith(THEME_WEB_STORE_URL);

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
          <Toggle checked={!!theme.isActive} onChange={handleToggleTheme} />
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

        {theme.isActive && (
          <span className="theme-card__active-badge">
            {t("active", { defaultValue: "Ativo" })}
          </span>
        )}

        <div className="theme-card__actions">
          <Button
            onClick={handleClone}
            title={t("clone_theme", { defaultValue: "Clonar como editável" })}
            theme="outline"
            className="theme-card__clone-btn"
          >
            <CopyIcon size={14} />
            {t("clone_theme", { defaultValue: "Clonar" })}
          </Button>

          <div className="theme-card__actions__right">
            {!isExternal && (
              <Button
                onClick={() => window.electron.openEditorWindow(theme.id)}
                title={t("edit_theme")}
                theme="outline"
              >
                <PencilIcon size={14} />
              </Button>
            )}

            <Button
              onClick={() => setDeleteThemeModalVisible(true)}
              title={t("delete_theme")}
              theme="outline"
            >
              <TrashIcon size={14} />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};
