import { vars } from "@renderer/theme.css";
import { Theme, UserPreferences } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { setElementVars } from "@vanilla-extract/dynamic";
import * as styles from "./settings-appearance.css";
import { Button } from "@renderer/components";

export interface SettingsAppearanceProps {
  userPreferences: UserPreferences | null;
  updateUserPreferences: (values: Partial<UserPreferences>) => void;
}

export function SettingsAppearance({
  updateUserPreferences,
  userPreferences,
}: SettingsAppearanceProps) {
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const { t } = useTranslation("settings");

  useEffect(() => {
    const loadAvailableThemes = async () => {
      const loadedThemes = await window.electron.loadThemes();
      setThemes(loadedThemes);
    };

    loadAvailableThemes();
  }, [userPreferences?.theme]);

  useEffect(() => {
    if (selectedTheme) {
      updateUserPreferences({ theme: selectedTheme });
    }
  }, [selectedTheme, updateUserPreferences]);

  const applyTheme = (theme: Theme) => {
    localStorage.setItem("theme", JSON.stringify(theme));
    setElementVars(document.body, {
      [vars.color.background]: theme.scheme.background,
      [vars.color.darkBackground]: theme.scheme.darkBackground,
      [vars.color.muted]: theme.scheme.muted,
      [vars.color.bodyText]: theme.scheme.bodyText,
      [vars.color.border]: theme.scheme.border,
    });
  };

  const handleThemeChange = (theme: Theme) => {
    setSelectedTheme(theme);
    applyTheme(theme);
  };

  const handleKeyPress = (
    event: React.KeyboardEvent<HTMLDivElement>,
    theme: Theme
  ) => {
    if (event.key === "Enter") {
      handleThemeChange(theme);
    }
  };

  const openFolder = () => {
    window.electron.openPath();
  };

  return (
    <>
      <h3>{t("Available Themes")}:</h3>
      <Button onClick={openFolder} style={{ alignSelf: "flex-start" }}>
        {t("Open folder")}
      </Button>
      <ul className={styles.themeContainer}>
        {themes.map((theme) => (
          <li key={theme.name} className={styles.themeItem}>
            <div
              className={styles.themePreview}
              style={{
                backgroundColor: theme.scheme.background,
                border: `2px solid ${theme.scheme.border}`,
              }}
              onClick={() => handleThemeChange(theme)}
              onKeyDown={(event) => handleKeyPress(event, theme)}
              tabIndex={0}
              role="button"
            >
              <p style={{ color: theme.scheme.bodyText }}>
                {t("Welcome to Hydra")}
              </p>
            </div>
            <div className={styles.themeInfo}>
              <h3>{theme.name}</h3>
              <p>
                {t("Created by")}: {theme.createdBy}
              </p>
              <ul className={styles.themeScheme}>
                {Object.values(theme.scheme).map((color, index) => (
                  <li
                    key={index}
                    className={styles.themeColor}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
