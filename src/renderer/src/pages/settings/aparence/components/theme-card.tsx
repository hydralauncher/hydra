import { PencilIcon, TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import type { Theme } from "../themes-manager";
import { useNavigate } from "react-router-dom";
import "./theme-card.scss";

interface ThemeCardProps {
  theme: Theme;
  handleSetTheme: (themeId: string) => void;
  handleDeleteTheme: (themeId: string) => void;
}

export const ThemeCard = ({
  theme,
  handleSetTheme,
  handleDeleteTheme,
}: ThemeCardProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
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

      {theme.author && theme.authorId && (
        <p className="theme-card__author">
          {t("by")}

          <span
            className="theme-card__author__name"
            onClick={() => navigate(`/profile/${theme.authorId}`)}
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
            <Button onClick={() => handleSetTheme(theme.id)} theme="outline">
              {t("set_theme")}
            </Button>
          )}
        </div>

        <div className="theme-card__actions__right">
          <Button title={t("edit_theme")} theme="outline">
            <PencilIcon />
          </Button>

          <Button
            onClick={() => handleDeleteTheme(theme.id)}
            title={t("delete_theme")}
            theme="outline"
          >
            <TrashIcon />
          </Button>
        </div>
      </div>
    </div>
  );
};
