import { useState, useEffect } from "react";
import { themeColor, themeContainer, themeInfo, themeItem, themePreview, themeScheme } from "./theme.css";
import { useTranslation } from "react-i18next";
import { vars } from "@renderer/theme.css";
import { setElementVars } from '@vanilla-extract/dynamic';
import { Theme } from "@types";


const ThemesList = ({ themes }) => {
  const [selectedTheme, setSelectedTheme] = useState(null);

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (selectedTheme) {
      localStorage.setItem("theme", JSON.stringify(selectedTheme));
    }
  }, [selectedTheme]);

  const setTheme = (theme) => {
    setSelectedTheme(theme);
    updateTheme(theme)
  };

  const updateTheme = (theme: Theme) => {
    setElementVars(document.body, {
      [vars.color.background]: theme.scheme.background,
      [vars.color.darkBackground]: theme.scheme.darkBackground,
      [vars.color.muted]: theme.scheme.muted,
      [vars.color.bodyText]: theme.scheme.bodyText,
      [vars.color.border]: theme.scheme.border
    });
  }


  return (
    <div>
      <h2>{t("Available Themes")}:</h2>
      <ul className={themeContainer}>
        {themes.map((theme: Theme, index: number) => (
          <li key={index} className={themeItem} onClick={() => { setTheme(theme) }} >
            <div className={themePreview} style={{ backgroundColor: theme.scheme.background, border: `2px solid${theme.scheme.border}` }}>
              <p style={{ color: theme.scheme.bodyText }}>
                {t("Welcome to Hydra")!}
              </p>
            </div>
            <div className={themeInfo}>
              <h3>{theme.name}</h3>
              <p>{t("Created by")}: {theme.createdBy}</p>
              <ul className={themeScheme}>
                <li className={themeColor} style={{ backgroundColor: theme.scheme.font }}></li>
                <li className={themeColor} style={{ backgroundColor: theme.scheme.background }}></li>
                <li className={themeColor} style={{ backgroundColor: theme.scheme.darkBackground }}></li>
                <li className={themeColor} style={{ backgroundColor: theme.scheme.border }}></li>
                <li className={themeColor} style={{ backgroundColor: theme.scheme.muted }}></li>
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ThemesList;
