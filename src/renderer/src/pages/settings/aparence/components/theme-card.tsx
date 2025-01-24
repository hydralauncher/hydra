import { PencilIcon, TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import type { Theme } from "@types";
import { useNavigate } from "react-router-dom";
import "./theme-card.scss";
import { useState } from "react";
import { DeleteThemeModal } from "../modals/delete-theme-modal";

interface ThemeCardProps {
  theme: Theme;
  onListUpdated: () => void;
}

export const ThemeCard = ({ theme, onListUpdated }: ThemeCardProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [deleteThemeModalVisible, setDeleteThemeModalVisible] = useState(false);

  return (
    <>
      <DeleteThemeModal
        visible={deleteThemeModalVisible}
        onClose={() => setDeleteThemeModalVisible(false)}
        onThemeDeleted={onListUpdated}
        themeId={theme.id}
      />

      <div
        className={`theme-card ${theme.isActive ? "theme-card--active" : ""}`}
        key={theme.name}
      >
        <div className="theme-card__header">
          <div className="theme-card__header__title">{theme.name}</div>

          <div className="theme-card__header__colors">
            {Object.entries(theme.colors).map(([key, color]) => (
              <div
                title={color}
                style={{ backgroundColor: color }}
                className="theme-card__header__colors__color"
                key={key}
              >
                {/* color circle */}
              </div>
            ))}
          </div>
        </div>

        {theme.author && theme.author && (
          <p className="theme-card__author">
            {t("by")}

            <span
              className="theme-card__author__name"
              onClick={() => navigate(`/profile/${theme.author}`)}
            >
              {theme.author}
            </span>
          </p>
        )}

        <div className="theme-card__actions">
          <div className="theme-card__actions__left">
            {theme.isActive ? (
              <Button theme="dark">{t("unset_theme	")}</Button>
            ) : (
              <Button theme="outline">{t("set_theme")}</Button>
            )}
          </div>

          <div className="theme-card__actions__right">
            <Button title={t("edit_theme")} theme="outline">
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
