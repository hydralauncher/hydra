import React from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import LanguageDetector from "i18next-browser-languagedetector";
import { HashRouter, Route, Routes } from "react-router-dom";

import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";

import "react-loading-skeleton/dist/skeleton.css";
import "react-tooltip/dist/react-tooltip.css";

import { App } from "./app";

import { store } from "./store";
import { GameFoldersProvider } from "./contexts/game-folders-context";

import resources from "@locales";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import Catalogue from "./pages/catalogue/catalogue";
import Home from "./pages/home/home";
import Downloads from "./pages/downloads/downloads";
import GameDetails from "./pages/game-details/game-details";
import Settings from "./pages/settings/settings";
import Profile from "./pages/profile/profile";
import Achievements from "./pages/achievements/achievements";

import ThemeEditor from "./pages/theme-editor/theme-editor";
import { AchievementNotification } from "./pages/achievements/notification/achievement-notification";

console.log = logger.log;

const isStaging = window.electron ? await window.electron.isStaging() : false;
addCookieInterceptor(isStaging);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: Object.keys(resources).reduce((acc, lang) => {
      acc[lang] = {
        translation: resources[lang],
        header: resources[lang].header || {},
        sidebar: resources[lang].sidebar || {},
        home: resources[lang].home || {},
        catalogue: resources[lang].catalogue || {},
        downloads: resources[lang].downloads || {},
        settings: resources[lang].settings || {},
        game_details: resources[lang].game_details || {},
        bottom_panel: resources[lang].bottom_panel || {},
        game_card: resources[lang].game_card || {},
        achievement: resources[lang].achievement || {},
        user_profile: resources[lang].user_profile || {},
        hydra_cloud: resources[lang].hydra_cloud || {},
        modal: resources[lang].modal || {},
        forms: resources[lang].forms || {},
        binary_not_found_modal: resources[lang].binary_not_found_modal || {},
        games_organizer: resources[lang].games_organizer || {},
        notifications: resources[lang].notifications || {},
        app: resources[lang].app || {},
        games_folder: resources[lang].games_folder || {},
      };
      return acc;
    }, {}),
    fallbackLng: "en",
    defaultNS: "translation",
    ns: [
      "translation",
      "header",
      "sidebar",
      "home",
      "catalogue",
      "downloads",
      "settings",
      "game_details",
      "bottom_panel",
      "game_card",
      "achievement",
      "user_profile",
      "hydra_cloud",
      "modal",
      "forms",
      "binary_not_found_modal",
      "games_organizer",
      "notifications",
      "app",
      "games_folder",
    ],
    interpolation: {
      escapeValue: false,
    },
  })
  .then(async () => {
    if (window.electron) {
      const userPreferences = await window.electron.getUserPreferences();

      if (userPreferences?.language) {
        i18n.changeLanguage(userPreferences.language);
      } else {
        window.electron.updateUserPreferences({ language: i18n.language });
      }
    }
  });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <GameFoldersProvider>
        <HashRouter>
          <Routes>
            <Route element={<App />}>
              <Route path="/" element={<Home />} />
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/game/:shop/:objectId" element={<GameDetails />} />

              <Route path="/settings" element={<Settings />} />
              <Route path="/profile/:userId" element={<Profile />} />
              <Route path="/achievements" element={<Achievements />} />
            </Route>

            <Route path="/theme-editor" element={<ThemeEditor />} />
            <Route
              path="/achievement-notification"
              element={<AchievementNotification />}
            />
          </Routes>
        </HashRouter>
      </GameFoldersProvider>
    </Provider>
  </React.StrictMode>
);
